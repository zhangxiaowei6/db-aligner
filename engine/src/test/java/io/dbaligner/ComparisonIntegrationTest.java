package io.dbaligner;

import static io.dbaligner.Model.*;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

class ComparisonIntegrationTest {
  @TempDir Path root;

  @TestFactory
  Collection<DynamicTest> supportedServers() {
    String versions = System.getProperty("dbaligner.mysql.versions", "");
    if (versions.isBlank())
      return List.of(
          DynamicTest.dynamicTest(
              "Real comparison tests not requested", () -> Assumptions.assumeTrue(false)));
    return Arrays.stream(versions.split(","))
        .map(
            version -> DynamicTest.dynamicTest("Comparison / MySQL " + version, () -> run(version)))
        .toList();
  }

  void run(String version) throws Exception {
    Path base = Path.of("..", ".tools", "mysql-test", version).toAbsolutePath().normalize();
    var credentials = Json.read(Files.readString(base.resolve("credentials.json")), JsonNode.class);
    String prefix = "ds_it_cmp_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    var source = new DbRef("server", prefix + "_s");
    var target = new DbRef("server", prefix + "_t");
    var secondTarget = new DbRef("server", prefix + "_t2");
    var holder = new AtomicReference<Service>();
    var cancelOnRows = new AtomicBoolean(false);
    var readEvents = new AtomicInteger();
    var cancelAt = new AtomicLong();
    var subsequentRead = new AtomicBoolean();
    var events = new CopyOnWriteArrayList<JsonNode>();
    try (var service =
        new Service(
            root.resolve(version),
            value -> {
              var event = Json.node(value);
              if (!event.path("event").asText().equals("compare-progress")) return;
              events.add(event);
              if (event.path("progress").path("rows").asInt() >= 50
                  && cancelOnRows.compareAndSet(true, false)) {
                cancelAt.set(System.nanoTime());
                try {
                  holder
                      .get()
                      .handle(
                          "sync.compare.cancel",
                          Json.node(Map.of("compareId", event.path("compareId").asText())));
                } catch (Exception e) {
                  throw new RuntimeException(e);
                }
              }
              if (event.path("progress").path("phase").asText().equals("读取数据")) {
                readEvents.incrementAndGet();
                if (event.path("progress").path("table").asText().equals("later"))
                  subsequentRead.set(true);
              }
            })) {
      holder.set(service);
      var config = Json.MAPPER.createObjectNode();
      config.put("id", "server");
      config.put("name", "Isolated test");
      config.put("host", credentials.path("host").asText());
      config.put("port", credentials.path("port").asInt());
      config.put("user", "root");
      config.put("ssl", true);
      config.put("ca", base.resolve("server-cert.pem").toString());
      service.store.put("connection", "server", config);
      var db = new Database(service.store);
      var secrets = Json.node(Map.of("server", credentials.path("password").asText()));
      db.secrets(secrets);
      try (var admin = db.open(new DbRef("server", ""))) {
        for (var ref : List.of(source, target, secondTarget))
          db.execute(
              admin,
              "CREATE DATABASE "
                  + Sql.id(ref.database())
                  + " CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci");
        try {
          db.execute(
              admin,
              "CREATE TABLE "
                  + Sql.qualified(source, "dict")
                  + " (`id` int NOT NULL COMMENT 'source id', `value` varchar(100) DEFAULT 'source"
                  + " default' COMMENT 'source COMMENT text', PRIMARY KEY(id)) ENGINE=InnoDB");
          db.execute(
              admin,
              "CREATE TABLE "
                  + Sql.qualified(target, "dict")
                  + " (`value` varchar(20) DEFAULT 'target default' COMMENT 'target text', `id` int"
                  + " NOT NULL COMMENT 'target id', PRIMARY KEY(id)) ENGINE=InnoDB");
          for (var ref : List.of(source, target))
            db.execute(
                admin,
                "INSERT INTO " + Sql.qualified(ref, "dict") + " (id,value) VALUES(1,'same')");
          var options = ComparisonTest.onlyComments();
          var params =
              Json.node(
                  Map.of(
                      "workspaceId",
                      "default",
                      "source",
                      source,
                      "targets",
                      List.of(target),
                      "tables",
                      List.of(new TableChoice("dict", true, false, List.of(), options)),
                      "$secrets",
                      secrets));
          var plan =
              Json.MAPPER.convertValue(service.handle("sync.compare", params), SyncPlan.class);
          assertEquals(2, plan.targets.getFirst().changes.size());
          assertTrue(plan.targets.getFirst().changes.stream().allMatch(Change::commentOnly));
          assertTrue(
              plan.targets.getFirst().changes.stream().allMatch(c -> c.selected && !c.blocked));
          assertTrue(
              events.stream()
                  .anyMatch(e -> e.path("progress").path("phase").asText().equals("读取源表结构")));
          var before = db.snapshot(admin, target, "dict", false);
          var record =
              Json.MAPPER.convertValue(
                  service.handle(
                      "sync.save",
                      Json.node(
                          Map.of(
                              "planId",
                              plan.id,
                              "selectedIds",
                              plan.targets.getFirst().changes.stream().map(c -> c.id).toList(),
                              "mode",
                              "EXECUTE_AND_SAVE",
                              "remark",
                              "comparison acceptance",
                              "$secrets",
                              secrets))),
                  SyncRecord.class);
          var executed = waitRecord(service, record.id);
          assertEquals("SUCCESS", executed.status, Json.write(executed));
          var actual = db.snapshot(admin, target, "dict", false);
          assertEquals(List.of("value", "id"), actual.columns.stream().map(Column::name).toList());
          assertEquals("varchar(20)", actual.columns.getFirst().type());
          assertEquals("target default", actual.columns.getFirst().defaultValue());
          assertEquals("source COMMENT text", actual.columns.getFirst().comment());
          var verification =
              Json.node(
                  service.handle(
                      "record.verify", Json.node(Map.of("id", record.id, "$secrets", secrets))));
          assertEquals(2, verification.path("checks").size());
          for (var check : verification.path("checks"))
            assertEquals("符合变更后的状态", check.path("currentState").asText());
          var rollback =
              Json.MAPPER.convertValue(
                  service.handle(
                      "rollback.preview", Json.node(Map.of("id", record.id, "$secrets", secrets))),
                  RollbackPlan.class);
          assertTrue(rollback.items.stream().allMatch(i -> i.eligible));
          var restored =
              Json.MAPPER.convertValue(
                  service.handle(
                      "rollback.execute",
                      Json.node(
                          Map.of(
                              "id",
                              record.id,
                              "selectedIds",
                              rollback.items.stream().map(i -> i.id).toList(),
                              "$secrets",
                              secrets))),
                  SyncRecord.class);
          assertEquals("SUCCESS", waitRecord(service, restored.id).status);
          assertEquals(
              Sql.schemaHash(before), Sql.schemaHash(db.snapshot(admin, target, "dict", false)));

          // Selected definitions change type/default, keep target comments and order, and append
          // fields.
          db.execute(
              admin,
              "ALTER TABLE "
                  + Sql.qualified(source, "dict")
                  + " ADD COLUMN `extra` int DEFAULT 0 COMMENT 'do not copy' FIRST");
          var definitions =
              Json.node(
                  Map.of(
                      "workspaceId",
                      "default",
                      "source",
                      source,
                      "targets",
                      List.of(target),
                      "tables",
                      List.of(
                          new TableChoice(
                              "dict",
                              true,
                              false,
                              List.of(),
                              new StructureOptions(
                                  true, false, false, false, false, false, false))),
                      "$secrets",
                      secrets));
          plan =
              Json.MAPPER.convertValue(service.handle("sync.compare", definitions), SyncPlan.class);
          assertFalse(plan.targets.getFirst().changes.stream().anyMatch(c -> c.blocked));
          record =
              Json.MAPPER.convertValue(
                  service.handle(
                      "sync.save",
                      Json.node(
                          Map.of(
                              "planId",
                              plan.id,
                              "selectedIds",
                              plan.targets.getFirst().changes.stream().map(c -> c.id).toList(),
                              "mode",
                              "EXECUTE_AND_SAVE",
                              "$secrets",
                              secrets))),
                  SyncRecord.class);
          assertEquals("SUCCESS", waitRecord(service, record.id).status);
          actual = db.snapshot(admin, target, "dict", false);
          assertEquals(
              List.of("value", "id", "extra"), actual.columns.stream().map(Column::name).toList());
          assertEquals("varchar(100)", actual.columns.getFirst().type());
          assertEquals("source default", actual.columns.getFirst().defaultValue());
          assertEquals("target text", actual.columns.getFirst().comment());
          assertEquals("", actual.columns.getLast().comment());
          verification =
              Json.node(
                  service.handle(
                      "record.verify", Json.node(Map.of("id", record.id, "$secrets", secrets))));
          for (var check : verification.path("checks"))
            assertEquals("符合变更后的状态", check.path("currentState").asText());
          rollback =
              Json.MAPPER.convertValue(
                  service.handle(
                      "rollback.preview", Json.node(Map.of("id", record.id, "$secrets", secrets))),
                  RollbackPlan.class);
          restored =
              Json.MAPPER.convertValue(
                  service.handle(
                      "rollback.execute",
                      Json.node(
                          Map.of(
                              "id",
                              record.id,
                              "selectedIds",
                              rollback.items.stream().map(i -> i.id).toList(),
                              "$secrets",
                              secrets))),
                  SyncRecord.class);
          assertEquals("SUCCESS", waitRecord(service, restored.id).status);
          assertEquals(
              Sql.schemaHash(before), Sql.schemaHash(db.snapshot(admin, target, "dict", false)));
          db.execute(
              admin, "ALTER TABLE " + Sql.qualified(source, "dict") + " ADD INDEX ix_extra(extra)");
          var indexParams =
              Json.node(
                  Map.of(
                      "workspaceId",
                      "default",
                      "source",
                      source,
                      "targets",
                      List.of(target),
                      "tables",
                      List.of(
                          new TableChoice(
                              "dict",
                              true,
                              false,
                              List.of(),
                              new StructureOptions(
                                  false, false, false, false, true, false, false))),
                      "$secrets",
                      secrets));
          plan =
              Json.MAPPER.convertValue(service.handle("sync.compare", indexParams), SyncPlan.class);
          assertEquals(1, plan.targets.getFirst().changes.size());
          assertTrue(plan.targets.getFirst().changes.getFirst().blocked);
          assertEquals("ADD_INDEX", plan.targets.getFirst().changes.getFirst().kind);
          db.execute(
              admin,
              "CREATE TABLE "
                  + Sql.qualified(source, "missing")
                  + " (id int PRIMARY KEY) ENGINE=InnoDB");
          var missingParams =
              Json.node(
                  Map.of(
                      "workspaceId",
                      "default",
                      "source",
                      source,
                      "targets",
                      List.of(target),
                      "tables",
                      List.of(
                          new TableChoice("missing", true, false, List.of(), options),
                          new TableChoice("dict", true, false, List.of(), options)),
                      "$secrets",
                      secrets));
          plan =
              Json.MAPPER.convertValue(
                  service.handle("sync.compare", missingParams), SyncPlan.class);
          assertTrue(
              plan.targets.getFirst().changes.stream()
                  .filter(c -> c.table.equals("missing"))
                  .allMatch(c -> c.blocked));
          assertTrue(
              plan.targets.getFirst().changes.stream()
                  .anyMatch(c -> c.table.equals("dict") && c.commentOnly()));

          db.execute(admin, "INSERT INTO " + Sql.qualified(source, "missing") + " VALUES (1),(2)");
          // Data mode skips missing tables per target, while shared tables still execute.
          for (var ref : List.of(source, target, secondTarget))
            db.execute(
                admin,
                "CREATE TABLE "
                    + Sql.qualified(ref, "shared")
                    + " (id int PRIMARY KEY, value varchar(20)) ENGINE=InnoDB");
          db.execute(
              admin, "INSERT INTO " + Sql.qualified(source, "shared") + " VALUES (1,'source')");
          db.execute(
              admin,
              "CREATE TABLE "
                  + Sql.qualified(secondTarget, "missing")
                  + " (id int PRIMARY KEY) ENGINE=InnoDB");
          var dataParams =
              Json.node(
                  Map.of(
                      "workspaceId",
                      "default",
                      "source",
                      source,
                      "targets",
                      List.of(target, secondTarget),
                      "tables",
                      List.of(
                          new TableChoice("missing", false, true, List.of()),
                          new TableChoice("shared", false, true, List.of())),
                      "$secrets",
                      secrets));
          var dataPlan =
              Json.MAPPER.convertValue(service.handle("sync.compare", dataParams), SyncPlan.class);
          assertEquals(List.of("missing"), dataPlan.targets.getFirst().skippedTables);
          assertTrue(dataPlan.targets.getLast().skippedTables.isEmpty());
          assertTrue(
              dataPlan.targets.getFirst().changes.stream().allMatch(x -> x.table.equals("shared")));
          assertTrue(dataPlan.targets.stream().allMatch(t -> t.error.isEmpty()));
          assertTrue(
              dataPlan.targets.stream()
                  .flatMap(t -> t.changes.stream())
                  .allMatch(x -> x.kind.endsWith("_ROW") && !x.blocked));
          var dataRecord =
              Json.MAPPER.convertValue(
                  service.handle(
                      "sync.save",
                      Json.node(
                          Map.of(
                              "planId",
                              dataPlan.id,
                              "selectedIds",
                              dataPlan.targets.stream()
                                  .flatMap(t -> t.changes.stream())
                                  .map(x -> x.id)
                                  .toList(),
                              "mode",
                              "EXECUTE_AND_SAVE",
                              "$secrets",
                              secrets))),
                  SyncRecord.class);
          assertEquals("SUCCESS", waitRecord(service, dataRecord.id).status);
          assertFalse(db.snapshot(admin, target, "missing", false).exists);
          assertEquals(2, db.snapshot(admin, secondTarget, "missing", true).rows.size());
          for (var ref : List.of(target, secondTarget))
            assertEquals(
                "source", db.snapshot(admin, ref, "shared", true).rows.getFirst().get("value"));
          var skipOnlyParams = dataParams.deepCopy();
          ((com.fasterxml.jackson.databind.node.ObjectNode) skipOnlyParams)
              .set("targets", Json.node(List.of(target)));
          ((com.fasterxml.jackson.databind.node.ObjectNode) skipOnlyParams)
              .set(
                  "tables", Json.node(List.of(new TableChoice("missing", false, true, List.of()))));
          var skipOnly =
              Json.MAPPER.convertValue(
                  service.handle("sync.compare", skipOnlyParams), SyncPlan.class);
          assertEquals(List.of("missing"), skipOnly.targets.getFirst().skippedTables);
          assertTrue(skipOnly.targets.getFirst().changes.isEmpty());

          var completeMissing =
              Json.node(
                  Map.of(
                      "workspaceId",
                      "default",
                      "source",
                      source,
                      "targets",
                      List.of(target),
                      "tables",
                      List.of(
                          new TableChoice(
                              "missing", true, false, List.of(), StructureOptions.all())),
                      "$secrets",
                      secrets));
          var completePlan =
              Json.MAPPER.convertValue(
                  service.handle("sync.compare", completeMissing), SyncPlan.class);
          var missingChanges = completePlan.targets.getFirst().changes;
          assertTrue(missingChanges.stream().noneMatch(x -> x.blocked), Json.write(completePlan));
          assertEquals(
              1, missingChanges.stream().filter(x -> x.kind.equals("CREATE_TABLE")).count());
          assertEquals(0, missingChanges.stream().filter(x -> x.kind.endsWith("_ROW")).count());
          var missingRecord =
              Json.MAPPER.convertValue(
                  service.handle(
                      "sync.save",
                      Json.node(
                          Map.of(
                              "planId",
                              completePlan.id,
                              "selectedIds",
                              missingChanges.stream().map(x -> x.id).toList(),
                              "mode",
                              "EXECUTE_AND_SAVE"))),
                  SyncRecord.class);
          assertEquals("SUCCESS", waitRecord(service, missingRecord.id).status);
          assertEquals(0, db.snapshot(admin, target, "missing", true).rows.size());
          MySqlIntegrationTest.assertNoEngineObjects(db, target);

          // Metadata-lock wait proves cancellation reaches JDBC, rather than waiting for the next
          // table.
          var lockParams = params.deepCopy();
          ((com.fasterxml.jackson.databind.node.ObjectNode) lockParams.path("tables").get(0))
              .put("structure", false)
              .put("data", true);
          db.execute(admin, "LOCK TABLES " + Sql.qualified(source, "dict") + " WRITE");
          String id;
          try {
            id =
                Json.node(service.handle("sync.compare.start", lockParams))
                    .path("compareId")
                    .asText();
            long waitDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
            while (processCount(admin, source.database()) == 0 && System.nanoTime() < waitDeadline)
              Thread.sleep(20);
            assertTrue(processCount(admin, source.database()) > 0);
            long started = System.nanoTime();
            service.handle("sync.compare.cancel", Json.node(Map.of("compareId", id)));
            var stopped = waitTask(service, id);
            assertEquals("CANCELLED", stopped.path("status").asText());
            assertFalse(stopped.has("plan"));
            assertTrue(
                System.nanoTime() - started < TimeUnit.SECONDS.toNanos(5),
                "Lock-wait cancellation exceeded 5 seconds");
            awaitNoProcess(admin, source.database());
          } finally {
            db.execute(admin, "UNLOCK TABLES");
          }

          // Streaming read + unselected/next-table checks.
          for (var ref : List.of(source, target)) {
            db.execute(
                admin,
                "CREATE TABLE "
                    + Sql.qualified(ref, "many")
                    + " (id int PRIMARY KEY, value varchar(1000)) ENGINE=InnoDB");
            db.execute(
                admin,
                "CREATE TABLE "
                    + Sql.qualified(ref, "later")
                    + " (id int PRIMARY KEY) ENGINE=InnoDB");
          }
          for (int batch = 0; batch < 20; batch++) {
            var values = new ArrayList<String>();
            for (int row = 1; row <= 500; row++)
              values.add("(" + (batch * 500 + row) + ",REPEAT('x',1000))");
            db.execute(
                admin,
                "INSERT INTO "
                    + Sql.qualified(source, "many")
                    + " VALUES"
                    + String.join(",", values));
          }
          String digest = db.digest(admin, source, "many");
          var readParams =
              Json.node(
                  Map.of(
                      "workspaceId",
                      "default",
                      "source",
                      source,
                      "targets",
                      List.of(target),
                      "tables",
                      List.of(
                          new TableChoice("many", false, true, List.of()),
                          new TableChoice("later", false, true, List.of()),
                          new TableChoice("not_selected", false, false, List.of())),
                      "$secrets",
                      secrets));
          cancelOnRows.set(true);
          id =
              Json.node(service.handle("sync.compare.start", readParams))
                  .path("compareId")
                  .asText();
          var stopped = waitTask(service, id);
          assertEquals("CANCELLED", stopped.path("status").asText());
          assertFalse(stopped.has("plan"));
          assertTrue(cancelAt.get() != 0, "No streaming row event received");
          assertFalse(subsequentRead.get());
          assertEquals(digest, db.digest(admin, source, "many"));
          awaitNoProcess(admin, source.database());
          assertNotNull(service.handle("ping", Json.node(Map.of())));
          var structureOnly = params.deepCopy();
          ((com.fasterxml.jackson.databind.node.ObjectNode) structureOnly.path("tables").get(0))
              .put("data", false);
          int readsBefore = readEvents.get();
          id =
              Json.node(service.handle("sync.compare.start", structureOnly))
                  .path("compareId")
                  .asText();
          assertEquals("COMPLETED", waitTask(service, id).path("status").asText());
          assertEquals(readsBefore, readEvents.get());
          var invalid = params.deepCopy();
          ((com.fasterxml.jackson.databind.node.ObjectNode)
                  invalid.path("tables").get(0).path("structureOptions"))
              .remove("columns");
          assertThrows(
              IllegalArgumentException.class, () -> service.handle("sync.compare.start", invalid));
        } finally {
          db.execute(admin, "UNLOCK TABLES");
          for (var ref : List.of(source, target, secondTarget))
            db.execute(admin, "DROP DATABASE " + Sql.id(ref.database()));
        }
      }
    }
  }

