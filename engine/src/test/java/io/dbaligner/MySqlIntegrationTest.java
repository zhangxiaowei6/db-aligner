package io.dbaligner;

import static io.dbaligner.Model.*;
import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.*;
import java.sql.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

class MySqlIntegrationTest {
  @TempDir Path root;

  @TestFactory
  Collection<DynamicTest> supportedServers() {
    String versions = System.getProperty("dbaligner.mysql.versions", "");
    if (versions.isBlank())
      return List.of(
          DynamicTest.dynamicTest(
              "Real database tests not requested",
              () ->
                  Assumptions.assumeTrue(
                      false, "Set dbaligner.mysql.versions and start project test servers")));
    return Arrays.stream(versions.split(","))
        .map(v -> DynamicTest.dynamicTest("MySQL " + v, () -> run(v)))
        .toList();
  }

  void run(String version) throws Exception {
    Path base = Path.of("..", ".tools", "mysql-test", version).toAbsolutePath().normalize();
    var creds =
        Json.read(
            Files.readString(base.resolve("credentials.json")),
            com.fasterxml.jackson.databind.JsonNode.class);
    String prefix = "ds_it_" + UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    var src = new DbRef("server", prefix + "_s");
    var a = new DbRef("server", prefix + "_a");
    var b = new DbRef("server", prefix + "_b");
    try (var store = new Store(root.resolve(version))) {
      var config = Json.MAPPER.createObjectNode();
      config.put("id", "server");
      config.put("name", "Test " + version);
      config.put("host", creds.path("host").asText());
      config.put("port", creds.path("port").asInt());
      config.put("user", "root");
      config.put("ssl", true);
      config.put("ca", base.resolve("server-cert.pem").toString());
      store.put("connection", "server", config);
      var db = new Database(store);
      db.secrets(Json.node(Map.of("server", creds.path("password").asText())));
      try (var admin = db.open(new DbRef("server", ""))) {
        db.supportedServer(admin);
        verifyStringLiterals(db, admin);
        for (var ref : List.of(src, a, b))
          db.execute(
              admin,
              "CREATE DATABASE "
                  + Sql.id(ref.database())
                  + " CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci");
        try (var jobs = new Jobs(store, db, new Archives(store), e -> {})) {
          String table = "字典`表";
          String def =
              " (`id` int NOT NULL AUTO_INCREMENT, `code` varchar(30) NOT NULL, `value`"
                  + " varchar(100) DEFAULT NULL, PRIMARY KEY (`id`), UNIQUE KEY `uk_code` (`code`))"
                  + " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci";
          for (var ref : List.of(src, a, b))
            db.execute(admin, "CREATE TABLE " + Sql.qualified(ref, table) + def);
          db.execute(
              admin,
              "INSERT INTO "
                  + Sql.qualified(src, table)
                  + " VALUES(1,'A',"
                  + Sql.value("新值'中文")
                  + "),(2,'B','新增')");
          for (var ref : List.of(a, b))
            db.execute(
                admin,
                "INSERT INTO " + Sql.qualified(ref, table) + " VALUES(10,'A','旧值'),(30,'Z','删除')");
          // Unselected table has a trigger and must not prevent the selected comparison.
          db.execute(admin, "CREATE TABLE " + Sql.qualified(src, "未选择") + " (id int)");
          db.execute(
              admin,
              "CREATE TRIGGER "
                  + Sql.qualified(src, "trigger_not_selected")
                  + " BEFORE INSERT ON "
                  + Sql.qualified(src, "未选择")
                  + " FOR EACH ROW SET NEW.id=1");
          var planner = new Planner(db);
          var plan =
              planner.compare(
                  "default",
                  src,
                  List.of(a, b),
                  List.of(new TableChoice(table, false, true, List.of("code"))));
          assertTrue(plan.targets.stream().allMatch(t -> t.error.isBlank()), Json.write(plan));
          assertEquals(1, plan.sourceSnapshot.size());
          assertEquals(3, plan.targets.getFirst().changes.size());
          assertTrue(
              plan.targets.getFirst().changes.stream()
                  .filter(x -> x.kind.equals("ADD_ROW"))
                  .anyMatch(x -> x.sql.endsWith("'B','新增')") && !x.sql.contains("utf8mb4")));
          assertTrue(
              plan.targets.getFirst().changes.stream()
                  .filter(x -> x.kind.equals("UPDATE_ROW"))
                  .allMatch(
                      x ->
                          x.sql.contains("SET `value`='新值''中文'")
                              && x.sql.contains("`value` <=> '旧值'")
                              && !x.sql.contains("COLLATE")
                              && !x.sql.contains("utf8mb4")
                              && x.rollbackSql.stream().noneMatch(sql -> sql.contains("COLLATE"))));
          assertTrue(
              plan.targets.getFirst().changes.stream()
                  .filter(x -> x.kind.equals("DELETE_ROW"))
                  .allMatch(x -> !x.sql.contains("utf8mb4") && !x.sql.contains("COLLATE")));
          assertEquals(
              10,
              ((Number)
                      plan.targets.getFirst().changes.stream()
                          .filter(x -> x.kind.equals("UPDATE_ROW"))
                          .findFirst()
                          .orElseThrow()
                          .after
                          .get("id"))
                  .intValue());
          var selected =
              plan.targets.stream()
                  .flatMap(t -> t.changes.stream())
                  .filter(x -> !x.blocked)
                  .map(x -> x.id)
                  .toList();
          String beforeA = db.digest(admin, a, table), beforeB = db.digest(admin, b, table);
          var objectsA = db.tables(a);
          var objectsB = db.tables(b);
          var saved = jobs.save(plan, selected, "SAVE_ONLY", "仅保存");
          assertEquals(beforeA, db.digest(admin, a, table));
          assertEquals(beforeB, db.digest(admin, b, table));
          assertNoEngineObjects(db, a);
          var executed = jobs.save(plan, selected, "EXECUTE_AND_SAVE", "真实多目标执行");
          executed = await(store, executed.id);
          assertEquals("SUCCESS", executed.status, Json.write(executed));
          assertNoEngineObjects(db, a);
          assertNoEngineObjects(db, b);
          assertEquals(objectsA, db.tables(a));
          assertEquals(objectsB, db.tables(b));
          assertEquals(2, db.snapshot(admin, a, table, true).rows.size());
          assertTrue(
              jobs.preview(executed.id).items.stream().allMatch(i -> i.eligible),
              Json.write(jobs.preview(executed.id)));
          var first =
              plan.targets.getFirst().changes.stream()
                  .filter(x -> x.kind.equals("UPDATE_ROW"))
                  .findFirst()
                  .orElseThrow()
                  .id;
          var partialRoll = jobs.rollback(executed.id, List.of(first), "先恢复一个数据项");
          assertEquals("SUCCESS", partialRoll.status);
          assertTrue(jobs.preview(executed.id).items.stream().allMatch(i -> i.eligible));
          assertTrue(jobs.preview(executed.id).items.stream().noneMatch(i -> i.id.equals(first)));
          var roll =
              jobs.rollback(
                  executed.id, selected.stream().filter(id -> !id.equals(first)).toList(), "恢复剩余项");
          assertEquals("SUCCESS", roll.status, Json.write(roll));
          assertEquals(beforeA, db.digest(admin, a, table));
          assertEquals(beforeB, db.digest(admin, b, table));
          // Structure loss: remove a target-only field, then restore its definition and original
          // values.
          db.execute(
              admin,
              "ALTER TABLE "
                  + Sql.qualified(a, table)
                  + " ADD COLUMN `旧列` varchar(80) COMMENT '恢复测试'");
          db.execute(admin, "UPDATE " + Sql.qualified(a, table) + " SET `旧列`='不可丢失' WHERE id=10");
          String lossyBefore = db.digest(admin, a, table);
          String oldDDL = db.snapshot(admin, a, table, false).createSql;
          var loss =
              planner.compare(
                  "default",
                  src,
                  List.of(a),
                  List.of(new TableChoice(table, true, false, List.of())));
          var drop =
              loss.targets.getFirst().changes.stream()
                  .filter(x -> x.kind.equals("DROP_COLUMN"))
                  .findFirst()
                  .orElseThrow();
          assertTrue(drop.risk && !drop.selected && !drop.blocked);
          var lr = await(store, jobs.save(loss, List.of(drop.id), "EXECUTE_AND_SAVE", "").id);
          assertEquals("SUCCESS", lr.status, Json.write(lr));
          assertEquals("LOCAL_V1", lr.recoveryFormat);
          assertFalse(lr.results.getFirst().recoveryRows.get(table).isEmpty());
          Path recoveryFolder;
          try (var folders = Files.list(Path.of(lr.archivePath))) {
            recoveryFolder = folders.filter(Files::isDirectory).findFirst().orElseThrow();
          }
          assertTrue(
              Files.readString(recoveryFolder.resolve("05_rollback_local.sql"))
                  .contains(Sql.value("不可丢失")));
          assertTrue(Files.exists(recoveryFolder.resolve("recovery.json")));
          var originalRecoveryRecord = store.get("record", lr.id).deepCopy();
          var corrupted = Json.MAPPER.treeToValue(originalRecoveryRecord, SyncRecord.class);
          corrupted.results.getFirst().recoveryRows.get(table).getFirst().put("旧列", "篡改资料");
          store.put("record", lr.id, corrupted);
          assertTrue(jobs.preview(lr.id).items.stream().noneMatch(x -> x.eligible));
          assertThrows(
              IllegalArgumentException.class,
              () -> jobs.rollback(corrupted.id, List.of(drop.id), ""));
          store.put("record", lr.id, originalRecoveryRecord);
          var lroll = jobs.rollback(lr.id, List.of(drop.id), "");
          assertEquals("SUCCESS", lroll.status, Json.write(lroll));
          assertEquals(
              lossyBefore,
              db.digest(admin, a, table),
              oldDDL + " AFTER: " + db.snapshot(admin, a, table, false).createSql);
          localRecoveryCases(store, db, jobs, planner, admin, src, a);
          // Subsequent writes disable rollback rather than silently replacing user changes.
          var cp =
              planner.compare(
                  "default",
                  src,
                  List.of(a),
                  List.of(new TableChoice(table, false, true, List.of("code"))));
          var safe =
              cp.targets.getFirst().changes.stream()
                  .filter(x -> !x.risk && !x.blocked)
                  .map(x -> x.id)
                  .toList();
          var cr = await(store, jobs.save(cp, safe, "EXECUTE_AND_SAVE", "").id);
          assertEquals("SUCCESS", cr.status, Json.write(cr));
          db.execute(
              admin, "UPDATE " + Sql.qualified(a, table) + " SET value='后续写入' WHERE code='A'");
          var conflict = jobs.preview(cr.id);
          assertTrue(conflict.items.stream().anyMatch(i -> !i.eligible));
          assertTrue(conflict.items.stream().anyMatch(i -> i.eligible));
          var independentlyRecoverable =
              conflict.items.stream().filter(i -> i.eligible).map(i -> i.id).toList();
          assertEquals("SUCCESS", jobs.rollback(cr.id, independentlyRecoverable, "恢复无冲突项").status);
          assertTrue(
              jobs.preview(cr.id).items.stream().noneMatch(i -> i.eligible),
              "恢复其他行不能将后续修改的冲突行视为可信");
          // External registration alone is not sufficient evidence.
          var external = new External(store, db, new Archives(store));
          external.declare(saved.id, selected, true, "用户登记");
          assertFalse(Json.node(external.verify(saved.id)).path("verified").asBoolean());
          // Default export must contain no executable DROP; explicit opt-in must include it.
          try (var service = new Service(root.resolve(version + "-export"), e -> {})) {
            service.store.put("connection", "server", config);
            var exp =
                Json.node(
                    service.handle(
                        "schema.export",
                        Json.node(
                            Map.of(
                                "source",
                                src,
                                "tables",
                                List.of(table),
                                "includeDrop",
                                false,
                                "$secrets",
                                Map.of("server", creds.path("password").asText())))));
            assertFalse(exp.path("sql").asText().matches("(?s).*\\nDROP TABLE.*"));
            var withDrop =
                Json.node(
                    service.handle(
                        "schema.export",
                        Json.node(
                            Map.of("source", src, "tables", List.of(table), "includeDrop", true))));
            assertTrue(withDrop.path("sql").asText().contains("DROP TABLE IF EXISTS"));
          }
          // State changed after comparison: one target fails its guard; the other completes
          // independently.
          var independent =
              planner.compare(
                  "default",
                  src,
                  List.of(a, b),
                  List.of(new TableChoice(table, false, true, List.of("code"))));
          var independentIds =
              independent.targets.stream()
                  .flatMap(t -> t.changes.stream())
                  .filter(x -> !x.blocked)
                  .map(x -> x.id)
                  .toList();
          db.execute(admin, "UPDATE " + Sql.qualified(b, table) + " SET value='改变' WHERE code='A'");
          var pr = await(store, jobs.save(independent, independentIds, "EXECUTE_AND_SAVE", "").id);
          assertEquals("PARTIAL", pr.status);
          assertEquals("SUCCESS", pr.results.getFirst().status);
          assertEquals("FAILED", pr.results.get(1).status);
          var eligible =
              jobs.preview(pr.id).items.stream().filter(i -> i.eligible).map(i -> i.id).toList();
          assertFalse(eligible.isEmpty());
          assertEquals("SUCCESS", jobs.rollback(pr.id, eligible, "").status);
          // 目标库零污染：执行后不存在任何引擎创建的备份/凭据/快照表，回滚完全依赖本地恢复资料。
          assertNoEngineObjects(db, b);
          // Run the exact exported apply script, then register and independently verify.
          String extTable = "外部执行";
          db.execute(
              admin,
              "CREATE TABLE "
                  + Sql.qualified(src, extTable)
                  + " (id bigint PRIMARY KEY, v varchar(30)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"
                  + " COLLATE=utf8mb4_general_ci");
          db.execute(
              admin,
              "CREATE TABLE "
                  + Sql.qualified(a, extTable)
                  + " LIKE "
                  + Sql.qualified(src, extTable));
          db.execute(admin, "INSERT INTO " + Sql.qualified(src, extTable) + " VALUES(1,'新')");
          db.execute(admin, "INSERT INTO " + Sql.qualified(a, extTable) + " VALUES(1,'旧')");
          String extBefore = db.digest(admin, a, extTable);
          var ep =
              planner.compare(
                  "default",
                  src,
                  List.of(a),
                  List.of(new TableChoice(extTable, false, true, List.of())));
          var ei = ep.targets.getFirst().changes.stream().map(x -> x.id).toList();
          var originalConnection = store.get("connection", a.connectionId());
          var movedConnection =
              (com.fasterxml.jackson.databind.node.ObjectNode) originalConnection.deepCopy();
          movedConnection.put("host", "192.0.2.55");
          store.put("connection", a.connectionId(), movedConnection);
          try {
            var moved = await(store, jobs.save(ep, ei, "EXECUTE_AND_SAVE", "旧计划拒绝新目标地址").id);
            assertEquals("FAILED", moved.status);
            assertTrue(moved.results.getFirst().backups.isEmpty());
            assertTrue(moved.results.getFirst().error.contains("目标连接配置已变化"));
            assertEquals(extBefore, db.digest(admin, a, extTable));
          } finally {
            store.put("connection", a.connectionId(), originalConnection);
          }
          var er = jobs.save(ep, ei, "SAVE_ONLY", "");
          Path tf;
          try (var walk = Files.list(Path.of(er.archivePath))) {
            tf = walk.filter(Files::isDirectory).findFirst().orElseThrow();
          }
          assertFalse(
              Files.exists(tf.resolve("01_prepare_backup.sql"))
                  || Files.exists(tf.resolve("03_verify.sql")),
              "脚本包不应再生成备份/校验脚本");
          for (String file : List.of("02_sync.sql")) {
            String sql =
                Files.readString(tf.resolve(file))
                    .lines()
                    .filter(line -> !line.startsWith("--"))
                    .collect(java.util.stream.Collectors.joining("\n"));
            for (String stmt : sql.split(";\\s*(?:\\r?\\n|$)"))
              if (!stmt.isBlank())
                try (var st = admin.createStatement()) {
                  st.execute(stmt);
                }
          }
          assertNoEngineObjects(db, a);
          external.declare(er.id, ei, true, "外部执行已完成");
          var verified = Json.node(external.verify(er.id));
          assertTrue(verified.path("verified").asBoolean(), verified.toString());
          assertEquals("UNEXECUTED", store.get("record", er.id).path("status").asText());
          assertEquals("SUCCESS", jobs.rollback(er.id, ei, "").status);
          assertEquals(extBefore, db.digest(admin, a, extTable));
          assertNoEngineObjects(db, a);
          // Stop future dispatch after a committed batch; retain actual committed steps for
          // recovery.
          String cancelTable = "取消验证";
          db.execute(
              admin,
              "CREATE TABLE "
                  + Sql.qualified(src, cancelTable)
                  + " (id int PRIMARY KEY,v varchar(20)) ENGINE=InnoDB");
          db.execute(
              admin,
              "CREATE TABLE "
                  + Sql.qualified(a, cancelTable)
                  + " LIKE "
                  + Sql.qualified(src, cancelTable));
          for (int i = 1; i <= 12; i++)
            db.execute(
                admin,
                "INSERT INTO " + Sql.qualified(src, cancelTable) + " VALUES(" + i + ",'数据')");
          var cfgSettings =
              (com.fasterxml.jackson.databind.node.ObjectNode) store.get("settings", "global");
          cfgSettings.put("batchSize", 2);
          store.put("settings", "global", cfgSettings);
          var cancelPlan =
              planner.compare(
                  "default",
                  src,
                  List.of(a),
                  List.of(new TableChoice(cancelTable, false, true, List.of())));
          String cancelBefore = db.digest(admin, a, cancelTable);
          var holder = new java.util.concurrent.atomic.AtomicReference<Jobs>();
          try (var cancellable =
              new Jobs(
                  store,
                  db,
                  new Archives(store),
                  event -> {
                    var ev = Json.node(event);
                    if (ev.path("details").path("type").asText().equals("batch-committed"))
                      holder.get().cancel(ev.path("recordId").asText());
                  })) {
            holder.set(cancellable);
            var cancelled =
                await(
                    store,
                    cancellable.save(
                            cancelPlan,
                            cancelPlan.targets.getFirst().changes.stream().map(x -> x.id).toList(),
                            "EXECUTE_AND_SAVE",
                            "")
                        .id);
            assertEquals("PARTIAL", cancelled.status);
            assertEquals(
                2,
                cancelled.results.getFirst().steps.stream()
                    .filter(st -> st.status.equals("DONE"))
                    .count());
            assertEquals(
                "SUCCESS",
                cancellable.rollback(
                        cancelled.id,
                        cancellable.preview(cancelled.id).items.stream()
                            .filter(i -> i.eligible)
                            .map(i -> i.id)
                            .toList(),
                        "")
                    .status);
            assertEquals(cancelBefore, db.digest(admin, a, cancelTable));
          }
          // Duplicate/null keys are blocked by real table contents, including compound business
          // keys.
          String keysTable = "复合匹配";
          for (var rf : List.of(src, a))
            db.execute(
                admin,
                "CREATE TABLE "
                    + Sql.qualified(rf, keysTable)
                    + " (id int PRIMARY KEY,kind varchar(10),code varchar(10),v int)"
                    + " ENGINE=InnoDB");
          db.execute(
              admin,
              "INSERT INTO "
                  + Sql.qualified(src, keysTable)
                  + " VALUES(1,'K','A',10),(2,'K','B',20)");
          db.execute(admin, "INSERT INTO " + Sql.qualified(a, keysTable) + " VALUES(90,'K','A',1)");
          db.execute(admin, "UPDATE " + Sql.qualified(a, keysTable) + " SET code='a' WHERE id=90");
          var composite =
              planner.compare(
                  "default",
                  src,
                  List.of(a),
                  List.of(new TableChoice(keysTable, false, true, List.of("kind", "code"))));
          assertTrue(composite.targets.getFirst().changes.stream().noneMatch(x -> x.blocked));
          assertEquals(
              90,
              ((Number)
                      composite.targets.getFirst().changes.stream()
                          .filter(x -> x.kind.equals("UPDATE_ROW"))
                          .findFirst()
                          .orElseThrow()
                          .after
                          .get("id"))
                  .intValue());
          db.execute(
              admin, "INSERT INTO " + Sql.qualified(src, keysTable) + " VALUES(3,'K','A',30)");
          var duplicate =
              planner.compare(
                  "default",
                  src,
                  List.of(a),
                  List.of(new TableChoice(keysTable, false, true, List.of("kind", "code"))));
          assertTrue(duplicate.targets.getFirst().changes.stream().anyMatch(x -> x.blocked));
          db.execute(admin, "DELETE FROM " + Sql.qualified(src, keysTable) + " WHERE id=3");
          db.execute(
              admin, "UPDATE " + Sql.qualified(src, keysTable) + " SET code=NULL WHERE id=2");
          var nullKey =
              planner.compare(
                  "default",
                  src,
                  List.of(a),
                  List.of(new TableChoice(keysTable, false, true, List.of("kind", "code"))));
          assertTrue(nullKey.targets.getFirst().changes.stream().anyMatch(x -> x.blocked));
          // The Tauri release executable drives its real isolated Rust host and Java engine
          // without system Java.
          if (Boolean.getBoolean("dbaligner.native.smoke") && version.equals("8.4.8")) {
            for (var ref : List.of(src, a)) {
              db.execute(
                  admin,
                  "ALTER TABLE "
                      + Sql.qualified(ref, extTable)
                      + " ADD COLUMN amount DECIMAL(30,9)");
              db.execute(
                  admin,
                  "INSERT INTO "
                      + Sql.qualified(ref, extTable)
                      + " VALUES(9223372036854775807,"
                      + Sql.value(ref.equals(src) ? "新" : "旧")
                      + ","
                      + (ref.equals(src) ? "1234567890.123456789" : "0.123456789")
                      + ")");
            }
            Path release = NativeClientRelease.extract(root.resolve("native-client"));
            Path nativeRoot = root.resolve("native-release");
            Files.createDirectories(nativeRoot);
            Path fixture = nativeRoot.resolve("fixture.json");
            Files.writeString(
                fixture,
                Json.write(
                    Map.of(
                        "connection",
                        config,
                        "password",
                        creds.path("password").asText(),
                        "source",
                        src.database(),
                        "target",
                        a.database(),
                        "bigId",
                        "9223372036854775807",
                        "amount",
                        "1234567890.123456789",
                        "table",
                        extTable)));
            var process =
                new ProcessBuilder(release.toString(), "--smoke-test", "--smoke-fixture=" + fixture)
                    .redirectErrorStream(true)
                    .redirectOutput(nativeRoot.resolve("native.log").toFile());
            process.environment().put("DB_ALIGNER_HOME", nativeRoot.toString());
            process.environment().remove("DB_ALIGNER_DEV");
            process.environment().remove("JAVA_HOME");
            process.environment().put("PATH", System.getenv("SystemRoot") + "\\System32");
            var running = process.start();
            if (!running.waitFor(90, java.util.concurrent.TimeUnit.SECONDS)) {
              running.destroyForcibly();
              throw new AssertionError(
                  "Packaged smoke timeout: " + Files.readString(nativeRoot.resolve("native.log")));
            }
            var resultFile = nativeRoot.resolve("smoke-result.json");
            assertTrue(
                Files.exists(resultFile),
                "Packaged client produced no result (exit "
                    + running.exitValue()
                    + "): "
                    + Files.readString(nativeRoot.resolve("native.log")));
            var smokeResult =
                Json.read(Files.readString(resultFile), com.fasterxml.jackson.databind.JsonNode.class);
            assertEquals(0, running.exitValue(), smokeResult.toString());
            assertTrue(smokeResult.path("passed").asBoolean());
            Path report =
                Path.of("..", "docs", "native-client-smoke-result.json")
                    .toAbsolutePath()
                    .normalize();
            Files.writeString(report, smokeResult.toPrettyString());
          }
          InterruptionProbe.verify(
              db, admin, config, creds, src, a, root.resolve("interruption-" + version));
          // SSL and unsaved connection testing use the same real connector.
          try (var tls = db.open(a)) {
            try (var stmt = tls.createStatement();
                var rs = stmt.executeQuery("SHOW STATUS LIKE 'Ssl_cipher'")) {
              assertTrue(rs.next());
              assertFalse(rs.getString(2).isBlank());
            }
          }
        } finally {
          for (var ref : List.of(src, a, b))
            db.execute(admin, "DROP DATABASE " + Sql.id(ref.database()));
        }
      }
    }
  }

