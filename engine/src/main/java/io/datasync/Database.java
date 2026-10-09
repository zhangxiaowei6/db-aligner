package io.datasync;

import static io.datasync.Model.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigInteger;
import java.sql.*;
import java.util.*;

public final class Database {
  private final Store store;
  private volatile Map<String, String> passwords = Map.of();
  private final ThreadLocal<Map<String, String>> requestPasswords = new ThreadLocal<>();

  public Database(Store store) {
    this.store = store;
  }

  public void secrets(JsonNode values) {
    if (values != null && values.isObject()) {
      var snapshot = new HashMap<String, String>();
      values.fields().forEachRemaining(e -> snapshot.put(e.getKey(), e.getValue().asText()));
      passwords = Map.copyOf(snapshot);
      requestPasswords.set(passwords);
    }
  }

  String secret(String id) {
    var request = requestPasswords.get();
    return (request == null ? passwords : request).getOrDefault(id, "");
  }

  public Connection open(DbRef ref) throws Exception {
    var cfg = store.get("connection", ref.connectionId());
    if (cfg == null) throw new IllegalArgumentException("连接不存在");
    return openConfig(ref, cfg, secret(ref.connectionId()));
  }

  private Map<String, Object> identity(JsonNode cfg) {
    var value = new LinkedHashMap<String, Object>();
    for (String key : List.of("host", "user", "ca", "clientCert"))
      value.put(key, cfg.path(key).asText());
    value.put("port", cfg.path("port").asInt(3306));
    value.put("ssl", cfg.path("ssl").asBoolean());
    value.put("databases", Json.strings(cfg.path("databases")));
    return value;
  }

  public Map<String, Object> connectionIdentity(DbRef ref) throws Exception {
    var cfg = store.get("connection", ref.connectionId());
    if (cfg == null) throw new IllegalArgumentException("连接不存在");
    return identity(cfg);
  }

  public Connection openForCompare(TargetPlan target) throws Exception {
    var cfg = store.get("connection", target.ref.connectionId());
    if (cfg == null) throw new IllegalArgumentException("连接不存在");
    target.connectionIdentity = identity(cfg);
    return openConfig(target.ref, cfg, secret(target.ref.connectionId()));
  }

  public Connection openBound(DbRef ref, Map<String, Object> expected) throws Exception {
    var cfg = store.get("connection", ref.connectionId());
    if (cfg == null) throw new IllegalArgumentException("连接不存在");
    if (expected == null || expected.isEmpty())
      throw new IllegalArgumentException("缺少目标连接绑定，请重新比较；历史恢复需人工核验");
    if (!Json.hash(expected).equals(Json.hash(identity(cfg))))
      throw new IllegalArgumentException("目标连接配置已变化，请恢复原配置或重新比较：" + ref.key());
    // Use the same immutable configuration that was validated, even if the user edits it
    // concurrently.
    return openConfig(ref, cfg, secret(ref.connectionId()));
  }

  public Connection openConfig(DbRef ref, JsonNode cfg, String password) throws Exception {
    String host = cfg.path("host").asText();
    if (!host.matches("[a-zA-Z0-9.\\-:\\[\\]]+")) throw new IllegalArgumentException("无效服务器地址");
    var allowed = Json.strings(cfg.path("databases"));
    if (!ref.database().isEmpty() && !allowed.isEmpty() && !allowed.contains(ref.database()))
      throw new IllegalArgumentException("数据库不在连接允许范围内");
    int port = cfg.path("port").asInt(3306);
    if (port < 1 || port > 65535) throw new IllegalArgumentException("端口必须为 1–65535");
    var p = new Properties();
    p.setProperty("user", cfg.path("user").asText());
    p.setProperty("password", password);
    p.setProperty("connectTimeout", "10000");
    p.setProperty("socketTimeout", "60000");
    p.setProperty("allowMultiQueries", "false");
    p.setProperty("sslMode", cfg.path("ssl").asBoolean() ? "verify-full" : "disable");
    if (!cfg.path("ca").asText().isBlank()) p.setProperty("serverSslCert", cfg.path("ca").asText());
    if (!cfg.path("clientCert").asText().isBlank()) {
      p.setProperty("keyStore", cfg.path("clientCert").asText());
      p.setProperty("keyStorePassword", secret(ref.connectionId() + ":certificate"));
    }
    String endpoint = host.contains(":") && !host.startsWith("[") ? "[" + host + "]" : host;
    var c = DriverManager.getConnection("jdbc:mariadb://" + endpoint + ":" + port + "/", p);
    try {
      if (!ref.database().isEmpty()) c.setCatalog(ref.database());
      try (var s = c.createStatement()) {
        s.execute(
            "SET SESSION sql_mode = TRIM(BOTH ',' FROM REPLACE(CONCAT(',',@@sql_mode,','),"
                + " ',NO_BACKSLASH_ESCAPES,', ','))");
      }
      return c;
    } catch (Exception e) {
      c.close();
      throw e;
    }
  }

