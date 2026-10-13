package io.dbaligner;

import static io.dbaligner.Model.*;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

class UpdateIntegrationTest {
  @TempDir Path root;

  @TestFactory
  Collection<DynamicTest> servers() {
    String versions = System.getProperty("dbaligner.mysql.versions", "");
    if (versions.isBlank())
      return List.of(
          DynamicTest.dynamicTest(
              "Real update tests not requested", () -> Assumptions.assumeTrue(false)));
    return Arrays.stream(versions.split(","))
        .map(
            version ->
                DynamicTest.dynamicTest("Update admission / MySQL " + version, () -> run(version)))
        .toList();
  }

  void run(String version) throws Exception {
    Path base = Path.of("..", ".tools", "mysql-test", version).toAbsolutePath().normalize();
    var credentials = Json.read(Files.readString(base.resolve("credentials.json")), JsonNode.class);
    String prefix =
        "ds_it_update_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    var source = new DbRef("server", prefix + "_s");
    var target = new DbRef("server", prefix + "_t");
    var secrets = Json.node(Map.of("server", credentials.path("password").asText()));
    try (var service = new Service(root.resolve(version), event -> {})) {
      var config =
          Json.node(
              Map.of(
                  "id",
                  "server",
                  "host",
                  "127.0.0.1",
                  "port",
                  credentials.path("port").asInt(),
                  "user",
                  "root",
                  "ssl",
                  true,
                  "ca",
                  base.resolve("server-cert.pem").toString()));
      service.store.put("connection", "server", config);
      var db = new Database(service.store);
      db.secrets(secrets);
      try (var admin = db.open(new DbRef("server", ""));
          var lock = db.open(new DbRef("server", ""));
          var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        for (var ref : List.of(source, target)) {
          db.execute(
              admin,
              "CREATE DATABASE "
                  + Sql.id(ref.database())
                  + " CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci");
        }
        try {
          for (var ref : List.of(source, target)) {
            db.execute(
                admin,
                "CREATE TABLE "
                    + Sql.qualified(ref, "dict")
                    + " (id int PRIMARY KEY, value varchar(50)) ENGINE=InnoDB");
            db.execute(
                admin,
                "CREATE TABLE "
                    + Sql.qualified(ref, "untouched")
                    + " (id int PRIMARY KEY) ENGINE=InnoDB");
            db.execute(admin, "INSERT INTO " + Sql.qualified(ref, "untouched") + " VALUES(7)");
          }
          db.execute(admin, "INSERT INTO " + Sql.qualified(source, "dict") + " VALUES(1,'new')");
          db.execute(admin, "INSERT INTO " + Sql.qualified(target, "dict") + " VALUES(1,'old')");
          String unselected = db.digest(admin, target, "untouched");
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
                      List.of(new TableChoice("dict", false, true, List.of("id"))),
                      "$secrets",
                      secrets));
          var plan =
              Json.MAPPER.convertValue(service.handle("sync.compare", params), SyncPlan.class);
          var selected =
              plan.targets.getFirst().changes.stream()
                  .filter(change -> !change.blocked)
                  .map(change -> change.id)
                  .toList();
          assertFalse(selected.isEmpty());
          db.execute(lock, "LOCK TABLES " + Sql.qualified(target, "dict") + " WRITE");
          SyncRecord record;
          try {
            record =
                Json.MAPPER.convertValue(
                    service.handle(
                        "sync.save",
                        Json.node(
                            Map.of(
                                "planId",
                                plan.id,
                                "selectedIds",
                                selected,
                                "mode",
                                "EXECUTE_AND_SAVE",
                                "$secrets",
                                secrets))),
                    SyncRecord.class);
            assertTrue(List.of("RUNNING", "QUEUED").contains(record.status));
            assertThrows(
                IllegalArgumentException.class,
                () -> service.handle("engine.prepareUpdate", Json.node(Map.of())));
            assertNotNull(service.handle("ping", Json.node(Map.of())));
          } finally {
            db.execute(lock, "UNLOCK TABLES");
          }
          assertEquals("SUCCESS", ComparisonIntegrationTest.waitRecord(service, record.id).status);
          assertEquals(db.digest(admin, source, "dict"), db.digest(admin, target, "dict"));
          assertEquals(unselected, db.digest(admin, target, "untouched"));
          var rollback =
              Json.MAPPER.convertValue(
                  service.handle(
                      "rollback.preview", Json.node(Map.of("id", record.id, "$secrets", secrets))),
                  RollbackPlan.class);
          db.execute(lock, "LOCK TABLES " + Sql.qualified(target, "dict") + " WRITE");
          Future<Object> restoring = null;
          try {
            restoring =
                executor.submit(
                    () ->
                        service.handle(
                            "rollback.execute",
                            Json.node(
                                Map.of(
                                    "id",
                                    record.id,
                                    "selectedIds",
                                    rollback.items.stream()
                                        .filter(item -> item.eligible)
                                        .map(item -> item.id)
                                        .toList(),
                                    "$secrets",
                                    secrets))));
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (ComparisonIntegrationTest.processCount(admin, target.database()) == 0
                && System.nanoTime() < deadline) Thread.sleep(20);
            assertTrue(ComparisonIntegrationTest.processCount(admin, target.database()) > 0);
            assertThrows(
                IllegalArgumentException.class,
                () -> service.handle("engine.prepareUpdate", Json.node(Map.of())));
          } finally {
            db.execute(lock, "UNLOCK TABLES");
          }
          assertEquals(
              "SUCCESS", Json.node(restoring.get(30, TimeUnit.SECONDS)).path("status").asText());
          assertEquals(unselected, db.digest(admin, target, "untouched"));
          assertEquals(
              Map.of("prepared", true),
              service.handle("engine.prepareUpdate", Json.node(Map.of())));
          assertThrows(
              IllegalArgumentException.class, () -> service.handle("sync.compare", params));
          service.handle("engine.resumeUpdate", Json.node(Map.of()));
          assertNotNull(service.handle("state.load", Json.node(Map.of())));
        } finally {
          for (var ref : List.of(source, target))
            db.execute(admin, "DROP DATABASE IF EXISTS " + Sql.id(ref.database()));
        }
      }
    }
  }
}
