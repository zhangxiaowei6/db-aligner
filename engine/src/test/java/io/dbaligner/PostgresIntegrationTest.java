package io.dbaligner;

import static io.dbaligner.Model.*;
import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

class PostgresIntegrationTest {
  @TempDir Path root;

  @Test
  void compareExecuteVerifyRecover() throws Exception {
    Assumptions.assumeTrue(Boolean.getBoolean("dbaligner.postgresql.test"), "需要项目隔离 PostgreSQL 17");
    var base = Path.of("..", ".tools", "postgresql-test", "17.11").toAbsolutePath().normalize();
    var credentials =
        Json.read(
            Files.readString(base.resolve("credentials.json")),
            com.fasterxml.jackson.databind.JsonNode.class);
    var driver = root.resolve("drivers/postgresql/42.7.8");
    Files.createDirectories(driver);
    Files.copy(
        Path.of("..", ".tools", "multi-db", "postgresql-42.7.8.jar"),
        driver.resolve("postgresql-42.7.8.jar"));
    String database = "ds_it_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    try (var service = new Service(root, e -> {})) {
      var cfg = Json.MAPPER.createObjectNode();
      cfg.put("id", "pg");
      cfg.put("name", "隔离 PostgreSQL");
      cfg.put("host", "127.0.0.1");
      cfg.put("port", credentials.path("port").asInt());
      cfg.put("user", "postgres");
      cfg.put("databaseType", "postgresql");
      cfg.put("initialDatabase", "postgres");
      cfg.put("driverId", "postgresql");
      cfg.put("driverVersion", "42.7.8");
      cfg.put("ssl", false);
      service.handle("entity.save", Json.node(Map.of("kind", "connection", "value", cfg)));
      var db = new Database(service.store);
      db.secrets(Json.node(Map.of("pg", credentials.path("password").asText())));
      var tls = cfg.deepCopy();
      tls.put("ssl", true);
      tls.put("ca", base.resolve("ca.pem").toString());
      tls.put("clientCert", base.resolve("client.p12").toString());
      db.secrets(
          Json.node(
              Map.of(
                  "pg",
                  credentials.path("password").asText(),
                  "pg:certificate",
                  credentials.path("certificatePassword").asText())));
      try (var tlsConnection =
              db.openConfig(new DbRef("pg", ""), tls, credentials.path("password").asText());
          var statement = tlsConnection.createStatement();
          var result =
              statement.executeQuery(
                  "SELECT ssl,client_dn IS NOT NULL FROM pg_stat_ssl WHERE pid=pg_backend_pid()")) {
        assertTrue(result.next());
        assertTrue(result.getBoolean(1));
        assertTrue(result.getBoolean(2), "客户端证书必须实际发送");
      }
      try (var admin = db.open(new DbRef("pg", ""))) {
        db.execute(admin, "CREATE DATABASE " + PostgresSql.id(database));
        var discovery = cfg.deepCopy();
        discovery.putArray("databases").add("postgres");
        assertTrue(db.databases(discovery).contains(database), "草稿列表应显示原指定范围外的可访问库");
        assertFalse(service.store.get("connection", "pg").has("databases"));
        try (var c = db.open(new DbRef("pg", database))) {
          for (String schema : List.of("source", "target", "untouched"))
            db.execute(c, "CREATE SCHEMA " + PostgresSql.id(schema));
          var source = new DbRef("pg", database, "source");
          var target = new DbRef("pg", database, "target");
          var untouched = new DbRef("pg", database, "untouched");
          String table = "字典\"表";
          String def =
              " (id bigint PRIMARY KEY,code varchar(40) NOT NULL,value varchar(100),amount"
                  + " numeric(30,8),flag boolean,bytes bytea,uid uuid,stamp timestamp with time"
                  + " zone)";
          for (var ref : List.of(source, target, untouched))
            db.execute(c, "CREATE TABLE " + Sql.qualified(ref, table) + def);
          String values =
              "12345678901234567890.12345678,true,decode('00ff','hex'),'7d164712-0b45-4da1-927c-769e2bf01d78','2026-10-13"
                  + " 09:00:00+08'";
          db.execute(
              c,
              "INSERT INTO "
                  + Sql.qualified(source, table)
                  + " VALUES(1,'A','新值''中文',"
                  + values
                  + "),(2,'B',NULL,"
                  + values
                  + ")");
          db.execute(
              c,
              "INSERT INTO "
                  + Sql.qualified(target, table)
                  + " VALUES(10,'A','旧值',"
                  + values
                  + "),(30,'Z','删除',"
                  + values
                  + ")");
          db.execute(
              c,
              "INSERT INTO "
                  + Sql.qualified(untouched, table)
                  + " VALUES(99,'X','保留',"
                  + values
                  + ")");
          String untouchedDigest = db.digest(c, untouched, table),
              before = db.digest(c, target, table);
          assertEquals(
              List.of("source", "target", "untouched"),
              db.schemas(new DbRef("pg", database)).stream()
                  .filter(n -> !n.equals("public"))
                  .toList());
          var planner = new Planner(db);
          var archives = new Archives(service.store);
          try (var jobs = new Jobs(service.store, db, archives, e -> {})) {
            var plan =
                planner.compare(
                    "default",
                    source,
                    List.of(target),
                    List.of(new TableChoice(table, false, true, List.of("code"))));
            assertEquals("", plan.targets.getFirst().error, Json.write(plan));
            assertEquals(3, plan.targets.getFirst().changes.size(), Json.write(plan));
            assertTrue(
                plan.targets.getFirst().changes.stream().noneMatch(x -> x.blocked),
                Json.write(plan));
            var ids = plan.targets.getFirst().changes.stream().map(x -> x.id).toList();
            var disposable = jobs.save(plan, ids, "SAVE_ONLY", "待删除的真库计划");
            service.handle(
                "record.updateRemark", Json.node(Map.of("id", disposable.id, "remark", "备注变更")));
            service.handle(
                "record.delete",
                Json.node(Map.of("id", disposable.id, "confirmation", disposable.id)));
            assertNull(service.store.get("record", disposable.id));
            assertFalse(Files.exists(Path.of(disposable.archivePath)));
            assertEquals(before, db.digest(c, target, table));
            var saved = jobs.save(plan, ids, "SAVE_ONLY", "保存不执行");
            assertEquals(before, db.digest(c, target, table));
            var executed =
                await(service.store, jobs.save(plan, ids, "EXECUTE_AND_SAVE", "PG 真库执行").id);
            assertEquals("SUCCESS", executed.status, Json.write(executed));
            assertEquals(2, db.snapshot(c, target, table, true).rows.size());
            assertEquals(untouchedDigest, db.digest(c, untouched, table));
            assertTrue(
                jobs.preview(executed.id).items.stream().allMatch(i -> i.eligible),
                Json.write(jobs.preview(executed.id)));
            assertEquals("SUCCESS", jobs.rollback(executed.id, ids, "恢复数据").status);
            assertEquals(before, db.digest(c, target, table));
            var report = new External(service.store, db, archives).audit(executed.id);
            assertNotNull(report);
            // 独立行冲突仅禁用冲突行，回滚入口必须再次复验。
            plan =
                planner.compare(
                    "default",
                    source,
                    List.of(target),
                    List.of(new TableChoice(table, false, true, List.of("code"))));
            ids = plan.targets.getFirst().changes.stream().map(x -> x.id).toList();
            executed = await(service.store, jobs.save(plan, ids, "EXECUTE_AND_SAVE", "冲突").id);
            db.execute(
                c, "UPDATE " + Sql.qualified(target, table) + " SET value='后续修改' WHERE code='A'");
            assertEquals(
                1, jobs.preview(executed.id).items.stream().filter(i -> !i.eligible).count());
            var eligible =
                jobs.preview(executed.id).items.stream()
                    .filter(i -> i.eligible)
                    .map(i -> i.id)
                    .toList();
            assertEquals("SUCCESS", jobs.rollback(executed.id, eligible, "恢复无冲突行").status);
            // 恢复字段原值、注释、索引、多语句变更与实际提交。
            db.execute(
                c,
                "ALTER TABLE "
                    + Sql.qualified(target, table)
                    + " ADD COLUMN legacy varchar(40) NOT NULL DEFAULT '不可丢失'");
            String lossyBefore = db.digest(c, target, table);
            var opts = new StructureOptions(true, false, true, true, true, true, false);
            var structure =
                planner.compare(
                    "default",
                    source,
                    List.of(target),
                    List.of(new TableChoice(table, true, false, List.of(), opts)));
            var drop =
                structure.targets.getFirst().changes.stream()
                    .filter(x -> x.kind.equals("DROP_COLUMN"))
                    .findFirst()
                    .orElseThrow();
            assertFalse(drop.blocked, Json.write(structure));
            var loss =
                await(
                    service.store,
                    jobs.save(structure, List.of(drop.id), "EXECUTE_AND_SAVE", "删除字段").id);
            assertEquals("SUCCESS", loss.status, Json.write(loss));
            assertEquals("SUCCESS", jobs.rollback(loss.id, List.of(drop.id), "恢复字段").status);
            assertEquals(lossyBefore, db.digest(c, target, table));
            // 无主键的有损字段、缺表数据、序列、外键级联与上限。
            db.execute(c, "CREATE TABLE source.missing(id int PRIMARY KEY)");
            var missing =
                planner.compare(
                    "default",
                    source,
                    List.of(target),
                    List.of(new TableChoice("missing", false, true, List.of())));
            assertEquals(List.of("missing"), missing.targets.getFirst().skippedTables);
            db.execute(
                c,
                "CREATE TABLE source.identity_table(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY"
                    + " KEY)");
            assertFalse(db.snapshot(c, source, "identity_table", false).supported);
            db.execute(c, "CREATE TABLE source.large(id integer PRIMARY KEY)");
            db.execute(c, "INSERT INTO source.large SELECT generate_series(1,20001)");
            assertThrows(
                Database.RowLimitException.class, () -> db.snapshot(c, source, "large", true));
            // 中途 DDL 失败必须回滚前面已执行的 SQL，不能留下 DONE。
            db.execute(c, "CREATE TABLE source.tx(id integer PRIMARY KEY)");
            db.execute(c, "CREATE TABLE target.tx(id integer PRIMARY KEY)");
            db.execute(c, "ALTER TABLE source.tx ADD COLUMN a integer");
            db.execute(c, "ALTER TABLE source.tx ADD COLUMN z integer NOT NULL");
            db.execute(c, "INSERT INTO target.tx VALUES(1)");
            var tx =
                planner.compare(
                    "default",
                    source,
                    List.of(target),
                    List.of(new TableChoice("tx", true, false, List.of(), opts)));
            String txBefore = db.digest(c, target, "tx");
            var txIds =
                tx.targets.getFirst().changes.stream()
                    .filter(x -> !x.blocked)
                    .map(x -> x.id)
                    .toList();
            var failed = await(service.store, jobs.save(tx, txIds, "EXECUTE_AND_SAVE", "中途失败").id);
            assertEquals("FAILED", failed.status, Json.write(failed));
            assertEquals(txBefore, db.digest(c, target, "tx"));
            assertTrue(
                failed.results.getFirst().steps.stream().noneMatch(st -> st.status.equals("DONE")));
            assertTrue(jobs.preview(failed.id).items.isEmpty());
            // 新表、多语句注释、索引、外键与目标 schema 重定位。
            db.execute(c, "CREATE TABLE source.parent(id integer PRIMARY KEY)");
            db.execute(
                c,
                "CREATE TABLE source.child(id integer PRIMARY KEY,parent_id integer,CONSTRAINT"
                    + " fk_parent FOREIGN KEY(parent_id) REFERENCES source.parent(id))");
            db.execute(c, "CREATE UNIQUE INDEX uk_child_id ON source.child(parent_id)");
            db.execute(c, "COMMENT ON TABLE source.child IS '子表'");
            db.execute(c, "COMMENT ON COLUMN source.child.parent_id IS '父记录'");
            var create =
                planner.compare(
                    "default",
                    source,
                    List.of(target),
                    List.of(
                        new TableChoice("parent", true, false, List.of(), opts),
                        new TableChoice("child", true, false, List.of(), opts)));
            var createIds =
                create.targets.getFirst().changes.stream()
                    .filter(x -> !x.blocked)
                    .map(x -> x.id)
                    .toList();
            assertEquals(4, createIds.size(), Json.write(create));
            var created =
                await(service.store, jobs.save(create, createIds, "EXECUTE_AND_SAVE", "创建关联表").id);
            assertEquals("SUCCESS", created.status, Json.write(created));
            assertTrue(
                db.snapshot(c, target, "child", false)
                    .foreignKeys
                    .getFirst()
                    .definition()
                    .contains("\"target\".\"parent\""));
            assertEquals("SUCCESS", jobs.rollback(created.id, createIds, "删除本次新建对象").status);
            assertFalse(db.snapshot(c, target, "parent", false).exists);
            assertFalse(db.snapshot(c, target, "child", false).exists);
            // 仅保存记录的外部声明和核验追加证据，原始事实仍为 UNEXECUTED。
            var extPlan =
                planner.compare(
                    "default",
                    source,
                    List.of(target),
                    List.of(new TableChoice("parent", true, false, List.of(), opts)));
            var extIds = extPlan.targets.getFirst().changes.stream().map(x -> x.id).toList();
            var extSaved = jobs.save(extPlan, extIds, "SAVE_ONLY", "外部执行");
            for (var change : extPlan.targets.getFirst().changes)
              for (String sql : change.statements) db.execute(c, sql);
            var external = new External(service.store, db, archives);
            external.declare(extSaved.id, extIds, false, "用户声明");
            var verified = Json.node(external.verify(extSaved.id));
            assertTrue(verified.path("verified").asBoolean(), verified.toString());
            assertEquals(
                "UNEXECUTED", service.store.get("record", extSaved.id).path("status").asText());
            assertEquals("SUCCESS", jobs.rollback(extSaved.id, extIds, "恢复外部执行").status);
            // 真实 JDBC 长查询取消，不能只更新前端任务状态。
            try (var executor = java.util.concurrent.Executors.newCachedThreadPool()) {
              var context = new ComparisonContext(executor, event -> {});
              var future =
                  executor.submit(
                      () -> {
                        ComparisonContext.CURRENT.set(context);
                        try (var query = db.open(source)) {
                          db.execute(query, "SELECT pg_sleep(30) /* dbaligner_cancel_test */");
                        } finally {
                          ComparisonContext.CURRENT.remove();
                        }
                        return true;
                      });
              long limit = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
              boolean active = false;
              while (System.nanoTime() < limit && !active) {
                try (var statement = c.createStatement();
                    var result =
                        statement.executeQuery(
                            "SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid() "
                                + "AND state='active' AND query LIKE '%dbaligner_cancel_test%'")) {
                  result.next();
                  active = result.getInt(1) > 0;
                }
                if (!active) Thread.sleep(20);
              }
              assertTrue(active, "必须实际启动 JDBC 查询");
              context.cancel();
              assertThrows(
                  java.util.concurrent.ExecutionException.class,
                  () -> future.get(5, java.util.concurrent.TimeUnit.SECONDS));
            }
            // 执行前目标已变化、锁竞争和事务取消均不得写入。
            var safetyPlan =
                planner.compare(
                    "default",
                    source,
                    List.of(target),
                    List.of(new TableChoice("parent", true, false, List.of(), opts)));
            var safetyIds = safetyPlan.targets.getFirst().changes.stream().map(x -> x.id).toList();
            var cancelled = jobs.save(safetyPlan, safetyIds, "SAVE_ONLY", "事务取消");
            assertThrows(
                java.util.concurrent.CancellationException.class,
                () ->
                    new PostgresExecution(db, archives)
                        .run(
                            cancelled,
                            safetyPlan.targets.getFirst(),
                            cancelled.results.getFirst(),
                            new java.util.concurrent.atomic.AtomicBoolean(true),
                            (type, details) -> {}));
            assertFalse(db.snapshot(c, target, "parent", false).exists);
            db.execute(c, "CREATE TABLE target.parent(id integer PRIMARY KEY)");
            var staleWrite =
                await(
                    service.store,
                    jobs.save(safetyPlan, safetyIds, "EXECUTE_AND_SAVE", "执行前变化").id);
            assertEquals("FAILED", staleWrite.status);
            db.execute(c, "DROP TABLE target.parent");
            // 提交成功后本地确认丢失：保留 UNKNOWN，不自动回滚或作为已执行证明。
            var uncertain = jobs.save(safetyPlan, safetyIds, "SAVE_ONLY", "提交确认丢失");
            uncertain.mode = "EXECUTE_AND_SAVE";
            uncertain.status = "INTERRUPTED";
            assertThrows(
                java.io.IOException.class,
                () ->
                    new PostgresExecution(db, archives)
                        .run(
                            uncertain,
                            safetyPlan.targets.getFirst(),
                            uncertain.results.getFirst(),
                            new java.util.concurrent.atomic.AtomicBoolean(),
                            (type, details) -> {
                              if (type.equals("target-committed"))
                                throw new java.io.IOException("模拟本地确认失败");
                              service.store.put("record", uncertain.id, uncertain);
                            }));
            assertTrue(db.snapshot(c, target, "parent", false).exists);
            assertTrue(
                uncertain.results.getFirst().steps.stream()
                    .allMatch(step -> step.status.equals("UNKNOWN")));
            assertTrue(jobs.preview(uncertain.id).items.stream().noneMatch(item -> item.eligible));
            // 锁竞争期间取消，取得锁后仍复验取消状态，不写入。
            for (var ref : List.of(source, target))
              db.execute(
                  c,
                  "CREATE TABLE "
                      + Sql.qualified(ref, "locked")
                      + "(id int PRIMARY KEY,value text)");
            db.execute(c, "INSERT INTO source.locked VALUES(1,'新')");
            db.execute(c, "INSERT INTO target.locked VALUES(1,'旧')");
            var lockPlan =
                planner.compare(
                    "default",
                    source,
                    List.of(target),
                    List.of(new TableChoice("locked", false, true, List.of())));
            var lockIds = lockPlan.targets.getFirst().changes.stream().map(x -> x.id).toList();
            String lockBefore = db.digest(c, target, "locked");
            SyncRecord waiting;
            try (var holder = db.open(target)) {
              holder.setAutoCommit(false);
              db.execute(holder, "LOCK TABLE target.locked IN ACCESS EXCLUSIVE MODE");
              waiting = jobs.save(lockPlan, lockIds, "EXECUTE_AND_SAVE", "锁竞争取消");
              boolean blocked = false;
              long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
              while (!blocked && System.nanoTime() < deadline) {
                try (var statement = c.createStatement();
                    var rs =
                        statement.executeQuery(
                            "SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()"
                                + " AND wait_event_type='Lock'")) {
                  rs.next();
                  blocked = rs.getInt(1) > 0;
                }
                if (!blocked) Thread.sleep(20);
              }
              assertTrue(blocked, "必须实际等待 PostgreSQL 表锁");
              jobs.cancel(waiting.id);
              holder.rollback();
            }
            assertEquals("CANCELLED", await(service.store, waiting.id).status);
            assertEquals(lockBefore, db.digest(c, target, "locked"));
            // 比较后新增未选 schema 的级联外键，执行时阻止删除父行。
            db.execute(c, "DELETE FROM source.locked");
            var fkPlan =
                planner.compare(
                    "default",
                    source,
                    List.of(target),
                    List.of(new TableChoice("locked", false, true, List.of())));
            var fkIds = fkPlan.targets.getFirst().changes.stream().map(x -> x.id).toList();
            db.execute(
                c,
                "CREATE TABLE untouched.child(id int PRIMARY KEY,parent_id int REFERENCES"
                    + " target.locked(id) ON DELETE CASCADE)");
            db.execute(c, "INSERT INTO untouched.child VALUES(1,1)");
            String childBefore = db.digest(c, untouched, "child");
            assertEquals(
                "FAILED",
                await(service.store, jobs.save(fkPlan, fkIds, "EXECUTE_AND_SAVE", "外键阻止").id)
                    .status);
            assertEquals(lockBefore, db.digest(c, target, "locked"));
            assertEquals(childBefore, db.digest(c, untouched, "child"));
            db.execute(
                c,
                "CREATE TABLE source.defaults(id int PRIMARY KEY,note text DEFAULT '固定值',stamp"
                    + " timestamp DEFAULT CURRENT_TIMESTAMP)");
            var defaultModel = Json.node(db.snapshot(c, source, "defaults", false));
            assertEquals(
                "LITERAL",
                defaultModel
                    .path("attributes")
                    .path("columnDefaults")
                    .path("note")
                    .path("kind")
                    .asText());
            assertEquals(
                "EXPRESSION",
                defaultModel
                    .path("attributes")
                    .path("columnDefaults")
                    .path("stamp")
                    .path("kind")
                    .asText());
            db.execute(
                c, "CREATE INDEX special_operator ON source.defaults(note text_pattern_ops)");
            assertFalse(db.snapshot(c, source, "defaults", false).supported);
            if (Boolean.getBoolean("dbaligner.native.smoke")) {
              String nativeTable = "安装版字典";
              for (var ref : List.of(source, target)) {
                db.execute(
                    c,
                    "CREATE TABLE "
                        + Sql.qualified(ref, nativeTable)
                        + "(id bigint PRIMARY KEY,value text,amount numeric(30,9))");
                db.execute(
                    c,
                    "INSERT INTO "
                        + Sql.qualified(ref, nativeTable)
                        + " VALUES(9223372036854775807,'"
                        + (ref.equals(source) ? "新" : "旧")
                        + "',"
                        + (ref.equals(source) ? "1234567890.123456789" : "0.123456789")
                        + ")");
              }
              var nativeRoot = root.resolve("native-postgresql");
              Files.createDirectories(nativeRoot);
              var fixture = nativeRoot.resolve("fixture.json");
              var nativeFixture = new LinkedHashMap<String, Object>();
              nativeFixture.put("connection", cfg);
              nativeFixture.put("password", credentials.path("password").asText());
              nativeFixture.put("source", database);
              nativeFixture.put("target", database);
              nativeFixture.put("sourceSchema", "source");
              nativeFixture.put("targetSchema", "target");
              nativeFixture.put("table", nativeTable);
              nativeFixture.put("bigId", "9223372036854775807");
              nativeFixture.put("amount", "1234567890.123456789");
              var mysqlCredentials =
                  Path.of("..", ".tools", "mysql-test", "8.4.8", "credentials.json");
              if (!System.getProperty("dbaligner.mysql.versions", "").isEmpty()) {
                var mysql = Json.MAPPER.readTree(Files.readString(mysqlCredentials));
                nativeFixture.put(
                    "mysql",
                    Map.of(
                        "host", mysql.path("host").asText(),
                        "port", mysql.path("port").asInt(),
                        "user", mysql.path("user").asText(),
                        "password", mysql.path("password").asText(),
                        "databaseType", "mysql",
                        "driverId", "mariadb",
                        "driverVersion", "3.5.10",
                        "ssl", true,
                        "ca",
                            mysqlCredentials
                                .getParent()
                                .resolve("server-cert.pem")
                                .toAbsolutePath()
                                .toString()));
              }
              var executable = NativeClientRelease.extract(root.resolve("native-client"));
              for (boolean cached : List.of(false, true)) {
                nativeFixture.put("expectCachedDriver", cached);
                Files.writeString(fixture, Json.write(nativeFixture));
                var process =
                    new ProcessBuilder(
                            executable.toString(), "--smoke-test", "--smoke-fixture=" + fixture)
                        .redirectErrorStream(true)
                        .redirectOutput(nativeRoot.resolve("native.log").toFile());
                process.environment().put("DB_ALIGNER_HOME", nativeRoot.toString());
                process.environment().remove("DB_ALIGNER_DEV");
                process.environment().remove("JAVA_HOME");
                process.environment().put("PATH", System.getenv("SystemRoot") + "\\System32");
                var running = process.start();
                if (!running.waitFor(150, java.util.concurrent.TimeUnit.SECONDS)) {
                  running.destroyForcibly();
                  throw new AssertionError("打包 PostgreSQL smoke 超时");
                }
                var resultFile = nativeRoot.resolve("smoke-result.json");
                assertTrue(
                    Files.exists(resultFile),
                    "Packaged client produced no result (exit "
                        + running.exitValue()
                        + "): "
                        + Files.readString(nativeRoot.resolve("native.log")));
                var result = Json.MAPPER.readTree(Files.readString(resultFile));
                assertEquals(0, running.exitValue(), result.toString());
                assertTrue(result.path("passed").asBoolean(), result.toString());
                Files.writeString(
                    Path.of(
                        "..",
                        "docs",
                        cached
                            ? "postgresql-native-client-cached-smoke.json"
                            : "postgresql-native-client-smoke.json"),
                    result.toPrettyString());
              }
            }
            // 凭据不出现在公开配置或计划，驱动引用保留。
            var exported = service.handle("config.export", Json.node(Map.of()));
            assertFalse(Json.write(exported).contains(credentials.path("password").asText()));
            assertTrue(Json.write(exported).contains("42.7.8"));
            // 失效计划拒绝写入。
            var stale =
                planner.compare(
                    "default",
                    source,
                    List.of(target),
                    List.of(new TableChoice(table, false, true, List.of("code"))));
            var modified = cfg.deepCopy();
            modified.put("user", "changed");
            service.store.put("connection", "pg", modified);
            assertThrows(
                IllegalArgumentException.class,
                () -> db.openBound(target, stale.targets.getFirst().connectionIdentity));
            service.store.put("connection", "pg", cfg);
          }
        } finally {
          db.execute(admin, "DROP DATABASE " + PostgresSql.id(database));
        }
      } finally {
        db.close();
      }
    }
  }

  static SyncRecord await(Store store, String id) throws Exception {
    long end = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(30);
    while (System.nanoTime() < end) {
      var record = Json.MAPPER.treeToValue(store.get("record", id), SyncRecord.class);
      if (!List.of("QUEUED", "RUNNING").contains(record.status)) return record;
      Thread.sleep(25);
    }
    throw new AssertionError("执行超时");
  }
}
