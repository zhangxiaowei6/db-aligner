package io.dbaligner;

import static io.dbaligner.Model.*;
import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

class EngineTest {
  @TempDir Path root;

  @Test
  void sqlHandlesNamesAndValues() {
    assertEquals("`含``特殊字`", Sql.id("含`特殊字"));
    assertTrue(Sql.value("a'\\\n中文").startsWith("CONVERT(X'"));
    assertEquals(
        3,
        Sql.splitDefinitions(
                "CREATE TABLE `t` (`id` int, `c` enum('a,b','c'), KEY `i` (`c`)) ENGINE=InnoDB")
            .size());
  }

  @Test
  void invalidKeysBlocked() {
    assertThrows(
        IllegalArgumentException.class,
        () -> Planner.byKey(List.of(Map.of("a", 1), Map.of("a", 1)), List.of("a")));
    var n = new HashMap<String, Object>();
    n.put("a", null);
    assertThrows(IllegalArgumentException.class, () -> Planner.byKey(List.of(n), List.of("a")));
    assertEquals(
        2,
        Planner.byKey(List.of(Map.of("a", 1, "b", 2), Map.of("a", 1, "b", 3)), List.of("a", "b"))
            .size());
  }

  @Test
  void saveOnlyIsOfflineAndImmutable() throws Exception {
    try (var s = new Store(root);
        var j = new Jobs(s, new Database(s), new Archives(s), e -> {})) {
      var p = new SyncPlan();
      p.id = "plan";
      p.workspaceId = "default";
      p.source = new DbRef("offline", "source");
      p.tables = List.of(new TableChoice("t", true, false, List.of()));
      var t = new TargetPlan();
      t.ref = new DbRef("offline", "target");
      var table = new Table();
      table.name = "t";
      table.exists = false;
      t.before.put("t", table);
      var x = new Change();
      x.id = "x";
      x.table = "t";
      x.kind = "CREATE_TABLE";
      x.sql = "CREATE TABLE `target`.`t` (`id` int)";
      x.rollbackSql = List.of("DROP TABLE `target`.`t`");
      t.changes.add(x);
      p.targets.add(t);
      var a = j.save(p, List.of("x"), "SAVE_ONLY", "");
      assertEquals("UNEXECUTED", a.status);
      Path original = Path.of(a.archivePath, "plan.json");
      byte[] bytes = Files.readAllBytes(original);
      s.put("version", "v", Map.of("id", "v", "workspaceId", "default", "number", "1.0"));
      s.markVersion("v", List.of(a.id), false);
      assertArrayEquals(bytes, Files.readAllBytes(original));
      assertEquals("v", s.versionLinks().get(a.id));
      assertThrows(IllegalArgumentException.class, () -> j.preview(a.id));
    }
  }

  @Test
  void clearingSavedCredentialsAlsoClearsEngineMemory() throws Exception {
    try (var store = new Store(root)) {
      var database = new Database(store);
      database.secrets(Json.node(Map.of("test", "temporary-test-secret")));
      assertEquals("temporary-test-secret", database.secret("test"));
      database.secrets(Json.node(Map.of()));
      assertEquals("", database.secret("test"));
      try (var worker = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor()) {
        assertEquals("", worker.submit(() -> database.secret("test")).get());
      }
    }
  }

  @Test
  void presentationKeepsLargeIdsAndDecimalsExactWithoutChangingEvidence() {
    var original =
        Map.of(
            "id",
            new java.math.BigInteger("9223372036854775807"),
            "amount",
            new java.math.BigDecimal("1234567890.123456789"),
            "port",
            3306);
    String evidence = Json.write(original);
    var presentation = Json.presentation(original);
    assertEquals("9223372036854775807", presentation.path("id").textValue());
    assertEquals("1234567890.123456789", presentation.path("amount").textValue());
    assertTrue(presentation.path("port").isIntegralNumber());
    assertEquals(evidence, Json.write(original));
    assertEquals(presentation, Json.presentation(Json.node(original)));
  }

  @Test
  void connectionBindingRejectsEndpointChangesBeforeConnecting() throws Exception {
    try (var store = new Store(root)) {
      var config =
          new LinkedHashMap<String, Object>(
              Map.of("id", "test", "host", "localhost", "port", 3306, "user", "u"));
      store.put("connection", "test", config);
      var database = new Database(store);
      var ref = new DbRef("test", "target");
      var identity = database.connectionIdentity(ref);
      assertFalse(identity.containsKey("password"));
      config.put("name", "renamed");
      store.put("connection", "test", config);
      assertEquals(Json.hash(identity), Json.hash(database.connectionIdentity(ref)));
      config.put("host", "192.0.2.20");
      store.put("connection", "test", config);
      var error =
          assertThrows(IllegalArgumentException.class, () -> database.openBound(ref, identity));
      assertTrue(error.getMessage().contains("目标连接配置已变化"));
    }
  }

