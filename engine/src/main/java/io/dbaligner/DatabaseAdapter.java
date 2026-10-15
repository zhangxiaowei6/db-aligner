package io.dbaligner;

import static io.dbaligner.Model.*;

import java.sql.*;
import java.util.*;

/** 数据库专有元数据与键语义的共同契约；凭据和本地证据由公共入口管理。 */
public interface DatabaseAdapter {
  void supportedServer(Connection connection) throws SQLException;

  List<Map<String, Object>> tables(DbRef ref) throws Exception;

  Table snapshot(Connection connection, DbRef ref, String table, boolean data) throws Exception;

  void keyTokens(Connection connection, DbRef ref, Table table, List<String> keys) throws Exception;

  int incomingForeignKeys(Connection connection, DbRef ref, String table, String column)
      throws SQLException;
}