  public List<String> databases(String connectionId) throws Exception {
    try (var c = open(new DbRef(connectionId, ""));
        var s = c.createStatement();
        var r = s.executeQuery("SHOW DATABASES")) {
      var all = new ArrayList<String>();
      var allowed = Json.strings(store.get("connection", connectionId).path("databases"));
      while (r.next()) {
        String n = r.getString(1);
        if (!List.of("mysql", "sys", "information_schema", "performance_schema").contains(n)
            && (allowed.isEmpty() || allowed.contains(n))) all.add(n);
      }
      return all;
    }
  }

  public String version(Connection c) throws SQLException {
    try (var s = c.createStatement();
        var r = s.executeQuery("SELECT VERSION()")) {
      r.next();
      return r.getString(1);
    }
  }

  public void supportedServer(Connection c) throws SQLException {
    String v = version(c);
    if (v.toLowerCase().contains("mariadb")
        || !(v.startsWith("5.7.") || v.startsWith("8.0.") || v.startsWith("8.4.")))
      throw new IllegalArgumentException("首版同步支持 MySQL 5.7、8.0、8.4；当前服务版本为 " + v);
  }

  public List<Map<String, Object>> tables(DbRef ref) throws Exception {
    try (var c = open(ref);
        var p =
            c.prepareStatement(
                "SELECT TABLE_NAME,TABLE_COMMENT,TABLE_TYPE FROM information_schema.TABLES WHERE"
                    + " TABLE_SCHEMA=? ORDER BY TABLE_NAME")) {
      p.setString(1, ref.database());
      try (var r = p.executeQuery()) {
        var list = new ArrayList<Map<String, Object>>();
        while (r.next())
          if (r.getString(3).equals("BASE TABLE") && !r.getString(1).startsWith("__ds_"))
            list.add(Map.of("name", r.getString(1), "comment", r.getString(2)));
        return list;
      }
    }
  }

  public Table snapshot(DbRef ref, String name, boolean data) throws Exception {
    try (var c = open(ref)) {
      return snapshot(c, ref, name, data);
    }
  }