  static JsonNode waitTask(Service service, String id) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10);
    JsonNode value;
    do {
      Thread.sleep(20);
      value = Json.node(service.handle("sync.compare.get", Json.node(Map.of("compareId", id))));
    } while (List.of("RUNNING", "CANCELLING").contains(value.path("status").asText())
        && System.nanoTime() < deadline);
    assertFalse(List.of("RUNNING", "CANCELLING").contains(value.path("status").asText()));
    return value;
  }

  static SyncRecord waitRecord(Service service, String id) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(20);
    SyncRecord record;
    do {
      Thread.sleep(20);
      record =
          Json.MAPPER.treeToValue(
              Json.node(service.handle("record.get", Json.node(Map.of("id", id)))).path("record"),
              SyncRecord.class);
    } while (List.of("RUNNING", "QUEUED").contains(record.status) && System.nanoTime() < deadline);
    return record;
  }

  static int processCount(Connection admin, String database) throws Exception {
    try (var statement =
        admin.prepareStatement("SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE DB=?")) {
      statement.setString(1, database);
      try (var result = statement.executeQuery()) {
        result.next();
        return result.getInt(1);
      }
    }
  }

  static void awaitNoProcess(Connection admin, String database) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
    while (processCount(admin, database) > 0 && System.nanoTime() < deadline) Thread.sleep(20);
    assertEquals(0, processCount(admin, database), "Comparison session remained open");
  }
}
