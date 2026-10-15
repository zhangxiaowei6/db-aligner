package io.dbaligner;

import static io.dbaligner.Model.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.sql.*;
import java.util.*;

/** PostgreSQL 17 普通表适配器，复杂对象保守阻止。 */
public final class PostgresAdapter implements DatabaseAdapter {
  private final Database db;

  PostgresAdapter(Database db) {
    this.db = db;
  }

  boolean matches(Connection c) throws SQLException {
    return c.getMetaData().getDatabaseProductName().equals("PostgreSQL");
  }

  public void supportedServer(Connection c) throws SQLException {
    if (c.getMetaData().getDatabaseMajorVersion() != 17)
      throw new IllegalArgumentException("PostgreSQL 同步仅支持 17.x，请使用已验证版本");
  }

  Connection open(DbRef ref, JsonNode cfg, String password, String certificatePassword)
      throws Exception {
    String host = cfg.path("host").asText();
    if (!host.matches("[a-zA-Z0-9.\\-:\\[\\]]+")) throw new IllegalArgumentException("无效服务器地址");
    int port = cfg.path("port").asInt(5432);
    if (port < 1 || port > 65535) throw new IllegalArgumentException("端口必须为 1–65535");
    String database =
        ref.database().isEmpty() ? cfg.path("initialDatabase").asText("postgres") : ref.database();
    if (database.isBlank()) throw new IllegalArgumentException("请输入初始连接数据库");
    var allowed = Json.strings(cfg.path("databases"));
    if (!ref.database().isEmpty() && !allowed.isEmpty() && !allowed.contains(database))
      throw new IllegalArgumentException("数据库不在允许范围");
    var properties = new Properties();
    properties.setProperty("user", cfg.path("user").asText());
    properties.setProperty("password", password);
    properties.setProperty("connectTimeout", "10");
    properties.setProperty("socketTimeout", "60");
    if (cfg.path("ssl").asBoolean() && cfg.path("ca").asText().isBlank())
      throw new IllegalArgumentException("PostgreSQL SSL 连接需要 CA 证书");
    properties.setProperty("sslmode", cfg.path("ssl").asBoolean() ? "verify-full" : "disable");
    if (!cfg.path("ca").asText().isBlank())
      properties.setProperty("sslrootcert", cfg.path("ca").asText());
    if (!cfg.path("clientCert").asText().isBlank()) {
      properties.setProperty("sslkey", cfg.path("clientCert").asText());
      properties.setProperty("sslpassword", certificatePassword);
    }
    String endpoint = host.contains(":") && !host.startsWith("[") ? "[" + host + "]" : host;
    ComparisonContext.check();
    var c =
        db.registry.open(
            cfg,
            "jdbc:postgresql://"
                + endpoint
                + ":"
                + port
                + "/"
                + java.net.URLEncoder.encode(database, java.nio.charset.StandardCharsets.UTF_8)
                    .replace("+", "%20"),
            properties);
    try {
      var context = ComparisonContext.CURRENT.get();
      if (context != null) c = context.wrap(c);
      try (var s = c.createStatement()) {
        s.execute("SET search_path = pg_catalog");
        s.execute("SET standard_conforming_strings = on");
        s.execute("SET TIME ZONE 'UTC'");
        s.execute("SET lock_timeout = '10s'");
      }
      return c;
    } catch (Exception e) {
      c.close();
      throw e;
    }
  }

  private void namespace(DbRef ref) {
    if (ref.database().isBlank()
        || ref.schema() == null
        || ref.schema().isBlank()
        || ref.schema().startsWith("pg_")
        || ref.schema().equals("information_schema"))
      throw new IllegalArgumentException("请选择 PostgreSQL 数据库与 schema");
  }

  List<String> databases(String id) throws Exception {
    try (var c = db.open(new DbRef(id, ""));
        var s = c.createStatement();
        var rs =
            s.executeQuery(
                "SELECT datname FROM pg_database WHERE NOT datistemplate AND datallowconn AND"
                    + " has_database_privilege(datname,'CONNECT') ORDER BY datname")) {
      var allowed = Json.strings(db.store.get("connection", id).path("databases"));
      var result = new ArrayList<String>();
      while (rs.next())
        if (allowed.isEmpty() || allowed.contains(rs.getString(1))) result.add(rs.getString(1));
      return result;
    }
  }

