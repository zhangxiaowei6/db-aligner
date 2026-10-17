package io.dbaligner;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.*;
import java.sql.DriverManager;
import java.util.*;
import java.util.zip.ZipFile;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class RecordManagementTest {
  @TempDir Path root;

  @Test
  void pendingCleanupIsVisibleAndCanRetryAfterWindowsFileLockCloses() throws Exception {
    org.junit.jupiter.api.Assumptions.assumeTrue(
        System.getProperty("os.name").startsWith("Windows"));
    Path staged;
    try (var store = new Store(root)) {
      Path folder = record(store, "SYNC-one", "p", "");
      String token = UUID.randomUUID().toString();
      staged = folder.resolveSibling(".dbaligner-delete-SYNC-one-" + token);
      store.put(
          "recordDeletion",
          "SYNC-one",
          Map.of(
              "id",
              "SYNC-one",
              "original",
              folder.toString(),
              "staged",
              staged.toString(),
              "token",
              token));
      Files.move(folder, staged);
      store.transaction(
          () -> {
            store.deleteRecordData("SYNC-one", "p");
            return null;
          });
    }
    try (var locked =
            java.nio.channels.FileChannel.open(
                staged.resolve("record.json"),
                StandardOpenOption.READ,
                com.sun.nio.file.ExtendedOpenOption.NOSHARE_DELETE);
        var service = new Service(root, ignored -> {})) {
      var state = Json.node(service.handle("state.load", Json.node(Map.of())));
      assertEquals(1, state.path("pendingDeletions").size());
      assertThrows(
          IllegalArgumentException.class,
          () ->
              service.handle(
                  "backup.export",
                  Json.node(Map.of("destination", root.resolve("unsafe.zip").toString()))));
      assertTrue(
          Json.node(
                  service.handle(
                      "record.delete",
                      Json.node(Map.of("id", "SYNC-one", "confirmation", "SYNC-one"))))
              .path("cleanupPending")
              .asBoolean());
      locked.close();
      assertFalse(
          Json.node(
                  service.handle(
                      "record.delete",
                      Json.node(Map.of("id", "SYNC-one", "confirmation", "SYNC-one"))))
              .path("cleanupPending")
              .asBoolean());
      assertFalse(Files.exists(staged));
    }
  }

  @Test
  void rejectsWindowsJunctionWithoutDeletingItsTarget() throws Exception {
    org.junit.jupiter.api.Assumptions.assumeTrue(
        System.getProperty("os.name").startsWith("Windows"));
    try (var service = new Service(root, ignored -> {})) {
      Path folder = record(service.store, "SYNC-one", "p", "");
      Path outside = root.resolve("outside");
      Files.createDirectories(outside);
      Files.writeString(outside.resolve("keep.txt"), "保留");
      Path junction = folder.resolve("linked");
      var process =
          new ProcessBuilder(
                  "cmd.exe", "/c", "mklink", "/J", junction.toString(), outside.toString())
              .redirectErrorStream(true)
              .start();
      process.getInputStream().readAllBytes();
      assertEquals(0, process.waitFor(), "隔离测试 junction 创建失败");
      try {
        assertThrows(
            IllegalArgumentException.class,
            () ->
                service.handle(
                    "record.delete",
                    Json.node(Map.of("id", "SYNC-one", "confirmation", "SYNC-one"))));
        assertEquals("保留", Files.readString(outside.resolve("keep.txt")));
        assertNotNull(service.store.get("record", "SYNC-one"));
      } finally {
        Files.delete(junction);
      }
    }
  }

  private Path record(Store store, String id, String planId, String parent) throws Exception {
    Path folder = root.resolve("archives").resolve(id);
    Files.createDirectories(folder);
    Files.writeString(folder.resolve("record.json"), "original evidence");
    Files.writeString(folder.resolve("02_sync.sql"), "SELECT '原始 SQL';");
    store.put("plan", planId, Map.of("id", planId));
    store.put(
        "record",
        id,
        Map.of(
            "id",
            id,
            "workspaceId",
            "default",
            "status",
            "SUCCESS",
            "remark",
            "原备注",
            "planId",
            planId,
            "parentId",
            parent,
            "archivePath",
            folder.toString()));
    store.event(id, Map.of("type", "finished"));
    return folder;
  }

  @Test
  void remarkUpdatesMetadataAndExportWithoutRewritingEvidence() throws Exception {
    try (var service = new Service(root, ignored -> {})) {
      Path folder = record(service.store, "SYNC-one", "shared", "");
      String before = Files.readString(folder.resolve("record.json"));
      service.handle("record.updateRemark", Json.node(Map.of("id", "SYNC-one", "remark", "中文新备注")));
      assertEquals("中文新备注", service.store.get("record", "SYNC-one").path("remark").asText());
      assertEquals("SUCCESS", service.store.get("record", "SYNC-one").path("status").asText());
      assertEquals(before, Files.readString(folder.resolve("record.json")));
      assertEquals(2, service.store.events("SYNC-one").size());
      Path zip = root.resolve("export.zip");
      new Archives(service.store).zip(List.of("SYNC-one"), zip);
      try (var file = new ZipFile(zip.toFile())) {
        assertTrue(
            new String(
                    file.getInputStream(file.getEntry("SYNC-one/current-metadata.json"))
                        .readAllBytes(),
                    java.nio.charset.StandardCharsets.UTF_8)
                .contains("中文新备注"));
      }
    }
    try (var service = new Service(root, ignored -> {})) {
      assertEquals("中文新备注", service.store.get("record", "SYNC-one").path("remark").asText());
    }
  }

  @Test
  void deletesVersionButKeepsRecordsAndArchives() throws Exception {
    try (var service = new Service(root, ignored -> {})) {
      Path folder = record(service.store, "SYNC-one", "plan", "");
      service.store.saveVersion(
          "v",
          Map.of("id", "v", "workspaceId", "default", "number", "1.0"),
          List.of("SYNC-one"),
          false);
      assertThrows(
          IllegalArgumentException.class,
          () ->
              service.handle(
                  "version.delete", Json.node(Map.of("id", "v", "confirmation", "wrong"))));
      service.handle("version.delete", Json.node(Map.of("id", "v", "confirmation", "1.0")));
      assertNull(service.store.get("version", "v"));
      assertTrue(service.store.versionLinks().isEmpty());
      assertNotNull(service.store.get("record", "SYNC-one"));
      assertTrue(Files.exists(folder.resolve("02_sync.sql")));
    }
  }

  @Test
  void deletesOnlyExclusiveRecordDataAndRetainsSharedPlan() throws Exception {
    try (var service = new Service(root, ignored -> {})) {
      Path first = record(service.store, "SYNC-one", "shared", "");
      Path second = record(service.store, "SYNC-two", "shared", "");
      service.store.put("external", "SYNC-one", Map.of("id", "SYNC-one"));
      service.store.put("verification", "SYNC-one", Map.of("id", "SYNC-one"));
      assertThrows(
          IllegalArgumentException.class,
          () ->
              service.handle(
                  "record.delete", Json.node(Map.of("id", "SYNC-one", "confirmation", "one"))));
      service.handle(
          "record.delete", Json.node(Map.of("id", "SYNC-one", "confirmation", "SYNC-one")));
      assertFalse(Files.exists(first));
      assertTrue(Files.exists(second));
      assertNull(service.store.get("record", "SYNC-one"));
      assertNull(service.store.get("external", "SYNC-one"));
      assertNull(service.store.get("verification", "SYNC-one"));
      assertTrue(service.store.events("SYNC-one").isEmpty());
      assertNotNull(service.store.get("plan", "shared"));
      service.handle(
          "record.delete", Json.node(Map.of("id", "SYNC-two", "confirmation", "SYNC-two")));
      assertNull(service.store.get("plan", "shared"));
    }
  }

  @Test
  void blocksBothEndsOfRecoveryChainAndActiveRecords() throws Exception {
    try (var service = new Service(root, ignored -> {})) {
      record(service.store, "SYNC-one", "p", "");
      record(service.store, "ROLL-two", "q", "SYNC-one");
      for (String id : List.of("SYNC-one", "ROLL-two"))
        assertThrows(
            IllegalArgumentException.class,
            () -> service.handle("record.delete", Json.node(Map.of("id", id, "confirmation", id))));
      var active =
          (com.fasterxml.jackson.databind.node.ObjectNode) service.store.get("record", "SYNC-one");
      active.put("status", "RUNNING");
      service.store.put("record", "SYNC-one", active);
      assertThrows(
          IllegalArgumentException.class,
          () ->
              service.handle(
                  "record.updateRemark", Json.node(Map.of("id", "SYNC-one", "remark", "new"))));
    }
  }

  @Test
  void databaseFailureRestoresStagedArchiveAndAllRecordData() throws Exception {
    try (var service = new Service(root, ignored -> {})) {
      Path folder = record(service.store, "SYNC-one", "p", "");
      try (var c = DriverManager.getConnection("jdbc:sqlite:" + root.resolve("state.sqlite"));
          var statement = c.createStatement()) {
        statement.execute(
            "CREATE TRIGGER prevent_record_delete BEFORE DELETE ON entities WHEN OLD.kind='record'"
                + " BEGIN SELECT RAISE(ABORT,'test failure'); END");
      }
      assertThrows(
          Exception.class,
          () ->
              service.handle(
                  "record.delete",
                  Json.node(Map.of("id", "SYNC-one", "confirmation", "SYNC-one"))));
      assertNotNull(service.store.get("record", "SYNC-one"));
      assertEquals(1, service.store.events("SYNC-one").size());
      assertTrue(Files.exists(folder.resolve("02_sync.sql")));
      assertTrue(service.store.list("recordDeletion").isEmpty());
    }
  }

  @Test
  void restartRestoresUncommittedStageAndCleansCommittedStage() throws Exception {
    Path staged;
    try (var store = new Store(root)) {
      Path folder = record(store, "SYNC-one", "p", "");
      String token = UUID.randomUUID().toString();
      staged = folder.resolveSibling(".dbaligner-delete-SYNC-one-" + token);
      store.put(
          "recordDeletion",
          "SYNC-one",
          Map.of(
              "id",
              "SYNC-one",
              "original",
              folder.toString(),
              "staged",
              staged.toString(),
              "token",
              token));
      Files.move(folder, staged);
    }
    try (var service = new Service(root, ignored -> {})) {
      assertFalse(Files.exists(staged));
      assertTrue(Files.exists(root.resolve("archives/SYNC-one/record.json")));
      Path folder = root.resolve("archives/SYNC-one");
      String token = UUID.randomUUID().toString();
      staged = folder.resolveSibling(".dbaligner-delete-SYNC-one-" + token);
      service.store.put(
          "recordDeletion",
          "SYNC-one",
          Map.of(
              "id",
              "SYNC-one",
              "original",
              folder.toString(),
              "staged",
              staged.toString(),
              "token",
              token));
      Files.move(folder, staged);
      service.store.transaction(
          () -> {
            service.store.deleteRecordData("SYNC-one", "p");
            return null;
          });
    }
    try (var service = new Service(root, ignored -> {})) {
      assertFalse(Files.exists(staged));
      assertTrue(service.store.list("recordDeletion").isEmpty());
      assertNull(service.store.get("record", "SYNC-one"));
    }
  }

  @Test
  void refusesUnownedAndSharedArchivePaths() throws Exception {
    try (var service = new Service(root, ignored -> {})) {
      Path folder = record(service.store, "SYNC-one", "p", "");
      record(service.store, "SYNC-two", "q", "");
      var second =
          (com.fasterxml.jackson.databind.node.ObjectNode) service.store.get("record", "SYNC-two");
      second.put("archivePath", folder.toString());
      service.store.put("record", "SYNC-two", second);
      assertThrows(
          IllegalArgumentException.class,
          () ->
              service.handle(
                  "record.delete",
                  Json.node(Map.of("id", "SYNC-one", "confirmation", "SYNC-one"))));
      assertThrows(
          IllegalArgumentException.class,
          () ->
              service.handle(
                  "record.delete",
                  Json.node(Map.of("id", "SYNC-two", "confirmation", "SYNC-two"))));
      assertTrue(Files.exists(folder.resolve("record.json")));
    }
  }

  @Test
  void workspaceAndStableGroupValidationAreTransactional() throws Exception {
    try (var service = new Service(root, ignored -> {})) {
      service.handle(
          "entity.save",
          Json.node(Map.of("kind", "workspace", "value", Map.of("id", "empty", "name", "空工作区"))));
      service.store.put("template", "t", Map.of("id", "t", "workspaceId", "empty"));
      assertThrows(
          IllegalArgumentException.class,
          () ->
              service.handle(
                  "entity.delete", Json.node(Map.of("kind", "workspace", "id", "empty"))));
      service.store.delete("template", "t");
      service.handle("entity.delete", Json.node(Map.of("kind", "workspace", "id", "empty")));
      var connection =
          Map.of(
              "id",
              "c",
              "name",
              "连接",
              "host",
              "127.0.0.1",
              "port",
              3306,
              "user",
              "tester",
              "workspaceIds",
              List.of("default"),
              "group",
              "已删分组");
      assertThrows(
          IllegalArgumentException.class,
          () ->
              service.handle(
                  "entity.save",
                  Json.node(Map.of("kind", "connection", "value", connection, "groupId", "gone"))));
      assertNull(service.store.get("connection", "c"));
      assertTrue(service.store.list("connectionGroup").isEmpty());
      assertThrows(
          IllegalArgumentException.class,
          () ->
              service.handle(
                  "entity.save",
                  Json.node(
                      Map.of(
                          "kind",
                          "workspace",
                          "value",
                          Map.of(
                              "id", "bad", "name", "错误", "connectionIds", List.of("missing"))))));
      assertNull(service.store.get("workspace", "bad"));
      service.handle("entity.save", Json.node(Map.of("kind", "connection", "value", connection)));
      service.handle(
          "entity.save",
          Json.node(
              Map.of(
                  "kind",
                  "workspace",
                  "value",
                  Map.of("id", "default", "name", "原工作区", "connectionIds", List.of("c")))));
      var exported = service.handle("config.export", Json.node(Map.of()));
      try (var imported = new Service(root.resolve("imported"), ignored -> {})) {
        imported.handle("config.import", Json.node(Map.of("content", Json.write(exported))));
        assertEquals(
            List.of("default"),
            Json.strings(imported.store.get("connection", "c").path("workspaceIds")));
      }
      service.handle("entity.delete", Json.node(Map.of("kind", "connection", "id", "c")));
      assertTrue(
          Json.strings(service.store.get("workspace", "default").path("connectionIds")).isEmpty());
    }
  }
}