  public Table snapshot(Connection c, DbRef ref, String name, boolean data) throws Exception {
    var t = new Table();
    t.name = name;
    try (var s = c.createStatement();
        var r = s.executeQuery("SHOW CREATE TABLE " + Sql.qualified(ref, name))) {
      r.next();
      t.createSql = r.getString(2);
    } catch (SQLException e) {
      if (e.getErrorCode() == 1146) {
        t.exists = false;
        return t;
      }
      throw e;
    }
    if (!t.createSql.startsWith("CREATE TABLE")) {
      t.supported = false;
      t.issues.add("不支持视图同步");
      return t;
    }
    var defs = Sql.splitDefinitions(t.createSql);
    try (var p =
        c.prepareStatement(
            "SELECT ENGINE,TABLE_COLLATION,TABLE_COMMENT FROM information_schema.TABLES WHERE"
                + " TABLE_SCHEMA=? AND TABLE_NAME=?")) {
      p.setString(1, ref.database());
      p.setString(2, name);
      try (var r = p.executeQuery()) {
        r.next();
        t.engine = r.getString(1);
        t.collation = r.getString(2);
        t.charset = t.collation == null ? "" : t.collation.substring(0, t.collation.indexOf('_'));
        t.comment = r.getString(3);
      }
    }
    try (var p =
        c.prepareStatement(
            "SELECT"
                + " COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLUMN_COMMENT,ORDINAL_POSITION,GENERATION_EXPRESSION,COLLATION_NAME"
                + " FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY"
                + " ORDINAL_POSITION")) {
      p.setString(1, ref.database());
      p.setString(2, name);
      try (var r = p.executeQuery()) {
        while (r.next()) {
          String n = r.getString(1);
          String def =
              defs.stream().filter(x -> x.startsWith(Sql.id(n) + " ")).findFirst().orElseThrow();
          t.columns.add(
              new Column(
                  n,
                  r.getString(2),
                  r.getString(3).equals("YES"),
                  r.getString(4),
                  r.getString(5),
                  r.getString(6),
                  r.getInt(7),
                  def,
                  r.getString(8),
                  r.getString(9)));
        }
      }
    }
    try (var p =
        c.prepareStatement(
            "SELECT INDEX_NAME,NON_UNIQUE,INDEX_TYPE,COLUMN_NAME,SUB_PART,COLLATION FROM"
                + " information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY"
                + " INDEX_NAME,SEQ_IN_INDEX")) {
      p.setString(1, ref.database());
      p.setString(2, name);
      try (var r = p.executeQuery()) {
        var cols = new LinkedHashMap<String, List<String>>();
        var unique = new HashMap<String, Boolean>();
        var types = new HashMap<String, String>();
        while (r.next()) {
          String n = r.getString(1);
          cols.computeIfAbsent(n, k -> new ArrayList<>()).add(r.getString(4));
          unique.put(n, r.getInt(2) == 0);
          types.put(n, r.getString(3));
        }
        for (var e : cols.entrySet()) {
          String def =
              defs.stream()
                  .filter(
                      x ->
                          e.getKey().equals("PRIMARY")
                              ? x.startsWith("PRIMARY KEY")
                              : x.matches(
                                  "(?s).*(?:KEY|INDEX) "
                                      + java.util.regex.Pattern.quote(Sql.id(e.getKey()))
                                      + " .*"))
                  .findFirst()
                  .orElse("");
          t.indexes.add(
              new Index(
                  e.getKey(), unique.get(e.getKey()), types.get(e.getKey()), e.getValue(), def));
        }
      }
    }
    for (String def : defs)
      if (def.startsWith("CONSTRAINT") && def.contains("FOREIGN KEY")) {
        var m =
            java.util.regex.Pattern.compile(
                    "CONSTRAINT (`(?:``|[^`])+`).*REFERENCES (`(?:``|[^`])+`)")
                .matcher(def);
        if (m.find())
          t.foreignKeys.add(new ForeignKey(unquote(m.group(1)), def, unquote(m.group(2))));
        else {
          t.supported = false;
          t.issues.add("无法解析跨库外键");
        }
      }
    if (t.createSql.contains("PARTITION BY")
        || defs.stream().anyMatch(x -> x.startsWith("CHECK ") || x.contains(" CHECK "))
        || t.columns.stream().anyMatch(x -> x.generation() != null && !x.generation().isBlank())
        || t.indexes.stream()
            .anyMatch(
                i ->
                    i.columns().contains(null)
                        || i.definition().isBlank()
                        || i.definition().contains("INVISIBLE"))) {
      t.supported = false;
      t.issues.add("分区、生成列、CHECK 或特殊索引暂不支持同步");
    }
    try (var p =
        c.prepareStatement(
            "SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA=? AND"
                + " EVENT_OBJECT_TABLE=?")) {
      p.setString(1, ref.database());
      p.setString(2, name);
      try (var r = p.executeQuery()) {
        r.next();
        if (r.getInt(1) > 0) {
          t.supported = false;
          t.issues.add("表含触发器，无法提供完整恢复保障");
        }
      }
    }
    if (data) t.rows = readRows(c, ref, name, 20000);
    return t;
  }

  private String unquote(String s) {
    return s.substring(1, s.length() - 1).replace("``", "`");
  }

  public void keyTokens(Connection c, DbRef ref, Table table, List<String> keys) throws Exception {
    if (!table.exists || keys.isEmpty()) return;
    var expressions = new ArrayList<String>();
    var aliases = new ArrayList<String>();
    for (int i = 0; i < keys.size(); i++) {
      String key = keys.get(i);
      var col =
          table.columns.stream()
              .filter(x -> x.name().equals(key))
              .findFirst()
              .orElseThrow(() -> new IllegalArgumentException("匹配键不存在：" + key));
      String expr = Sql.id(key);
      if (col.collation() != null) {
        boolean pad = version(c).startsWith("5.7.");
        if (!pad)
          try (var st =
              c.prepareStatement(
                  "SELECT PAD_ATTRIBUTE FROM information_schema.COLLATIONS WHERE"
                      + " COLLATION_NAME=?")) {
            st.setString(1, col.collation());
            try (var rs = st.executeQuery()) {
              pad = rs.next() && rs.getString(1).equals("PAD SPACE");
            }
          }
        expr = "HEX(WEIGHT_STRING(" + (pad ? "RTRIM(" + expr + ")" : expr) + "))";
      }
      String alias = "__ds_weight_" + UUID.randomUUID().toString().replace("-", "");
      aliases.add(alias);
      expressions.add(expr + " AS " + Sql.id(alias));
    }
    try (var st = c.createStatement();
        var rs =
            st.executeQuery(
                "SELECT *,"
                    + String.join(",", expressions)
                    + " FROM "
                    + Sql.qualified(ref, table.name)
                    + " LIMIT 20001")) {
      int count = 0;
      while (rs.next()) {
        if (++count > 20000) throw new IllegalArgumentException("基础数据超过 20000 行");
        var row = row(rs);
        var values = new ArrayList<Object>();
        for (String alias : aliases) values.add(row.remove(alias));
        table.keyTokens.put(Json.hash(row), Json.hash(values));
      }
    }
  }