  List<String> schemas(DbRef ref) throws Exception {
    if (!db.type(ref).equals("postgresql"))
      throw new IllegalArgumentException("仅 PostgreSQL 支持独立 schema");
    try (var c = db.open(ref);
        var s = c.createStatement();
        var rs =
            s.executeQuery(
                "SELECT nspname FROM pg_namespace WHERE nspname <> 'information_schema' AND nspname"
                    + " NOT LIKE 'pg_%' AND has_schema_privilege(oid,'USAGE') ORDER BY nspname")) {
      var result = new ArrayList<String>();
      while (rs.next()) result.add(rs.getString(1));
      return result;
    }
  }

  public List<Map<String, Object>> tables(DbRef ref) throws Exception {
    namespace(ref);
    try (var c = db.open(ref);
        var p =
            c.prepareStatement(
                "SELECT c.relname,COALESCE(obj_description(c.oid),'') FROM pg_class c JOIN"
                    + " pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=? AND c.relkind='r'"
                    + " AND NOT c.relispartition ORDER BY c.relname")) {
      p.setString(1, ref.schema());
      try (var rs = p.executeQuery()) {
        var result = new ArrayList<Map<String, Object>>();
        while (rs.next()) result.add(Map.of("name", rs.getString(1), "comment", rs.getString(2)));
        return result;
      }
    }
  }

