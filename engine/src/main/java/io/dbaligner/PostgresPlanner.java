package io.dbaligner;

import static io.dbaligner.Model.*;

import java.util.*;
import java.util.stream.Collectors;

/** 从结构化变更生成 PostgreSQL SQL，每个变更可包含多条语句。 */
public final class PostgresPlanner {
  private Change add(
      TargetPlan target,
      String table,
      String kind,
      String label,
      List<String> sql,
      List<String> inverse,
      boolean risk) {
    ComparisonContext.check();
    var change = new Change();
    change.id = UUID.randomUUID().toString();
    change.targetKey = target.ref.key();
    change.table = table;
    change.kind = kind;
    change.label = label;
    change.statements = sql;
    change.sql = String.join(";\n", sql);
    change.rollbackSql = inverse;
    change.risk = risk;
    change.selected = !risk;
    target.changes.add(change);
    return change;
  }

  private void blocked(TargetPlan target, String table, String reason) {
    var change = add(target, table, "BLOCKED", reason, List.of(), List.of(), true);
    change.blocked = true;
    change.reason = reason;
  }

  public static String indexSql(DbRef ref, String table, Index index) {
    return "CREATE "
        + (index.unique() ? "UNIQUE " : "")
        + "INDEX "
        + PostgresSql.id(index.name())
        + " ON "
        + Sql.qualified(ref, table)
        + index.definition();
  }

  private String dropIndex(DbRef ref, Index index) {
    return "DROP INDEX " + PostgresSql.id(ref.schema()) + "." + PostgresSql.id(index.name());
  }

  private List<String> modify(DbRef ref, String table, Column from, Column to) {
    String q =
        "ALTER TABLE " + Sql.qualified(ref, table) + " ALTER COLUMN " + PostgresSql.id(to.name());
    var sql = new ArrayList<String>();
    if (!Objects.equals(from.type(), to.type())) {
      sql.add(q + " DROP DEFAULT");
      sql.add(q + " TYPE " + to.type() + " USING " + PostgresSql.id(to.name()) + "::" + to.type());
    }
    if (!Objects.equals(from.defaultValue(), to.defaultValue())
        || !Objects.equals(from.type(), to.type()))
      sql.add(
          q + (to.defaultValue() == null ? " DROP DEFAULT" : " SET DEFAULT " + to.defaultValue()));
    if (from.nullable() != to.nullable())
      sql.add(q + (to.nullable() ? " DROP NOT NULL" : " SET NOT NULL"));
    if (!Objects.equals(from.comment(), to.comment()))
      sql.addAll(PostgresSql.comment(ref, table, to));
    return sql;
  }

