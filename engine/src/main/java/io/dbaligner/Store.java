package io.dbaligner;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.*;
import java.sql.*;
import java.util.*;

public final class Store implements AutoCloseable {
  public final Path root;
  private final Connection db;

  public Store(Path root) throws Exception {
    this.root = root.toAbsolutePath();
    Files.createDirectories(root);
    db = DriverManager.getConnection("jdbc:sqlite:" + root.resolve("state.sqlite"));
    try (var s = db.createStatement()) {
      s.execute("PRAGMA journal_mode=WAL");
      s.execute("PRAGMA synchronous=FULL");
      s.execute(
          "CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT NOT NULL,json TEXT NOT"
              + " NULL,PRIMARY KEY(kind,id))");
      s.execute(
          "CREATE TABLE IF NOT EXISTS record_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,record_id"
              + " TEXT NOT NULL,time TEXT NOT NULL,json TEXT NOT NULL)");
      s.execute(
          "CREATE TABLE IF NOT EXISTS version_records(record_id TEXT PRIMARY KEY,version_id TEXT"
              + " NOT NULL)");
    }
    if (list("workspace").isEmpty())
      put(
          "workspace",
          "default",
          Json.node(
              Map.of(
                  "id", "default", "name", "我的项目", "description", "", "connectionIds", List.of())));
    if (get("settings", "global") == null)
      put(
          "settings",
          "global",
          Json.node(
              Map.of(
                  "id",
                  "global",
                  "concurrency",
                  4,
                  "perHost",
                  1,
                  "batchSize",
                  500,
                  "archivePath",
                  root.resolve("archives").toString(),
                  "retention",
                  "forever")));
    for (var r : list("record")) {
      if (List.of("RUNNING", "QUEUED").contains(r.path("status").asText())) {
        var obj = (com.fasterxml.jackson.databind.node.ObjectNode) r.deepCopy();
        obj.put("status", "INTERRUPTED");
        put("record", obj.path("id").asText(), obj);
        event(obj.path("id").asText(), Map.of("type", "interrupted", "message", "引擎中断，需核验实际状态"));
      }
    }
  }

  public synchronized JsonNode get(String kind, String id) throws SQLException {
    try (var s = db.prepareStatement("SELECT json FROM entities WHERE kind=? AND id=?")) {
      s.setString(1, kind);
      s.setString(2, id);
      try (var rs = s.executeQuery()) {
        if (!rs.next()) return null;
        var n = Json.read(rs.getString(1), JsonNode.class);
        if (kind.equals("record") && n.has("planId")) {
          ((com.fasterxml.jackson.databind.node.ObjectNode) n)
              .set("plan", get("plan", n.path("planId").asText()));
        }
        return n;
      }
    }
  }

  public synchronized List<JsonNode> list(String kind) throws SQLException {
    var r = new ArrayList<JsonNode>();
    try (var s =
        db.prepareStatement("SELECT json FROM entities WHERE kind=? ORDER BY rowid DESC")) {
      s.setString(1, kind);
      try (var rs = s.executeQuery()) {
        while (rs.next()) r.add(Json.read(rs.getString(1), JsonNode.class));
      }
    }
    return r;
  }

  public synchronized List<JsonNode> recordSummaries() throws SQLException {
    var records = list("record");
    for (var n : records)
      for (var result : n.path("results"))
        ((com.fasterxml.jackson.databind.node.ObjectNode) result)
            .remove(List.of("rowAfter", "recoveryRows"));
    return records;
  }

  public synchronized JsonNode put(String kind, String id, Object value) throws SQLException {
    if (value instanceof Model.SyncRecord r) {
      if (get("plan", r.plan.id) == null) put("plan", r.plan.id, r.plan);
      var m = new LinkedHashMap<String, Object>();
      m.put("id", r.id);
      m.put("workspaceId", r.workspaceId);
      m.put("createdAt", r.createdAt);
      m.put("mode", r.mode);
      m.put("recoveryFormat", r.recoveryFormat);
      m.put("status", r.status);
      m.put("remark", r.remark);
      m.put("parentId", r.parentId);
      m.put("archivePath", r.archivePath);
      m.put("planId", r.plan.id);
      m.put("source", r.plan.source);
      m.put("tables", r.plan.tables);
      m.put("targetCount", r.plan.targets.size());
      m.put("selectedIds", r.selectedIds);
      m.put("results", r.results);
      value = m;
    }
    try (var s =
        db.prepareStatement(
            "INSERT INTO entities(kind,id,json) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET"
                + " json=excluded.json")) {
      s.setString(1, kind);
      s.setString(2, id);
      s.setString(3, Json.write(value));
      s.executeUpdate();
    }
    return Json.node(value);
  }