  static void verifyStringLiterals(Database db, Connection connection) throws Exception {
    String previousMode;
    try (var statement = connection.createStatement();
        var result = statement.executeQuery("SELECT @@SESSION.sql_mode")) {
      assertTrue(result.next());
      previousMode = result.getString(1);
    }
    try {
      for (String mode : List.of("", "NO_BACKSLASH_ESCAPES")) {
        db.execute(connection, "SET SESSION sql_mode='" + mode + "'");
        for (String text :
            List.of(
                "myData:outworkMedia",
                "中文菜单😀",
                "O'Reilly",
                "'); DROP TABLE t; --",
                "",
                "a\\b",
                "a\n\r\t\0\u001ab")) {
          try (var statement = connection.createStatement();
              var result = statement.executeQuery("SELECT " + Sql.value(text))) {
            assertTrue(result.next());
            assertEquals(text, result.getString(1), "SQL mode: " + mode);
          }
        }
        try (var statement = connection.createStatement();
            var result =
                statement.executeQuery(
                    "SELECT "
                        + Sql.where(Map.of("name", "a"), List.of("name"))
                        + ", HEX("
                        + Sql.value(Map.of("$binary", "00ff"))
                        + ") FROM (SELECT 'A' COLLATE utf8mb4_general_ci AS name) AS sample")) {
          assertTrue(result.next());
          assertEquals(1, result.getInt(1));
          assertEquals("00FF", result.getString(2));
        }
      }
    } finally {
      db.execute(connection, "SET SESSION sql_mode=" + Sql.value(previousMode));
    }
  }