  void structure(TargetPlan target, Table source, Table before, StructureOptions options) {
    String q = Sql.qualified(target.ref, source.name);
    // 顺序和表级字符集不是 PostgreSQL 支持的可修改属性；只在实际请求有差异时阻止。
    if (options.columnOrder()
        && before.exists
        && !source.columns.stream()
            .map(Column::name)
            .filter(n -> before.columns.stream().anyMatch(c -> c.name().equals(n)))
            .toList()
            .equals(
                before.columns.stream()
                    .map(Column::name)
                    .filter(n -> source.columns.stream().anyMatch(c -> c.name().equals(n)))
                    .toList())) {
      blocked(target, source.name, "PostgreSQL 不支持调整字段物理顺序，请关闭字段顺序选项");
      return;
    }
    if (before.exists && options.columns() && !source.primaryKey().equals(before.primaryKey())) {
      blocked(target, source.name, "主键变更不支持自动同步");
      return;
    }
    if (!before.exists) {
      var lines = new ArrayList<String>();
      lines.add(PostgresSql.create(source, target.ref));
      lines.add("COMMENT ON TABLE " + q + " IS " + PostgresSql.literal(source.comment));
      for (var col : source.columns)
        lines.addAll(PostgresSql.comment(target.ref, source.name, col));
      add(target, source.name, "CREATE_TABLE", "创建表", lines, List.of("DROP TABLE " + q), false);
    } else {
      for (var col : source.columns) {
        var old =
            before.columns.stream()
                .filter(c -> c.name().equals(col.name()))
                .findFirst()
                .orElse(null);
        if (old == null) {
          if (!options.columns()) continue;
          var effective =
              new Column(
                  col.name(),
                  col.type(),
                  col.nullable(),
                  col.defaultValue(),
                  col.extra(),
                  options.columnComments() ? col.comment() : "",
                  col.ordinal(),
                  col.definition(),
                  col.generation(),
                  col.collation());
          var lines = new ArrayList<String>();
          lines.add("ALTER TABLE " + q + " ADD COLUMN " + PostgresSql.definition(effective));
          lines.addAll(PostgresSql.comment(target.ref, source.name, effective));
          var x =
              add(
                  target,
                  source.name,
                  "ADD_COLUMN",
                  col.name(),
                  lines,
                  List.of("ALTER TABLE " + q + " DROP COLUMN " + PostgresSql.id(col.name())),
                  !effective.nullable() && effective.defaultValue() == null);
          x.after.put("column", Json.node(effective));
        } else {
          if (options.columns() && !Objects.equals(col.collation(), old.collation())) {
            blocked(target, source.name, "首版不支持改变字段排序规则：" + col.name());
            continue;
          }
          var effective =
              new Column(
                  old.name(),
                  options.columns() ? col.type() : old.type(),
                  options.columns() ? col.nullable() : old.nullable(),
                  options.columns() ? col.defaultValue() : old.defaultValue(),
                  old.extra(),
                  options.columnComments() ? col.comment() : old.comment(),
                  old.ordinal(),
                  old.definition(),
                  old.generation(),
                  old.collation());
          var lines = modify(target.ref, source.name, old, effective);
          if (lines.isEmpty()) continue;
          boolean definition =
              !Objects.equals(old.type(), effective.type())
                  || old.nullable() != effective.nullable()
                  || !Objects.equals(old.defaultValue(), effective.defaultValue());
          var x =
              add(
                  target,
                  source.name,
                  "MODIFY_COLUMN",
                  col.name(),
                  lines,
                  modify(target.ref, source.name, effective, old),
                  definition);
          x.before.put("column", Json.node(old));
          x.after.put("column", Json.node(effective));
          x.changedParts = definition ? List.of("columns") : List.of("columnComments");
          if (definition
              && (before.primaryKey().isEmpty() || before.primaryKey().contains(col.name()))) {
            x.blocked = true;
            x.selected = false;
            x.reason = "主键或无可靠恢复键的定义变更不能自动恢复";
          }
        }
      }
      for (var old : before.columns)
        if (options.columns()
            && source.columns.stream().noneMatch(c -> c.name().equals(old.name()))) {
          var nullable =
              new Column(
                  old.name(),
                  old.type(),
                  true,
                  null,
                  "",
                  old.comment(),
                  old.ordinal(),
                  old.definition(),
                  "",
                  old.collation());
          var inverse = new ArrayList<String>();
          inverse.add("ALTER TABLE " + q + " ADD COLUMN " + PostgresSql.definition(nullable));
          inverse.addAll(PostgresSql.comment(target.ref, source.name, old));
          var x =
              add(
                  target,
                  source.name,
                  "DROP_COLUMN",
                  old.name(),
                  List.of("ALTER TABLE " + q + " DROP COLUMN " + PostgresSql.id(old.name())),
                  inverse,
                  true);
          x.before.put("column", Json.node(old));
          x.before.put("restoreFinalize", modify(target.ref, source.name, nullable, old));
          if (before.primaryKey().isEmpty()
              || before.primaryKey().contains(old.name())
              || before.indexes.stream().anyMatch(i -> i.columns().contains(old.name()))
              || before.foreignKeys.stream()
                  .anyMatch(f -> f.definition().contains(PostgresSql.id(old.name())))) {
            x.blocked = true;
            x.reason = "无可靠恢复键或字段存在索引／外键依赖";
          }
        }
      if (options.tableComment() && !Objects.equals(source.comment, before.comment))
        add(
            target,
            source.name,
            "TABLE_COMMENT",
            "表注释",
            List.of("COMMENT ON TABLE " + q + " IS " + PostgresSql.literal(source.comment)),
            List.of("COMMENT ON TABLE " + q + " IS " + PostgresSql.literal(before.comment)),
            false);
    }
    if (options.indexes() || !before.exists) {
      for (var index : source.indexes) {
        var old =
            before.indexes.stream()
                .filter(i -> i.name().equals(index.name()))
                .findFirst()
                .orElse(null);
        if (old == null)
          add(
              target,
              source.name,
              "ADD_INDEX",
              index.name(),
              List.of(indexSql(target.ref, source.name, index)),
              List.of(dropIndex(target.ref, index)),
              false);
        else if (!old.equals(index))
          add(
              target,
              source.name,
              "REPLACE_INDEX",
              index.name(),
              List.of(dropIndex(target.ref, old), indexSql(target.ref, source.name, index)),
              List.of(dropIndex(target.ref, index), indexSql(target.ref, source.name, old)),
              true);
      }
      for (var old : before.indexes)
        if (source.indexes.stream().noneMatch(i -> i.name().equals(old.name())))
          add(
              target,
              source.name,
              "DROP_INDEX",
              old.name(),
              List.of(dropIndex(target.ref, old)),
              List.of(indexSql(target.ref, source.name, old)),
              true);
    }
    if (options.foreignKeys() || !before.exists) {
      for (var fk : source.foreignKeys) {
        var old =
            before.foreignKeys.stream()
                .filter(f -> f.name().equals(fk.name()))
                .findFirst()
                .orElse(null);
        String definition =
            PostgresSql.foreignKey(
                fk.name(),
                Json.node(source.attributes.get("foreignKeySpecs")).path(fk.name()),
                target.ref.schema());
        if (old == null)
          add(
              target,
              source.name,
              "ADD_FK",
              fk.name(),
              List.of("ALTER TABLE " + q + " ADD " + definition),
              List.of("ALTER TABLE " + q + " DROP CONSTRAINT " + PostgresSql.id(fk.name())),
              false);
        else if (!old.definition().equals(definition))
          add(
              target,
              source.name,
              "REPLACE_FK",
              fk.name(),
              List.of(
                  "ALTER TABLE " + q + " DROP CONSTRAINT " + PostgresSql.id(fk.name()),
                  "ALTER TABLE " + q + " ADD " + definition),
              List.of(
                  "ALTER TABLE " + q + " DROP CONSTRAINT " + PostgresSql.id(old.name()),
                  "ALTER TABLE " + q + " ADD " + old.definition()),
              true);
      }
      for (var old : before.foreignKeys)
        if (source.foreignKeys.stream().noneMatch(f -> f.name().equals(old.name())))
          add(
              target,
              source.name,
              "DROP_FK",
              old.name(),
              List.of("ALTER TABLE " + q + " DROP CONSTRAINT " + PostgresSql.id(old.name())),
              List.of("ALTER TABLE " + q + " ADD " + old.definition()),
              true);
    }
  }

