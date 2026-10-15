package io.dbaligner;

/** 数据库入口；历史调用保持兼容，数据库行为由适配器实现。 */
public final class Database extends MySqlAdapter {
  private final PostgresAdapter postgres;

  public Database(Store store) {
    super(store);
    postgres = new PostgresAdapter(this);
  }

  public String type(Model.DbRef ref) throws Exception {
    var cfg = store.get("connection", ref.connectionId());
    if (cfg == null) throw new IllegalArgumentException("连接不存在");
    return DriverRegistry.type(cfg);
  }

  public void beginSnapshot(java.sql.Connection c) throws Exception {
    c.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ);
    c.setAutoCommit(false);
    if (!postgres.matches(c)) execute(c, "START TRANSACTION WITH CONSISTENT SNAPSHOT");
  }

  @Override
  public java.sql.Connection openConfig(
      Model.DbRef ref, com.fasterxml.jackson.databind.JsonNode cfg, String password)
      throws Exception {
    if (DriverRegistry.type(cfg).equals("mysql")) {
      if (ref.schema() != null) throw new IllegalArgumentException("MySQL 不接受独立 schema");
      return super.openConfig(ref, cfg, password);
    }
    return postgres.open(ref, cfg, password, secret(ref.connectionId() + ":certificate"));
  }

  @Override
  public void supportedServer(java.sql.Connection c) throws java.sql.SQLException {
    if (postgres.matches(c)) postgres.supportedServer(c);
    else super.supportedServer(c);
  }

  @Override
  public java.util.List<String> databases(String id) throws Exception {
    return type(new Model.DbRef(id, "")).equals("postgresql")
        ? postgres.databases(id)
        : super.databases(id);
  }

  public java.util.List<String> schemas(Model.DbRef ref) throws Exception {
    return postgres.schemas(ref);
  }

  public Object capabilities(Model.DbRef ref) throws Exception {
    try (var c = open(ref)) {
      supportedServer(c);
      return java.util.Map.of(
          "databaseType",
          type(ref),
          "serverVersion",
          version(c),
          "adapterVersion",
          "1",
          "structure",
          true,
          "data",
          true,
          "recovery",
          true,
          "unsupported",
          type(ref).equals("postgresql")
              ? java.util.List.of(
                  "columnOrder", "tableCollation", "identity", "serial", "complexObjects")
              : java.util.List.of("complexObjects"));
    }
  }

  @Override
  public java.util.List<java.util.Map<String, Object>> tables(Model.DbRef ref) throws Exception {
    return type(ref).equals("postgresql") ? postgres.tables(ref) : super.tables(ref);
  }

  @Override
  public Model.Table snapshot(java.sql.Connection c, Model.DbRef ref, String name, boolean data)
      throws Exception {
    return postgres.matches(c)
        ? postgres.snapshot(c, ref, name, data)
        : super.snapshot(c, ref, name, data);
  }

  @Override
  public void keyTokens(
      java.sql.Connection c, Model.DbRef ref, Model.Table table, java.util.List<String> keys)
      throws Exception {
    if (postgres.matches(c)) postgres.keyTokens(c, ref, table, keys);
    else super.keyTokens(c, ref, table, keys);
  }

  @Override
  public int incomingForeignKeys(
      java.sql.Connection c, Model.DbRef ref, String table, String column)
      throws java.sql.SQLException {
    return postgres.matches(c)
        ? postgres.incomingForeignKeys(c, ref, table, column)
        : super.incomingForeignKeys(c, ref, table, column);
  }

  public void close() throws Exception {
    registry.close();
  }
}