  public List<Map<String, Object>> readRows(Connection c, DbRef ref, String table, int limit)
      throws Exception {
    var rows = new ArrayList<Map<String, Object>>();
    try (var s = c.createStatement()) {
      s.setQueryTimeout(60);
      s.setFetchSize(500);
      try (var rs =
          s.executeQuery("SELECT * FROM " + Sql.qualified(ref, table) + " LIMIT " + (limit + 1))) {
        while (rs.next()) {
          if (rows.size() >= limit)
            throw new IllegalArgumentException("基础数据超过 " + limit + " 行，首版请缩小同步范围");
          rows.add(row(rs));
        }
      }
    }
    return rows;
  }

  static Map<String, Object> row(ResultSet rs) throws SQLException {
    var result = new LinkedHashMap<String, Object>();
    var meta = rs.getMetaData();
    for (int i = 1; i <= meta.getColumnCount(); i++) {
      Object v = rs.getObject(i);
      if (v instanceof byte[] b) v = Map.of("$binary", HexFormat.of().formatHex(b));
      else if (v instanceof Blob b)
        v = Map.of("$binary", HexFormat.of().formatHex(b.getBytes(1, (int) b.length())));
      else if (v instanceof java.util.Date || v instanceof java.time.temporal.TemporalAccessor)
        v = v.toString();
      result.put(meta.getColumnLabel(i), v);
    }
    return result;
  }