  void data(TargetPlan target, Table source, Table before, List<String> inputKeys) {
    try {
      if (!source.columns.stream()
          .sorted(java.util.Comparator.comparing(Column::name))
          .map(c -> List.of(c.name(), c.type(), c.collation()))
          .toList()
          .equals(
              before.columns.stream()
                  .sorted(java.util.Comparator.comparing(Column::name))
                  .map(c -> List.of(c.name(), c.type(), c.collation()))
                  .toList())) throw new IllegalArgumentException("字段类型或排序规则不同，请先同步结构");
      var keys = inputKeys == null || inputKeys.isEmpty() ? source.primaryKey() : inputKeys;
      if (keys.isEmpty()) throw new IllegalArgumentException("请指定可靠的唯一匹配键");
      var a = Planner.keyed(source, keys);
      var b = Planner.keyed(before, keys);
      String q = Sql.qualified(target.ref, source.name);
      for (var entry : a.entrySet()) {
        var after = new LinkedHashMap<>(entry.getValue());
        var old = b.get(entry.getKey());
        if (old != null && !keys.equals(source.primaryKey()))
          for (String pk : source.primaryKey()) after.put(pk, old.get(pk));
        if (old == null) {
          var fields = new ArrayList<>(after.keySet());
          var x =
              add(
                  target,
                  source.name,
                  "ADD_ROW",
                  keys.stream()
                      .map(k -> String.valueOf(after.get(k)))
                      .collect(Collectors.joining(" / ")),
                  List.of(
                      "INSERT INTO "
                          + q
                          + " ("
                          + fields.stream().map(PostgresSql::id).collect(Collectors.joining(","))
                          + ") VALUES ("
                          + fields.stream()
                              .map(k -> PostgresSql.value(after.get(k)))
                              .collect(Collectors.joining(","))
                          + ")"),
                  List.of("DELETE FROM " + q + " WHERE " + PostgresSql.where(after, keys)),
                  false);
          x.after = after;
          x.matchColumns = new ArrayList<>(keys);
        } else if (!Json.hash(old).equals(Json.hash(after))) {
          var fields =
              after.keySet().stream()
                  .filter(k -> !Json.hash(old.get(k)).equals(Json.hash(after.get(k))))
                  .toList();
          var x =
              add(
                  target,
                  source.name,
                  "UPDATE_ROW",
                  entry.getKey(),
                  List.of(
                      "UPDATE "
                          + q
                          + " SET "
                          + fields.stream()
                              .map(k -> PostgresSql.id(k) + "=" + PostgresSql.value(after.get(k)))
                              .collect(Collectors.joining(","))
                          + " WHERE "
                          + PostgresSql.where(old, new ArrayList<>(old.keySet()))),
                  List.of(
                      "UPDATE "
                          + q
                          + " SET "
                          + fields.stream()
                              .map(k -> PostgresSql.id(k) + "=" + PostgresSql.value(old.get(k)))
                              .collect(Collectors.joining(","))
                          + " WHERE "
                          + PostgresSql.where(after, new ArrayList<>(after.keySet()))),
                  false);
          x.before = new LinkedHashMap<>(old);
          x.after = after;
          x.matchColumns = new ArrayList<>(keys);
        }
      }
      for (var entry : b.entrySet())
        if (!a.containsKey(entry.getKey())) {
          var row = entry.getValue();
          var fields = new ArrayList<>(row.keySet());
          var x =
              add(
                  target,
                  source.name,
                  "DELETE_ROW",
                  entry.getKey(),
                  List.of("DELETE FROM " + q + " WHERE " + PostgresSql.where(row, fields)),
                  List.of(
                      "INSERT INTO "
                          + q
                          + " ("
                          + fields.stream().map(PostgresSql::id).collect(Collectors.joining(","))
                          + ") VALUES ("
                          + fields.stream()
                              .map(k -> PostgresSql.value(row.get(k)))
                              .collect(Collectors.joining(","))
                          + ")"),
                  true);
          x.before = new LinkedHashMap<>(row);
          x.matchColumns = new ArrayList<>(keys);
        }
    } catch (Exception e) {
      target.changes.removeIf(x -> x.table.equals(source.name) && x.kind.endsWith("_ROW"));
      blocked(target, source.name, Planner.safeMessage(e));
    }
  }
}