  static SyncRecord await(Store s, String id) throws Exception {
    long end = System.nanoTime() + java.util.concurrent.TimeUnit.SECONDS.toNanos(60);
    while (System.nanoTime() < end) {
      var r = Json.MAPPER.treeToValue(s.get("record", id), SyncRecord.class);
      if (!List.of("QUEUED", "RUNNING").contains(r.status)) return r;
      Thread.sleep(100);
    }
    throw new AssertionError("Execution timeout " + id);
  }

  /** 目标库零污染：任何阶段都不允许出现引擎创建的 __ds_ 前缀对象。 */
  static void assertNoEngineObjects(Database db, DbRef ref) throws Exception {
    try (var c = db.open(ref);
        var st = c.createStatement();
        var rs = st.executeQuery("SHOW TABLES")) {
      while (rs.next())
        assertFalse(rs.getString(1).startsWith("__ds_"), "目标库不应存在引擎对象: " + rs.getString(1));
    }
  }

  static void localRecoveryCases(
      Store store,
      Database db,
      Jobs jobs,
      Planner planner,
      Connection admin,
      DbRef source,
      DbRef target)
      throws Exception {
    var originalTables = db.tables(target);
    String unkeyed = "local_without_key";
    db.execute(admin, "CREATE TABLE " + Sql.qualified(source, unkeyed) + " (id int) ENGINE=InnoDB");
    db.execute(
        admin,
        "CREATE TABLE " + Sql.qualified(target, unkeyed) + " (id int, lost int) ENGINE=InnoDB");
    var unkeyedPlan =
        planner.compare(
            "default",
            source,
            List.of(target),
            List.of(new TableChoice(unkeyed, true, false, List.of())));
    var blockedDrops =
        unkeyedPlan.targets.getFirst().changes.stream()
            .filter(x -> x.kind.equals("DROP_COLUMN"))
            .toList();
    assertEquals(1, blockedDrops.size());
    assertTrue(blockedDrops.getFirst().blocked);
    db.execute(admin, "DROP TABLE " + Sql.qualified(source, unkeyed));
    db.execute(admin, "DROP TABLE " + Sql.qualified(target, unkeyed));
    for (int count : List.of(0, 20000, 20001)) {
      String table = "local_recovery_" + count;
      db.execute(
          admin,
          "CREATE TABLE " + Sql.qualified(source, table) + " (id int PRIMARY KEY) ENGINE=InnoDB");
      db.execute(
          admin,
          "CREATE TABLE "
              + Sql.qualified(target, table)
              + " (id int PRIMARY KEY, lost varchar(20)) ENGINE=InnoDB");
      admin.setAutoCommit(false);
      try (var insert =
          admin.prepareStatement("INSERT INTO " + Sql.qualified(target, table) + " VALUES (?,?)")) {
        for (int i = 0; i < count; i++) {
          insert.setInt(1, i);
          insert.setString(2, "原值" + i);
          insert.addBatch();
          if (i % 500 == 499) insert.executeBatch();
        }
        insert.executeBatch();
        admin.commit();
      } finally {
        admin.setAutoCommit(true);
      }
      String before = db.digest(admin, target, table);
      var plan =
          planner.compare(
              "default",
              source,
              List.of(target),
              List.of(new TableChoice(table, true, false, List.of())));
      var drop =
          plan.targets.getFirst().changes.stream()
              .filter(x -> x.kind.equals("DROP_COLUMN"))
              .findFirst()
              .orElseThrow();
      var record = await(store, jobs.save(plan, List.of(drop.id), "EXECUTE_AND_SAVE", "本地恢复边界").id);
      assertEquals("SUCCESS", record.status, Json.write(record));
      assertNoEngineObjects(db, target);
      if (count <= 20000) {
        assertEquals(count, record.results.getFirst().recoveryRows.get(table).size());
        assertTrue(jobs.preview(record.id).items.stream().allMatch(x -> x.eligible));
        // Missing rows or digest must block recovery, including a captured empty table.
        var valid = store.get("record", record.id).deepCopy();
        var missing = Json.MAPPER.treeToValue(valid, SyncRecord.class);
        missing.results.getFirst().recoveryDigests.clear();
        store.put("record", record.id, missing);
        assertTrue(jobs.preview(record.id).items.stream().noneMatch(x -> x.eligible));
        store.put("record", record.id, valid);
        assertEquals("SUCCESS", jobs.rollback(record.id, List.of(drop.id), "").status);
        assertEquals(before, db.digest(admin, target, table));
      } else {
        assertFalse(record.results.getFirst().recoveryRows.containsKey(table));
        assertTrue(jobs.preview(record.id).items.stream().noneMatch(x -> x.eligible));
      }
      db.execute(admin, "DROP TABLE " + Sql.qualified(source, table));
      db.execute(admin, "DROP TABLE " + Sql.qualified(target, table));
    }
    String legacy = "legacy_recovery_fixture";
    String backup = "legacy_named_backup";
    db.execute(
        admin,
        "CREATE TABLE " + Sql.qualified(source, legacy) + " (id int PRIMARY KEY) ENGINE=InnoDB");
    db.execute(
        admin,
        "CREATE TABLE "
            + Sql.qualified(target, legacy)
            + " (id int PRIMARY KEY, lost varchar(20)) ENGINE=InnoDB");
    db.execute(admin, "INSERT INTO " + Sql.qualified(target, legacy) + " VALUES (1,'历史原值')");
    String legacyBefore = db.digest(admin, target, legacy);
    var legacyPlan =
        planner.compare(
            "default",
            source,
            List.of(target),
            List.of(new TableChoice(legacy, true, false, List.of())));
    var legacyDrop =
        legacyPlan.targets.getFirst().changes.stream()
            .filter(x -> x.kind.equals("DROP_COLUMN"))
            .findFirst()
            .orElseThrow();
    var legacyRecord =
        await(store, jobs.save(legacyPlan, List.of(legacyDrop.id), "EXECUTE_AND_SAVE", "").id);
    // Historical backup is a fixture created by the test, never by the new synchronization path.
    db.execute(
        admin,
        "CREATE TABLE "
            + Sql.qualified(target, backup)
            + " (id int PRIMARY KEY, lost varchar(20)) ENGINE=InnoDB");
    db.execute(admin, "INSERT INTO " + Sql.qualified(target, backup) + " VALUES (1,'历史原值')");
    legacyRecord.recoveryFormat = "";
    legacyRecord.results.getFirst().backups.put(legacy, backup);
    legacyRecord.results.getFirst().backupDigests.put(legacy, db.digest(admin, target, backup));
    legacyRecord.results.getFirst().recoveryRows.clear();
    store.put("record", legacyRecord.id, legacyRecord);
    assertTrue(
        jobs.preview(legacyRecord.id).items.getFirst().sql.stream()
            .anyMatch(sql -> sql.contains(Sql.id(backup))));
    db.execute(admin, "UPDATE " + Sql.qualified(target, backup) + " SET lost='被篡改'");
    assertFalse(jobs.preview(legacyRecord.id).items.getFirst().eligible);
    db.execute(admin, "UPDATE " + Sql.qualified(target, backup) + " SET lost='历史原值'");
    assertEquals("SUCCESS", jobs.rollback(legacyRecord.id, List.of(legacyDrop.id), "").status);
    assertEquals(legacyBefore, db.digest(admin, target, legacy));
    db.execute(admin, "DROP TABLE " + Sql.qualified(target, backup));
    var externalPlan =
        planner.compare(
            "default",
            source,
            List.of(target),
            List.of(new TableChoice(legacy, true, false, List.of())));
    var externalDrop =
        externalPlan.targets.getFirst().changes.stream()
            .filter(x -> x.kind.equals("DROP_COLUMN"))
            .findFirst()
            .orElseThrow();
    var externalRecord = jobs.save(externalPlan, List.of(externalDrop.id), "SAVE_ONLY", "旧外部记录兼容");
    externalRecord.recoveryFormat = "";
    store.put("record", externalRecord.id, externalRecord);
    var external = new External(store, db, new Archives(store));
    external.declare(externalRecord.id, List.of(externalDrop.id), true, "旧脚本声明");
    assertFalse(Json.node(external.verify(externalRecord.id)).path("verified").asBoolean());
    String legacyBackup = Archives.backupName(externalRecord.id, target.key(), legacy);
    String legacyPost = Archives.postName(externalRecord.id, target.key(), legacy);
    String receipt = Archives.receiptName(externalRecord.id);
    db.execute(
        admin,
        "CREATE TABLE "
            + Sql.qualified(target, legacyBackup)
            + " LIKE "
            + Sql.qualified(target, legacy));
    db.execute(
        admin,
        "INSERT INTO "
            + Sql.qualified(target, legacyBackup)
            + " SELECT * FROM "
            + Sql.qualified(target, legacy));
    db.execute(admin, externalDrop.sql);
    db.execute(
        admin,
        "CREATE TABLE "
            + Sql.qualified(target, legacyPost)
            + " LIKE "
            + Sql.qualified(target, legacy));
    db.execute(
        admin,
        "INSERT INTO "
            + Sql.qualified(target, legacyPost)
            + " SELECT * FROM "
            + Sql.qualified(target, legacy));
    db.execute(
        admin,
        "CREATE TABLE "
            + Sql.qualified(target, receipt)
            + " (stage varchar(20), record_id varchar(80), plan_hash varchar(80)) ENGINE=InnoDB");
    for (String stage : List.of("prepared", "applied"))
      db.execute(
          admin,
          "INSERT INTO "
              + Sql.qualified(target, receipt)
              + " VALUES ("
              + Sql.value(stage)
              + ","
              + Sql.value(externalRecord.id)
              + ","
              + Sql.value(Json.hash(externalPlan))
              + ")");
    external.declare(externalRecord.id, List.of(externalDrop.id), false, "未确认旧备份步骤");
    assertFalse(Json.node(external.verify(externalRecord.id)).path("verified").asBoolean());
    external.declare(externalRecord.id, List.of(externalDrop.id), true, "已完成旧步骤");
    assertTrue(Json.node(external.verify(externalRecord.id)).path("verified").asBoolean());
    assertEquals("SUCCESS", jobs.rollback(externalRecord.id, List.of(externalDrop.id), "").status);
    assertEquals(legacyBefore, db.digest(admin, target, legacy));
    for (String object : List.of(legacyBackup, legacyPost, receipt))
      db.execute(admin, "DROP TABLE " + Sql.qualified(target, object));
    // Archive write failure must leave the target untouched.
    var failingPlan =
        planner.compare(
            "default",
            source,
            List.of(target),
            List.of(new TableChoice(legacy, true, false, List.of())));
    var failingDrop =
        failingPlan.targets.getFirst().changes.stream()
            .filter(x -> x.kind.equals("DROP_COLUMN"))
            .findFirst()
            .orElseThrow();
    try (var failingJobs =
        new Jobs(
            store,
            db,
            new Archives(store),
            value -> {
              var event = Json.node(value);
              if (event.path("details").path("type").asText().equals("target-started")) {
                try {
                  Path archive =
                      Path.of(
                          store
                              .get("record", event.path("recordId").asText())
                              .path("archivePath")
                              .asText());
                  try (var folders = Files.list(archive)) {
                    Files.createDirectory(
                        folders
                            .filter(Files::isDirectory)
                            .findFirst()
                            .orElseThrow()
                            .resolve("recovery.json"));
                  }
                } catch (Exception ex) {
                  throw new RuntimeException(ex);
                }
              }
            })) {
      var failed =
          await(
              store,
              failingJobs.save(failingPlan, List.of(failingDrop.id), "EXECUTE_AND_SAVE", "").id);
      assertEquals("FAILED", failed.status);
      assertEquals(legacyBefore, db.digest(admin, target, legacy));
      assertTrue(jobs.preview(failed.id).items.isEmpty());
    }
    db.execute(admin, "DROP TABLE " + Sql.qualified(source, legacy));
    db.execute(admin, "DROP TABLE " + Sql.qualified(target, legacy));
    assertEquals(originalTables, db.tables(target));
  }
}