  @Test
  void restartMarksRunningAsInterrupted() throws Exception {
    try (var s = new Store(root)) {
      s.put("record", "r", Map.of("id", "r", "status", "RUNNING"));
    }
    try (var s = new Store(root)) {
      assertEquals("INTERRUPTED", s.get("record", "r").path("status").asText());
      assertFalse(s.events("r").isEmpty());
    }
  }

  @Test
  void xmlEntitiesCannotReadFiles() {
    assertThrows(
        Exception.class,
        () ->
            Imports.parse(
                "datagrip",
                "<!DOCTYPE x [<!ENTITY a SYSTEM"
                    + " 'file:///C:/Windows/win.ini'>]><project>&a;</project>"));
  }

  @Test
  void sessionFormatsKeepEncryptedPasswordsMissing() throws Exception {
    var ncx =
        Imports.parse(
                "navicat",
                "<Connections><Connection ConnectionName='测试' ConnType='0' Host='localhost'"
                    + " Port='3306' UserName='u' Password='encrypted' SSH='0'/></Connections>")
            .getFirst();
    assertEquals("", ncx.get("password"));
    assertFalse(ncx.containsKey("warning"));
    var dg =
        Imports.parse(
                "datagrip",
                "<project><data-source"
                    + " name='demo'><jdbc-url>jdbc:mysql://localhost:3307/app</jdbc-url><user-name>u</user-name></data-source></project>")
            .getFirst();
    assertEquals(3307, dg.get("port"));
    var dbv =
        Imports.parse(
                "dbeaver",
                "{\"connections\":{\"id\":{\"name\":\"示例\",\"provider\":\"mysql\",\"configuration\":{\"host\":\"localhost\",\"user\":\"u\",\"database\":\"app\"}}}}")
            .getFirst();
    assertEquals(List.of("app"), dbv.get("databases"));
  }

  @Test
  void backupRoundTripAndTraversalBlocked() throws Exception {
    try (var store = new Store(root)) {
      store.put("workspace", "another", Map.of("id", "another", "name", "备份项目"));
      Path zip = root.resolve("backup.zip");
      Backup.exportAll(store, zip);
      var restored = Json.node(Backup.prepareRestore(store, zip));
      try (var sqlite =
              java.sql.DriverManager.getConnection(
                  "jdbc:sqlite:" + restored.path("sqlite").asText());
          var stmt = sqlite.createStatement();
          var rs = stmt.executeQuery("SELECT count(*) FROM entities WHERE kind='workspace'")) {
        assertTrue(rs.next());
        assertEquals(2, rs.getInt(1));
      }
      Path bad = root.resolve("bad.zip");
      try (var z = new java.util.zip.ZipOutputStream(Files.newOutputStream(bad))) {
        z.putNextEntry(new java.util.zip.ZipEntry("../../escape.txt"));
        z.write(new byte[] {1});
        z.closeEntry();
      }
      assertThrows(IllegalArgumentException.class, () -> Backup.prepareRestore(store, bad));
      store.put("record", "../../escape", Map.of("id", "../../escape", "status", "UNEXECUTED"));
      Path poisonedDb = root.resolve("poisoned.sqlite");
      store.backup(poisonedDb);
      Path poisonedZip = root.resolve("poisoned.zip");
      try (var z = new java.util.zip.ZipOutputStream(Files.newOutputStream(poisonedZip))) {
        z.putNextEntry(new java.util.zip.ZipEntry("state.sqlite"));
        Files.copy(poisonedDb, z);
        z.closeEntry();
      }
      assertThrows(IllegalArgumentException.class, () -> Backup.prepareRestore(store, poisonedZip));
    }
  }

  @Test
  void versionAssignmentIsAtomicAndSupportsExplicitMove() throws Exception {
    try (var s = new Store(root)) {
      s.put("record", "one", Map.of("id", "one", "workspaceId", "default", "status", "UNEXECUTED"));
      s.put("record", "two", Map.of("id", "two", "workspaceId", "default", "status", "SUCCESS"));
      s.saveVersion(
          "v1",
          Map.of("id", "v1", "workspaceId", "default", "number", "1.0"),
          List.of("one"),
          false);
      s.saveVersion(
          "v1",
          Map.of("id", "v1", "workspaceId", "default", "number", "1.0"),
          List.of("two"),
          false);
      assertEquals(2, s.versionLinks().size());
      assertThrows(
          IllegalArgumentException.class,
          () ->
              s.saveVersion(
                  "v2",
                  Map.of("id", "v2", "workspaceId", "default", "number", "2.0"),
                  List.of("one"),
                  false));
      assertNull(s.get("version", "v2"));
      assertEquals("v1", s.versionLinks().get("one"));
      s.saveVersion(
          "v2",
          Map.of("id", "v2", "workspaceId", "default", "number", "2.0"),
          List.of("one"),
          true);
      assertEquals("v2", s.versionLinks().get("one"));
      assertEquals("UNEXECUTED", s.get("record", "one").path("status").asText());
    }
  }
}