  public synchronized void delete(String kind, String id) throws SQLException {
    try (var s = db.prepareStatement("DELETE FROM entities WHERE kind=? AND id=?")) {
      s.setString(1, kind);
      s.setString(2, id);
      s.executeUpdate();
    }
  }

  public synchronized <T> T transaction(java.util.concurrent.Callable<T> work) throws Exception {
    if (!db.getAutoCommit()) return work.call();
    db.setAutoCommit(false);
    try {
      T result = work.call();
      db.commit();
      return result;
    } catch (Exception e) {
      db.rollback();
      throw e;
    } finally {
      db.setAutoCommit(true);
    }
  }

  public synchronized void event(String id, Object event) throws SQLException {
    try (var s =
        db.prepareStatement("INSERT INTO record_events(record_id,time,json) VALUES(?,?,?)")) {
      s.setString(1, id);
      s.setString(2, java.time.Instant.now().toString());
      s.setString(3, Json.write(event));
      s.executeUpdate();
    }
  }

  public synchronized List<JsonNode> events(String id) throws SQLException {
    var r = new ArrayList<JsonNode>();
    try (var s =
        db.prepareStatement("SELECT time,json FROM record_events WHERE record_id=? ORDER BY seq")) {
      s.setString(1, id);
      try (var rs = s.executeQuery()) {
        while (rs.next()) {
          var n = Json.MAPPER.createObjectNode();
          n.put("time", rs.getString(1));
          n.set("event", Json.read(rs.getString(2), JsonNode.class));
          r.add(n);
        }
      }
    }
    return r;
  }

  public synchronized void markVersion(String versionId, List<String> recordIds, boolean move)
      throws SQLException {
    saveVersion(versionId, null, recordIds, move);
  }

  public synchronized void saveVersion(
      String versionId, Object value, List<String> recordIds, boolean move) throws SQLException {
    db.setAutoCommit(false);
    try {
      if (value != null) put("version", versionId, value);
      for (String id : recordIds) {
        var record = get("record", id);
        var version = get("version", versionId);
        if (record == null
            || version == null
            || !record.path("workspaceId").asText().equals(version.path("workspaceId").asText()))
          throw new IllegalArgumentException("版本与记录必须在同一工作区");
        try (var s =
            db.prepareStatement("SELECT version_id FROM version_records WHERE record_id=?")) {
          s.setString(1, id);
          try (var rs = s.executeQuery()) {
            if (rs.next() && !rs.getString(1).equals(versionId) && !move)
              throw new IllegalArgumentException("记录已经归属其他版本，请明确选择移动");
          }
        }
        try (var s =
            db.prepareStatement(
                "INSERT INTO version_records(record_id,version_id) VALUES(?,?) ON"
                    + " CONFLICT(record_id) DO UPDATE SET version_id=excluded.version_id")) {
          s.setString(1, id);
          s.setString(2, versionId);
          s.executeUpdate();
        }
      }
      db.commit();
    } catch (Exception e) {
      db.rollback();
      throw e;
    } finally {
      db.setAutoCommit(true);
    }
  }

  public synchronized Map<String, String> versionLinks() throws SQLException {
    var r = new HashMap<String, String>();
    try (var s = db.createStatement();
        var rs = s.executeQuery("SELECT record_id,version_id FROM version_records")) {
      while (rs.next()) r.put(rs.getString(1), rs.getString(2));
    }
    return r;
  }

  public synchronized void backup(Path destination) throws Exception {
    if (Files.exists(destination)) throw new IllegalArgumentException("备份文件已存在");
    try (var s = db.createStatement()) {
      s.execute("VACUUM INTO '" + destination.toString().replace("'", "''") + "'");
    }
  }

  public synchronized void close() throws SQLException {
    db.close();
  }
}
