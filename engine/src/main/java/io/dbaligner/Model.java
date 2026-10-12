package io.dbaligner;

import java.util.*;

public final class Model {
  public record DbRef(String connectionId, String database) {
    public String key() {
      return connectionId + "/" + database;
    }
  }

  public record Column(
      String name,
      String type,
      boolean nullable,
      String defaultValue,
      String extra,
      String comment,
      int ordinal,
      String definition,
      String generation,
      String collation) {}

  public record Index(
      String name, boolean unique, String type, List<String> columns, String definition) {}

  public record ForeignKey(String name, String definition, String referencedTable) {}

  public static class Table {
    public String name, createSql, engine, charset, collation, comment;
    public boolean exists = true, supported = true;
    public List<String> issues = new ArrayList<>();
    public List<Column> columns = new ArrayList<>();
    public List<Index> indexes = new ArrayList<>();
    public List<ForeignKey> foreignKeys = new ArrayList<>();
    public List<Map<String, Object>> rows = new ArrayList<>();
    public Map<String, String> keyTokens = new LinkedHashMap<>();

    public List<String> primaryKey() {
      return indexes.stream()
          .filter(i -> i.name().equals("PRIMARY"))
          .findFirst()
          .map(Index::columns)
          .orElse(List.of());
    }
  }

  public record StructureOptions(
      boolean columns,
      boolean columnOrder,
      boolean tableComment,
      boolean columnComments,
      boolean indexes,
      boolean foreignKeys,
      boolean tableCollation) {
    public static StructureOptions all() {
      return new StructureOptions(true, true, true, true, true, true, true);
    }

    public boolean full() {
      return columns
          && columnOrder
          && tableComment
          && columnComments
          && indexes
          && foreignKeys
          && tableCollation;
    }

    public boolean any() {
      return columns
          || columnOrder
          || tableComment
          || columnComments
          || indexes
          || foreignKeys
          || tableCollation;
    }
  }

  public record TableChoice(
      String name,
      boolean structure,
      boolean data,
      List<String> keyColumns,
      StructureOptions structureOptions) {
    public TableChoice(String name, boolean structure, boolean data, List<String> keyColumns) {
      this(name, structure, data, keyColumns, null);
    }

    public StructureOptions options() {
      return structureOptions == null ? StructureOptions.all() : structureOptions;
    }
  }

  public static class Change {
    public String id, targetKey, table, kind, label, sql, reason = "";
    public boolean risk, selected, blocked;
    public List<String> rollbackSql = new ArrayList<>();
    public List<String> matchColumns = new ArrayList<>();
    public List<String> changedParts;

    public boolean commentOnly() {
      return "MODIFY_COLUMN".equals(kind)
          && changedParts != null
          && changedParts.equals(List.of("columnComments"));
    }

    public Map<String, Object> before = new LinkedHashMap<>(), after = new LinkedHashMap<>();
  }

  public static class TargetPlan {
    public DbRef ref;
    public String label, error = "", serverVersion = "";
    public Map<String, Object> connectionIdentity = new LinkedHashMap<>();
    public Map<String, Table> before = new LinkedHashMap<>();
    public List<Change> changes = new ArrayList<>();
    public List<String> skippedTables = new ArrayList<>();
  }

  public static class SyncPlan {
    public String id, workspaceId, createdAt;
    public DbRef source;
    public List<TableChoice> tables = new ArrayList<>();
    public Map<String, Table> sourceSnapshot = new LinkedHashMap<>();
    public List<TargetPlan> targets = new ArrayList<>();
  }

  public static class Step {
    public String changeId, status = "PENDING", error = "", startedAt = "", finishedAt = "";
  }

  public static class TargetResult {
    public DbRef ref;
    public String status = "PENDING", error = "";
    public List<Step> steps = new ArrayList<>();
    public Map<String, String> backups = new LinkedHashMap<>(),
        backupDigests = new LinkedHashMap<>(),
        expected = new LinkedHashMap<>();
    public Map<String, Map<String, Object>> rowAfter = new LinkedHashMap<>();

    /** 字段原值恢复资料：仅当结构变化需要恢复字段值且计划未含数据快照时，执行前在锁内读取（上限同基础数据）。 */
    public Map<String, List<Map<String, Object>>> recoveryRows = new LinkedHashMap<>();

    public Map<String, String> recoveryDigests = new LinkedHashMap<>();
  }

  public static class SyncRecord {
    public String id,
        workspaceId,
        createdAt,
        mode,
        status = "UNEXECUTED",
        remark = "",
        parentId = "",
        archivePath = "";
    public String recoveryFormat = "";
    public SyncPlan plan;
    public List<String> selectedIds = new ArrayList<>();
    public List<TargetResult> results = new ArrayList<>();
  }

  public static class RollbackItem {
    public String id, targetKey, table, label, reason = "";
    public boolean eligible, selected;
    public List<String> sql = new ArrayList<>();
  }

  public static class RollbackPlan {
    public String id, recordId;
    public List<RollbackItem> items = new ArrayList<>();
  }

  public record SchemaExportOptions(DbRef source, List<String> tables, boolean includeDrop) {}
}