  public Table snapshot(Connection c, DbRef ref, String name, boolean data) throws Exception {
    namespace(ref);
    var table = new Table();
    table.name = name;
    table.databaseType = "postgresql";
    table.attributes.put("schema", ref.schema());
    table.engine = "PostgreSQL";
    table.charset = "UTF8";
    table.collation = "";
    table.comment = "";
    long oid;
    try (var p =
        c.prepareStatement(
            "SELECT"
                + " c.oid,c.relkind,c.relispartition,COALESCE(obj_description(c.oid),''),c.relrowsecurity"
                + " FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=?"
                + " AND c.relname=?")) {
      p.setString(1, ref.schema());
      p.setString(2, name);
      try (var rs = p.executeQuery()) {
        if (!rs.next()) {
          table.exists = false;
          return table;
        }
        oid = rs.getLong(1);
        table.comment = rs.getString(4);
        if (!rs.getString(2).equals("r") || rs.getBoolean(3) || rs.getBoolean(5))
          table.issues.add("不支持视图、分区或行级安全策略");
      }
    }
    var defaults = new TreeMap<String, Object>();
    table.attributes.put("columnDefaults", defaults);
    try (var p =
        c.prepareStatement(
            "SELECT a.attname,format_type(a.atttypid,a.atttypmod),NOT"
                + " a.attnotnull,pg_get_expr(d.adbin,d.adrelid),COALESCE(col_description(a.attrelid,a.attnum),''),a.attnum,a.attidentity,a.attgenerated,t.typname,tn.nspname,COALESCE(co.collname,''),COALESCE(co.collisdeterministic,true),COALESCE(co.collnamespace='pg_catalog'::regnamespace,true),COALESCE(d.adbin::text"
                + " LIKE '{CONST %',false) FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid"
                + " JOIN pg_namespace tn ON tn.oid=t.typnamespace LEFT JOIN pg_attrdef d ON"
                + " d.adrelid=a.attrelid AND d.adnum=a.attnum LEFT JOIN pg_collation co ON"
                + " co.oid=a.attcollation WHERE a.attrelid=? AND a.attnum>0 AND NOT a.attisdropped"
                + " ORDER BY a.attnum")) {
      p.setLong(1, oid);
      try (var rs = p.executeQuery()) {
        int order = 0;
        while (rs.next()) {
          String type = rs.getString(9), def = rs.getString(4);
          defaults.put(
              rs.getString(1),
              Map.of(
                  "kind",
                  def == null ? "NONE" : rs.getBoolean(14) ? "LITERAL" : "EXPRESSION",
                  "native",
                  def == null ? "" : def));
          if (!rs.getString(10).equals("pg_catalog")
              || !List.of(
                      "int2",
                      "int4",
                      "int8",
                      "numeric",
                      "float4",
                      "float8",
                      "bool",
                      "text",
                      "varchar",
                      "bpchar",
                      "bytea",
                      "date",
                      "time",
                      "timestamp",
                      "timestamptz",
                      "uuid")
                  .contains(type)) table.issues.add("不支持的字段类型：" + rs.getString(1));
          if (!rs.getString(7).isEmpty()
              || !rs.getString(8).isEmpty()
              || def != null && (def.contains("nextval(") || def.contains("regclass")))
            table.issues.add("不支持 identity、serial、生成列或序列默认值");
          if (!rs.getBoolean(13)) table.issues.add("不支持自定义排序规则");
          if (!rs.getBoolean(12)) table.issues.add("不支持不确定性排序规则");
          var col =
              new Column(
                  rs.getString(1),
                  rs.getString(2),
                  rs.getBoolean(3),
                  def,
                  "",
                  rs.getString(5),
                  ++order,
                  "",
                  "",
                  rs.getString(11));
          col =
              new Column(
                  col.name(),
                  col.type(),
                  col.nullable(),
                  col.defaultValue(),
                  col.extra(),
                  col.comment(),
                  col.ordinal(),
                  PostgresSql.definition(col),
                  "",
                  col.collation());
          table.columns.add(col);
        }
      }
    }
    // 非系统默认表达式依赖可能执行未选函数，不能隐式迁移。
    try (var p =
        c.prepareStatement(
            "SELECT COUNT(*) FROM pg_depend dep JOIN pg_attrdef d ON dep.objid=d.oid JOIN pg_class"
                + " obj ON dep.refobjid=obj.oid JOIN pg_namespace n ON obj.relnamespace=n.oid WHERE"
                + " dep.classid='pg_attrdef'::regclass AND dep.refclassid='pg_class'::regclass AND"
                + " d.adrelid=? AND dep.refobjid<>?")) {
      p.setLong(1, oid);
      p.setLong(2, oid);
      try (var rs = p.executeQuery()) {
        rs.next();
        if (rs.getInt(1) > 0) table.issues.add("默认值依赖其他数据库对象");
      }
    }
    try (var p =
        c.prepareStatement(
            "SELECT COUNT(*) FROM pg_trigger WHERE tgrelid=? AND NOT tgisinternal")) {
      p.setLong(1, oid);
      try (var rs = p.executeQuery()) {
        rs.next();
        if (rs.getInt(1) > 0) table.issues.add("不支持触发器");
      }
    }
    try (var p =
        c.prepareStatement(
            "SELECT"
                + " conname,contype,pg_get_constraintdef(oid),confrelid,conkey,confkey,oid,confupdtype,confdeltype,confmatchtype,condeferrable,condeferred"
                + " FROM pg_constraint WHERE conrelid=? ORDER BY conname")) {
      p.setLong(1, oid);
      try (var rs = p.executeQuery()) {
        while (rs.next()) {
          String kind = rs.getString(2);
          if (kind.equals("p")) {
            try (var kp =
                c.prepareStatement(
                    "SELECT a.attname FROM pg_constraint k CROSS JOIN LATERAL unnest(k.conkey) WITH"
                        + " ORDINALITY u(num,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND"
                        + " a.attnum=u.num WHERE k.conrelid=? AND k.contype='p' ORDER BY u.ord")) {
              kp.setLong(1, oid);
              try (var kr = kp.executeQuery()) {
                while (kr.next()) table.primaryKeyColumns.add(kr.getString(1));
              }
            }
          } else if (kind.equals("f")) {
            try (var fp =
                c.prepareStatement(
                    "SELECT c.relname,n.nspname FROM pg_class c JOIN pg_namespace n ON"
                        + " n.oid=c.relnamespace WHERE c.oid=?")) {
              fp.setLong(1, rs.getLong(4));
              try (var fr = fp.executeQuery()) {
                fr.next();
                if (!ref.schema().equals(fr.getString(2))) table.issues.add("首版不支持跨 schema 外键");
                var specification = new LinkedHashMap<String, Object>();
                specification.put("columns", constraintColumns(c, rs.getLong(7), false));
                specification.put("referencedColumns", constraintColumns(c, rs.getLong(7), true));
                specification.put("referencedTable", fr.getString(1));
                specification.put("referencedSchema", fr.getString(2));
                specification.put("update", rs.getString(8));
                specification.put("delete", rs.getString(9));
                specification.put("match", rs.getString(10));
                specification.put("deferrable", rs.getBoolean(11));
                specification.put("deferred", rs.getBoolean(12));
                @SuppressWarnings("unchecked")
                var specifications =
                    (Map<String, Object>)
                        table.attributes.computeIfAbsent(
                            "foreignKeySpecs", key -> new LinkedHashMap<String, Object>());
                specifications.put(rs.getString(1), specification);
                table.foreignKeys.add(
                    new ForeignKey(
                        rs.getString(1),
                        PostgresSql.foreignKey(
                            rs.getString(1), Json.node(specification), ref.schema()),
                        fr.getString(1)));
              }
            }
          } else table.issues.add("首版不支持 CHECK、排他或 UNIQUE 约束；唯一性使用普通唯一索引");
        }
      }
    }
    try (var p =
        c.prepareStatement(
            "SELECT"
                + " i.relname,ix.indisunique,am.amname,pg_get_indexdef(ix.indexrelid),ix.indisprimary,ix.indexprs"
                + " IS NULL AND ix.indpred IS NULL AND ix.indisvalid AND ix.indnkeyatts=ix.indnatts"
                + " AND NOT EXISTS(SELECT 1 FROM unnest(ix.indclass) op(oid) JOIN pg_opclass oc ON"
                + " oc.oid=op.oid WHERE oc.opcnamespace<>'pg_catalog'::regnamespace OR NOT"
                + " oc.opcdefault) FROM pg_index ix JOIN pg_class i ON i.oid=ix.indexrelid JOIN"
                + " pg_am am ON am.oid=i.relam WHERE ix.indrelid=? ORDER BY i.relname")) {
      p.setLong(1, oid);
      try (var rs = p.executeQuery()) {
        while (rs.next()) {
          if (rs.getBoolean(5)) continue;
          if (!rs.getBoolean(6) || !rs.getString(3).equals("btree"))
            table.issues.add("不支持表达式、条件、包含列、非 btree 或自定义操作类索引");
          var columns = new ArrayList<String>();
          try (var kp =
              c.prepareStatement(
                  "SELECT a.attname FROM pg_index ix CROSS JOIN LATERAL unnest(ix.indkey) WITH"
                      + " ORDINALITY u(num,ord) JOIN pg_attribute a ON a.attrelid=ix.indrelid AND"
                      + " a.attnum=u.num WHERE ix.indexrelid=(SELECT oid FROM pg_class WHERE"
                      + " relname=? AND relnamespace=(SELECT oid FROM pg_namespace WHERE"
                      + " nspname=?)) ORDER BY u.ord")) {
            kp.setString(1, rs.getString(1));
            kp.setString(2, ref.schema());
            try (var kr = kp.executeQuery()) {
              while (kr.next()) columns.add(kr.getString(1));
            }
          }
          String definition = rs.getString(4);
          String marker = " USING ";
          int start = definition.indexOf(marker);
          table.indexes.add(
              new Index(
                  rs.getString(1),
                  rs.getBoolean(2),
                  rs.getString(3),
                  columns,
                  start < 0 ? definition : definition.substring(start)));
        }
      }
    }
    try (var p =
        c.prepareStatement(
            "SELECT count(*) FROM pg_index ix CROSS JOIN LATERAL unnest(ix.indclass) u(opclass)"
                + " JOIN pg_opclass op ON op.oid=u.opclass JOIN pg_namespace n ON"
                + " n.oid=op.opcnamespace WHERE ix.indrelid=? AND (n.nspname<>'pg_catalog' OR NOT"
                + " op.opcdefault)")) {
      p.setLong(1, oid);
      try (var rs = p.executeQuery()) {
        rs.next();
        if (rs.getInt(1) > 0) table.issues.add("不支持自定义或非默认索引操作符类");
      }
    }
    try (var p =
        c.prepareStatement(
            "SELECT COUNT(*) FROM pg_rewrite WHERE ev_class=? AND rulename <> '_RETURN'")) {
      p.setLong(1, oid);
      try (var rs = p.executeQuery()) {
        rs.next();
        if (rs.getInt(1) > 0) table.issues.add("不支持规则");
      }
    }
    try (var p =
        c.prepareStatement("SELECT COUNT(*) FROM pg_inherits WHERE inhrelid=? OR inhparent=?")) {
      p.setLong(1, oid);
      p.setLong(2, oid);
      try (var rs = p.executeQuery()) {
        rs.next();
        if (rs.getInt(1) > 0) table.issues.add("不支持继承表");
      }
    }
    try (var p =
        c.prepareStatement(
            "SELECT COUNT(*) FROM pg_depend dep JOIN pg_attrdef d ON dep.objid=d.oid JOIN pg_proc"
                + " proc ON dep.refobjid=proc.oid JOIN pg_namespace n ON proc.pronamespace=n.oid"
                + " WHERE dep.classid='pg_attrdef'::regclass AND dep.refclassid='pg_proc'::regclass"
                + " AND d.adrelid=? AND n.nspname <> 'pg_catalog'")) {
      p.setLong(1, oid);
      try (var rs = p.executeQuery()) {
        rs.next();
        if (rs.getInt(1) > 0) table.issues.add("默认值依赖自定义函数");
      }
    }
    table.supported = table.issues.isEmpty();
    table.createSql = PostgresSql.create(table, ref);
    if (data && table.supported) table.rows = db.readRows(c, ref, name, 20000);
    return table;
  }