  public String digest(Connection c, DbRef ref, String name) throws Exception {
    var t = snapshot(c, ref, name, false);
    if (!t.exists) return "MISSING";
    BigInteger sum = BigInteger.ZERO;
    long count = 0;
    try (var s = c.createStatement()) {
      s.setFetchSize(500);
      s.setQueryTimeout(120);
      try (var rs = s.executeQuery("SELECT * FROM " + Sql.qualified(ref, name))) {
        while (rs.next()) {
          sum =
              sum.add(new BigInteger(Json.hash(row(rs)), 16))
                  .and(BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE));
          count++;
        }
      }
    }
    return Sql.schemaHash(t) + ":" + count + ":" + sum.toString(16);
  }

  public String rowsDigest(Connection c, DbRef ref, String name) throws Exception {
    BigInteger sum = BigInteger.ZERO;
    long count = 0;
    try (var s = c.createStatement()) {
      s.setFetchSize(500);
      s.setQueryTimeout(120);
      try (var rs = s.executeQuery("SELECT * FROM " + Sql.qualified(ref, name))) {
        while (rs.next()) {
          sum =
              sum.add(new BigInteger(Json.hash(row(rs)), 16))
                  .and(BigInteger.ONE.shiftLeft(256).subtract(BigInteger.ONE));
          count++;
        }
      }
    }
    return count + ":" + sum.toString(16);
  }

  public int executeData(Connection c, DbRef ref, Change x) throws SQLException {
    var fields = new ArrayList<String>();
    var args = new ArrayList<Object>();
    String q = Sql.qualified(ref, x.table), sql;
    if (x.kind.equals("ADD_ROW")) {
      fields.addAll(x.after.keySet());
      args.addAll(x.after.values());
      sql =
          "INSERT INTO "
              + q
              + " ("
              + fields.stream().map(Sql::id).collect(java.util.stream.Collectors.joining(","))
              + ") VALUES ("
              + String.join(",", Collections.nCopies(fields.size(), "?"))
              + ")";
    } else {
      if (x.kind.equals("UPDATE_ROW")) {
        x.after.forEach(
            (k, v) -> {
              if (!Json.hash(v).equals(Json.hash(x.before.get(k)))) {
                fields.add(k);
                args.add(v);
              }
            });
        sql =
            "UPDATE "
                + q
                + " SET "
                + fields.stream()
                    .map(k -> Sql.id(k) + "=?")
                    .collect(java.util.stream.Collectors.joining(","))
                + " WHERE ";
      } else sql = "DELETE FROM " + q + " WHERE ";
      sql +=
          x.before.keySet().stream()
              .map(k -> Sql.id(k) + " <=> ?")
              .collect(java.util.stream.Collectors.joining(" AND "));
      args.addAll(x.before.values());
    }
    try (var p = c.prepareStatement(sql)) {
      for (int i = 0; i < args.size(); i++) {
        var v = args.get(i);
        if (v instanceof Map<?, ?> m && m.containsKey("$binary"))
          p.setBytes(i + 1, HexFormat.of().parseHex(m.get("$binary").toString()));
        else p.setObject(i + 1, v);
      }
      p.setQueryTimeout(120);
      return p.executeUpdate();
    }
  }

  public int execute(Connection c, String sql) throws SQLException {
    try (var s = c.createStatement()) {
      s.setQueryTimeout(120);
      return s.executeUpdate(sql);
    }
  }

  public int incomingForeignKeys(Connection c, DbRef ref, String table, String column)
      throws SQLException {
    try (var p =
        c.prepareStatement(
            "SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE"
                + " REFERENCED_TABLE_SCHEMA=? AND REFERENCED_TABLE_NAME=?"
                + (column == null ? "" : " AND REFERENCED_COLUMN_NAME=?"))) {
      p.setString(1, ref.database());
      p.setString(2, table);
      if (column != null) p.setString(3, column);
      try (var r = p.executeQuery()) {
        r.next();
        return r.getInt(1);
      }
    }
  }

  public boolean inboundWrite(Connection c, DbRef ref, Change x, boolean inverse)
      throws SQLException {
    if ((!inverse && x.kind.equals("DELETE_ROW")) || (inverse && x.kind.equals("ADD_ROW")))
      return incomingForeignKeys(c, ref, x.table, null) > 0;
    if (x.kind.equals("UPDATE_ROW")) {
      for (String field : x.after.keySet())
        if (!Json.hash(x.before.get(field)).equals(Json.hash(x.after.get(field)))
            && incomingForeignKeys(c, ref, x.table, field) > 0) return true;
    }
    return false;
  }

  public boolean keyExists(
      Connection c, DbRef ref, String table, Map<String, Object> row, List<String> keys)
      throws SQLException {
    if (keys.isEmpty()) return true;
    try (var p =
        c.prepareStatement(
            "SELECT COUNT(*) FROM "
                + Sql.qualified(ref, table)
                + " WHERE "
                + keys.stream()
                    .map(k -> Sql.id(k) + " <=> ?")
                    .collect(java.util.stream.Collectors.joining(" AND ")))) {
      for (int i = 0; i < keys.size(); i++) {
        Object v = row.get(keys.get(i));
        if (v instanceof Map<?, ?> m && m.containsKey("$binary"))
          p.setBytes(i + 1, HexFormat.of().parseHex(m.get("$binary").toString()));
        else p.setObject(i + 1, v);
      }
      try (var rs = p.executeQuery()) {
        rs.next();
        return rs.getLong(1) > 0;
      }
    }
  }

  public Map<String, Object> rowFor(
      Connection c, DbRef ref, String table, Map<String, Object> values, List<String> keys)
      throws SQLException {
    if (keys.isEmpty()) throw new IllegalArgumentException("缺少记录匹配键");
    try (var p =
        c.prepareStatement(
            "SELECT * FROM "
                + Sql.qualified(ref, table)
                + " WHERE "
                + keys.stream()
                    .map(k -> Sql.id(k) + " <=> ?")
                    .collect(java.util.stream.Collectors.joining(" AND "))
                + " LIMIT 2")) {
      for (int i = 0; i < keys.size(); i++) {
        Object v = values.get(keys.get(i));
        if (v instanceof Map<?, ?> m && m.containsKey("$binary"))
          p.setBytes(i + 1, HexFormat.of().parseHex(m.get("$binary").toString()));
        else p.setObject(i + 1, v);
      }
      try (var rs = p.executeQuery()) {
        if (!rs.next()) return null;
        var value = row(rs);
        if (rs.next()) throw new IllegalArgumentException("匹配键不再唯一");
        return value;
      }
    }
  }
}