  private List<String> constraintColumns(Connection c, long constraint, boolean referenced)
      throws SQLException {
    String column = referenced ? "confkey" : "conkey",
        relation = referenced ? "confrelid" : "conrelid";
    try (var p =
        c.prepareStatement(
            "SELECT a.attname FROM pg_constraint k CROSS JOIN LATERAL unnest(k."
                + column
                + ") WITH ORDINALITY u(num,ord) JOIN pg_attribute a ON a.attrelid=k."
                + relation
                + " AND a.attnum=u.num WHERE k.oid=? ORDER BY u.ord")) {
      p.setLong(1, constraint);
      try (var rs = p.executeQuery()) {
        var names = new ArrayList<String>();
        while (rs.next()) names.add(rs.getString(1));
        return names;
      }
    }
  }

  public void keyTokens(Connection c, DbRef ref, Table table, List<String> keys) throws Exception {
    // 确定性文本比较使用原值；bpchar 的尾部空格和 numeric 标度需规范化。
    Planner.byKey(table.rows, keys);
    for (var row : table.rows) {
      var values = new ArrayList<Object>();
      for (String key : keys) {
        var col =
            table.columns.stream().filter(x -> x.name().equals(key)).findFirst().orElseThrow();
        Object value = row.get(key);
        if (col.type().startsWith("character(") && value instanceof String text)
          value = text.replaceFirst(" +$", "");
        values.add(value);
      }
      table.keyTokens.put(Json.hash(row), Json.hash(values));
    }
    Planner.keyed(table, keys);
  }

  public int incomingForeignKeys(Connection c, DbRef ref, String table, String column)
      throws SQLException {
    String sql =
        "SELECT COUNT(*) FROM pg_constraint k JOIN pg_class t ON t.oid=k.confrelid JOIN"
            + " pg_namespace n ON n.oid=t.relnamespace WHERE k.contype='f' AND n.nspname=? AND"
            + " t.relname=?"
            + (column == null
                ? ""
                : " AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attname=?"
                    + " AND a.attnum=ANY(k.confkey))");
    try (var p = c.prepareStatement(sql)) {
      p.setString(1, ref.schema());
      p.setString(2, table);
      if (column != null) p.setString(3, column);
      try (var rs = p.executeQuery()) {
        rs.next();
        return rs.getInt(1);
      }
    }
  }
}
