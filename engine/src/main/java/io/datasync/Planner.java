package io.datasync;

import static io.datasync.Model.*;

import java.time.Instant;
import java.util.*;

public final class Planner {
  private final Database db;

  public Planner(Database db) {
    this.db = db;
  }

  public SyncPlan compare(
      String workspace, DbRef source, List<DbRef> targets, List<TableChoice> tables)
      throws Exception {
    tables = tables.stream().filter(t -> t.structure() || t.data()).toList();
    for (var choice : tables)
      if (choice.structure() && !choice.options().any())
        throw new IllegalArgumentException("请选择结构细项：" + choice.name());
    var context = ComparisonContext.CURRENT.get();
    if (context != null) context.total(tables.size() * (1 + targets.size()));
    if (targets.isEmpty()
        || tables.isEmpty()
        || tables.stream().noneMatch(t -> t.structure() || t.data()))
      throw new IllegalArgumentException("请选择目标库和需要同步的表");
    if (new HashSet<>(targets.stream().map(DbRef::key).toList()).size() != targets.size())
      throw new IllegalArgumentException("目标库重复");
    if (targets.stream().anyMatch(x -> x.equals(source)))
      throw new IllegalArgumentException("源库不能同时作为目标库");
    var p = new SyncPlan();
    p.id = "PLAN-" + UUID.randomUUID();
    p.workspaceId = workspace;
    p.createdAt = Instant.now().toString();
    p.source = source;
    p.tables = tables;
    try (var c = db.open(source)) {
      db.supportedServer(c);
      c.setTransactionIsolation(java.sql.Connection.TRANSACTION_REPEATABLE_READ);
      c.setAutoCommit(false);
      db.execute(c, "START TRANSACTION WITH CONSISTENT SNAPSHOT");
      for (var choice : tables) {
        ComparisonContext.check();
        if (context != null) context.stage(source, choice.name(), "读取源表结构");
        var t = db.snapshot(c, source, choice.name(), choice.data());
        if (!t.exists) throw new IllegalArgumentException("源表不存在：" + choice.name());
        if (choice.data() && t.supported)
          try {
            db.keyTokens(
                c, source, t, choice.keyColumns().isEmpty() ? t.primaryKey() : choice.keyColumns());
          } catch (IllegalArgumentException ignored) {
          }
        p.sourceSnapshot.put(choice.name(), t);
        if (context != null) context.done();
      }
    }
    for (var target : targets) {
      ComparisonContext.check();
      var tp = new TargetPlan();
      tp.ref = target;
      tp.label = target.database();
      p.targets.add(tp);
      int targetCompleted = 0;
      try (var c = db.openForCompare(tp)) {
        db.supportedServer(c);
        tp.serverVersion = db.version(c);
        for (var choice : tables) {
          ComparisonContext.check();
          if (context != null) context.stage(target, choice.name(), "读取目标表结构");
          try {
            var a = p.sourceSnapshot.get(choice.name());
            var b = db.snapshot(c, target, choice.name(), choice.data());
            if (choice.data() && b.supported)
              try {
                db.keyTokens(
                    c,
                    target,
                    b,
                    choice.keyColumns().isEmpty() ? a.primaryKey() : choice.keyColumns());
              } catch (IllegalArgumentException ignored) {
              }
            tp.before.put(choice.name(), b);
            if (context != null) {
              context.stage(target, choice.name(), "生成差异");
            }
            if (!b.exists && choice.structure() && !choice.options().full()) {
              blocked(tp, a.name, "目标表不存在", "部分结构细项不能创建完整表，请启用全部结构细项或先创建目标表");
              continue;
            }
            if (!a.supported || !b.supported) {
              blocked(
                  tp, a.name, "不支持的表定义", String.join("；", a.issues) + String.join("；", b.issues));
              continue;
            }
            if (choice.data()
                && (!"InnoDB".equalsIgnoreCase(a.engine)
                    || (b.exists && !"InnoDB".equalsIgnoreCase(b.engine)))) {
              blocked(tp, a.name, "数据同步被阻止", "首版数据同步仅支持 InnoDB");
              continue;
            }
            if (choice.structure()) structure(tp, a, b, choice.options());
            else if (!b.exists) {
              blocked(tp, a.name, "目标表不存在", "请启用表结构同步或先创建目标表");
              continue;
            }
            if (choice.data()) {
              if (b.exists
                  && choice.structure()
                  && tp.changes.stream()
                      .anyMatch(
                          x ->
                              x.table.equals(a.name)
                                  && List.of("ADD_COLUMN", "DROP_COLUMN", "MODIFY_COLUMN")
                                      .contains(x.kind)
                                  && !x.commentOnly()))
                blocked(tp, a.name, "先同步字段结构", "该表字段定义发生变化，请先同步结构，再重新比较基础数据");
              else data(tp, a, b, choice.keyColumns(), !b.exists && choice.structure());
              for (var x : tp.changes)
                if (x.table.equals(a.name)
                    && x.kind.endsWith("_ROW")
                    && db.inboundWrite(c, target, x, false)) {
                  x.blocked = true;
                  x.selected = false;
                  x.reason = "该变更可能影响未备份的外键关联表，首版阻止级联修改";
                }
            }
          } finally {
            if (context != null) context.done();
            targetCompleted++;
          }
        }
      } catch (Exception e) {
        ComparisonContext.check();
        if (e instanceof java.util.concurrent.CancellationException) throw e;
        if (context != null) {
          context.stage(target, "", "目标比较失败");
          for (int i = targetCompleted; i < tables.size(); i++) context.done();
        }
        tp.error = safeMessage(e);
        tp.changes.clear();
      }
    }
    return p;
  }

  public static String safeMessage(Exception e) {
    if (e instanceof java.sql.SQLException s)
      return "数据库操作失败（SQLState " + s.getSQLState() + "，错误码 " + s.getErrorCode() + "）";
    return e.getMessage() == null ? "操作失败" : e.getMessage();
  }

  private Change add(
      TargetPlan t,
      String table,
      String kind,
      String label,
      String sql,
      List<String> rollback,
      boolean risk) {
    ComparisonContext.check();
    var x = new Change();
    x.id = UUID.randomUUID().toString();
    x.targetKey = t.ref.key();
    x.table = table;
    x.kind = kind;
    x.label = label;
    x.sql = sql;
    x.rollbackSql = rollback;
    x.risk = risk;
    x.selected = !risk;
    t.changes.add(x);
    return x;
  }

  private void blocked(TargetPlan t, String table, String label, String reason) {
    var x = add(t, table, "BLOCKED", label, "", List.of(), true);
    x.blocked = true;
    x.reason = reason;
  }

  void structure(TargetPlan t, Table source, Table target, StructureOptions options) {
    String q = Sql.qualified(t.ref, source.name);
    if (options.full()
        && t.serverVersion.startsWith("5.7")
        && (source.createSql.contains("0900_")
            || source.createSql.contains(" DESC")
            || source.columns.stream()
                .anyMatch(x -> x.type().startsWith("json") && x.defaultValue() != null))) {
      blocked(t, source.name, "跨版本语法不兼容", "源表包含目标 MySQL 5.7 不支持的定义");
      return;
    }
    if (!target.exists) {
      if (!options.full()) {
        blocked(t, source.name, "目标表不存在", "部分结构细项不能创建完整表");
        return;
      }
      add(
          t,
          source.name,
          "CREATE_TABLE",
          "创建表",
          Sql.withoutForeignKeys(Sql.createFor(source, t.ref, source.name)),
          List.of("DROP TABLE " + q),
          false);
      for (var f : source.foreignKeys)
        add(
            t,
            source.name,
            "ADD_FK",
            f.name(),
            "ALTER TABLE " + q + " ADD " + f.definition(),
            List.of("ALTER TABLE " + q + " DROP FOREIGN KEY " + Sql.id(f.name())),
            false);
      return;
    }
    if (options.columns() && !source.primaryKey().equals(target.primaryKey())) {
      blocked(t, source.name, "主键定义不同", "主键变化涉及数据标识和引用，首版阻止自动同步");
      return;
    }
    var sc = new LinkedHashMap<String, Column>();
    source.columns.forEach(x -> sc.put(x.name(), x));
    var tc = new LinkedHashMap<String, Column>();
    target.columns.forEach(x -> tc.put(x.name(), x));
    int appended = target.columns.size();
    for (var col : source.columns) {
      ComparisonContext.check();
      var old = tc.get(col.name());
      if (old == null) {
        if (!options.columns()) continue;
        var effective =
            Sql.columnWithComment(
                col,
                options.columnComments() ? col.comment() : "",
                options.columnOrder() ? col.ordinal() : ++appended);
        var x =
            add(
                t,
                source.name,
                "ADD_COLUMN",
                col.name(),
                "ALTER TABLE "
                    + q
                    + " ADD COLUMN "
                    + effective.definition()
                    + (options.columnOrder() ? position(source, col) : ""),
                List.of("ALTER TABLE " + q + " DROP COLUMN " + Sql.id(col.name())),
                false);
        x.after.put("column", Json.node(effective));
        if (options.columnOrder() && col.ordinal() > 1)
          x.after.put("previous", source.columns.get(col.ordinal() - 2).name());
      } else {
        var effective =
            Sql.columnWithComment(
                options.columns() ? col : old,
                options.columnComments() ? col.comment() : old.comment(),
                options.columnOrder() ? col.ordinal() : old.ordinal());
        var parts = new ArrayList<String>();
        if (options.columns()
            && !Sql.columnSignature(Sql.columnWithComment(col, "", 0))
                .equals(Sql.columnSignature(Sql.columnWithComment(old, "", 0))))
          parts.add("columns");
        if (options.columnOrder() && orderChanged(source, target, col)) parts.add("columnOrder");
        if (options.columnComments() && !Objects.equals(col.comment(), old.comment()))
          parts.add("columnComments");
        if (parts.isEmpty()) continue;
        boolean risk = parts.contains("columns") || parts.contains("columnOrder");
        var x =
            add(
                t,
                source.name,
                "MODIFY_COLUMN",
                col.name(),
                "ALTER TABLE "
                    + q
                    + " MODIFY COLUMN "
                    + effective.definition()
                    + (parts.contains("columnOrder") ? position(source, col) : ""),
                List.of(
                    "ALTER TABLE "
                        + q
                        + " MODIFY COLUMN "
                        + old.definition()
                        + (parts.contains("columnOrder") ? position(target, old) : "")),
                risk);
        x.changedParts = parts;
        x.before.put("column", Json.node(old));
        x.after.put("column", Json.node(effective));
        if (parts.contains("columnOrder")) {
          if (col.ordinal() > 1)
            x.after.put("previous", source.columns.get(col.ordinal() - 2).name());
          else x.after.put("first", true);
        }
        if (risk && (target.primaryKey().contains(col.name()) || target.primaryKey().isEmpty())) {
          x.blocked = true;
          x.selected = false;
          x.reason = "主键字段或无主键表的字段定义／顺序变更暂不支持可靠恢复";
        }
      }
    }
    var dropping = new ArrayList<>(target.columns);
    Collections.reverse(dropping);
    for (var old : dropping)
      if (options.columns() && !sc.containsKey(old.name())) {
        var x =
            add(
                t,
                source.name,
                "DROP_COLUMN",
                old.name(),
                "ALTER TABLE " + q + " DROP COLUMN " + Sql.id(old.name()),
                List.of(
                    "ALTER TABLE " + q + " ADD COLUMN " + old.definition() + position(target, old)),
                true);
        x.before.put("column", Json.node(old));
        if (target.primaryKey().isEmpty()
            || target.primaryKey().contains(old.name())
            || target.indexes.stream().anyMatch(i -> i.columns().contains(old.name()))
            || target.foreignKeys.stream()
                .anyMatch(f -> f.definition().contains(Sql.id(old.name())))) {
          x.blocked = true;
          x.reason = "无主键或被索引／外键引用的字段不能自动删除";
        }
      }
    var si = new LinkedHashMap<String, Index>();
    source.indexes.stream()
        .filter(i -> !i.name().equals("PRIMARY"))
        .forEach(i -> si.put(i.name(), i));
    var ti = new LinkedHashMap<String, Index>();
    target.indexes.stream()
        .filter(i -> !i.name().equals("PRIMARY"))
        .forEach(i -> ti.put(i.name(), i));
    for (var idx : source.indexes)
      if (options.indexes() && !idx.name().equals("PRIMARY")) {
        var old = ti.get(idx.name());
        if (old == null)
          add(
              t,
              source.name,
              "ADD_INDEX",
              idx.name(),
              "ALTER TABLE " + q + " ADD " + idx.definition(),
              List.of("ALTER TABLE " + q + " DROP INDEX " + Sql.id(idx.name())),
              false);
        else if (!Sql.normalized(idx.definition()).equals(Sql.normalized(old.definition()))) {
          var x =
              add(
                  t,
                  source.name,
                  "REPLACE_INDEX",
                  idx.name(),
                  "ALTER TABLE "
                      + q
                      + " DROP INDEX "
                      + Sql.id(idx.name())
                      + ", ADD "
                      + idx.definition(),
                  List.of(
                      "ALTER TABLE "
                          + q
                          + " DROP INDEX "
                          + Sql.id(idx.name())
                          + ", ADD "
                          + old.definition()),
                  true);
        }
      }
    for (var idx : target.indexes)
      if (options.indexes() && !idx.name().equals("PRIMARY") && !si.containsKey(idx.name()))
        add(
            t,
            source.name,
            "DROP_INDEX",
            idx.name(),
            "ALTER TABLE " + q + " DROP INDEX " + Sql.id(idx.name()),
            List.of("ALTER TABLE " + q + " ADD " + idx.definition()),
            true);
    var sf = new LinkedHashMap<String, ForeignKey>();
    source.foreignKeys.forEach(f -> sf.put(f.name(), f));
    var tf = new LinkedHashMap<String, ForeignKey>();
    target.foreignKeys.forEach(f -> tf.put(f.name(), f));
    for (var f : source.foreignKeys) {
      if (!options.foreignKeys()) continue;
      var old = tf.get(f.name());
      if (old == null)
        add(
            t,
            source.name,
            "ADD_FK",
            f.name(),
            "ALTER TABLE " + q + " ADD " + f.definition(),
            List.of("ALTER TABLE " + q + " DROP FOREIGN KEY " + Sql.id(f.name())),
            false);
      else if (!f.definition().equals(old.definition()))
        add(
            t,
            source.name,
            "REPLACE_FK",
            f.name(),
            "ALTER TABLE "
                + q
                + " DROP FOREIGN KEY "
                + Sql.id(f.name())
                + ", ADD "
                + f.definition(),
            List.of(
                "ALTER TABLE "
                    + q
                    + " DROP FOREIGN KEY "
                    + Sql.id(f.name())
                    + ", ADD "
                    + old.definition()),
            true);
    }
    for (var f : target.foreignKeys)
      if (options.foreignKeys() && !sf.containsKey(f.name()))
        add(
            t,
            source.name,
            "DROP_FK",
            f.name(),
            "ALTER TABLE " + q + " DROP FOREIGN KEY " + Sql.id(f.name()),
            List.of("ALTER TABLE " + q + " ADD " + f.definition()),
            true);
    if (options.tableComment() && !Objects.equals(source.comment, target.comment))
      add(
          t,
          source.name,
          "TABLE_COMMENT",
          "表注释",
          "ALTER TABLE " + q + " COMMENT=" + Sql.quote(source.comment),
          List.of("ALTER TABLE " + q + " COMMENT=" + Sql.quote(target.comment)),
          false);
    if (options.tableCollation()
        && (!Objects.equals(source.charset, target.charset)
            || !Objects.equals(source.collation, target.collation))) {
      var x =
          add(
              t,
              source.name,
              "TABLE_COLLATION",
              "字符集与排序规则",
              "ALTER TABLE "
                  + q
                  + " DEFAULT CHARACTER SET "
                  + Sql.id(source.charset)
                  + " COLLATE "
                  + Sql.id(source.collation),
              List.of(
                  "ALTER TABLE "
                      + q
                      + " DEFAULT CHARACTER SET "
                      + Sql.id(target.charset)
                      + " COLLATE "
                      + Sql.id(target.collation)),
              true);
    }
    for (var change : t.changes) {
      if (!source.name.equals(change.table) || change.blocked) continue;
      if (t.serverVersion.startsWith("5.7")) {
        boolean incompatible =
            change.kind.equals("TABLE_COLLATION") && source.collation.contains("0900_");
        if (change.after.containsKey("column")) {
          var column = Json.MAPPER.convertValue(change.after.get("column"), Column.class);
          incompatible |=
              column.collation() != null && column.collation().contains("0900_")
                  || column.type().startsWith("json") && column.defaultValue() != null;
        }
        if (change.kind.contains("INDEX")) incompatible |= change.sql.contains(" DESC");
        if (incompatible) {
          change.blocked = true;
          change.selected = false;
          change.reason = "已选变更包含目标 MySQL 5.7 不支持的定义";
        }
      }
      if (change.after.containsKey("previous")) {
        String previous = change.after.get("previous").toString();
        if (!tc.containsKey(previous)
            && t.changes.stream()
                .noneMatch(
                    x ->
                        x.table.equals(source.name)
                            && x.kind.equals("ADD_COLUMN")
                            && x.label.equals(previous)
                            && !x.blocked)) {
          change.blocked = true;
          change.selected = false;
          change.reason = "字段顺序依赖未选的新增字段：" + previous;
        }
      }
      if (List.of("ADD_INDEX", "REPLACE_INDEX", "ADD_FK", "REPLACE_FK").contains(change.kind)) {
        for (var column : source.columns)
          if (change.sql.contains(Sql.id(column.name()))
              && !tc.containsKey(column.name())
              && t.changes.stream()
                  .noneMatch(
                      x ->
                          x.table.equals(source.name)
                              && x.kind.equals("ADD_COLUMN")
                              && x.label.equals(column.name())
                              && !x.blocked)) {
            change.blocked = true;
            change.selected = false;
            change.reason = "索引或外键依赖未选的新增字段：" + column.name();
          }
      }
    }
    if (options.full() && !Objects.equals(source.engine, target.engine))
      blocked(t, source.name, "存储引擎不同", "首版阻止自动更换存储引擎");
  }

  public static Map<String, Map<String, Object>> byKey(
      List<Map<String, Object>> rows, List<String> keys) {
    var r = new LinkedHashMap<String, Map<String, Object>>();
    for (var row : rows) {
      ComparisonContext.check();
      if (keys.stream().anyMatch(k -> !row.containsKey(k) || row.get(k) == null))
        throw new IllegalArgumentException("匹配键包含空值或不存在的字段");
      String k = Json.hash(keys.stream().map(row::get).toList());
      if (r.put(k, row) != null) throw new IllegalArgumentException("匹配键存在重复值，请选择唯一键");
    }
    return r;
  }

  public static Map<String, Map<String, Object>> keyed(Table table, List<String> keys) {
    var fallback = byKey(table.rows, keys);
    if (table.keyTokens.isEmpty()) return fallback;
    var result = new LinkedHashMap<String, Map<String, Object>>();
    for (var row : table.rows) {
      ComparisonContext.check();
      String token = table.keyTokens.get(Json.hash(row));
      if (token == null) throw new IllegalArgumentException("比较期间数据发生变化，请重新比较");
      if (result.put(token, row) != null) throw new IllegalArgumentException("匹配键按数据库排序规则存在重复值");
    }
    return result;
  }

  private void data(TargetPlan tp, Table s, Table t, List<String> inputKeys, boolean structure) {
    try {
      List<String> keys = inputKeys == null || inputKeys.isEmpty() ? s.primaryKey() : inputKeys;
      if (keys.isEmpty()) throw new IllegalArgumentException("表无主键，请指定唯一业务键");
      if (!structure
          && !s.columns.stream()
              .map(Column::name)
              .allMatch(n -> t.columns.stream().anyMatch(c -> c.name().equals(n))))
        throw new IllegalArgumentException("目标表缺少源字段，请先同步结构");
      for (String key : keys) {
        var a = s.columns.stream().filter(c -> c.name().equals(key)).findFirst().orElseThrow();
        var b = t.columns.stream().filter(c -> c.name().equals(key)).findFirst();
        if (b.isPresent() && !Objects.equals(a.collation(), b.get().collation()))
          throw new IllegalArgumentException("匹配键排序规则不同，请先同步字段结构：" + key);
      }
      var source = keyed(s, keys);
      var target = keyed(t, keys);
      String q = Sql.qualified(tp.ref, s.name);
      boolean business = !keys.equals(s.primaryKey());
      for (var entry : source.entrySet()) {
        ComparisonContext.check();
        var src = entry.getValue();
        var before = target.get(entry.getKey());
        var after = new LinkedHashMap<String, Object>();
        if (before != null) after.putAll(before);
        for (var col : s.columns) {
          if (business
              && s.primaryKey().contains(col.name())
              && (before != null
                  || col.extra().contains("auto_increment") && !keys.contains(col.name())))
            continue;
          after.put(col.name(), src.get(col.name()));
        }
        if (before == null) {
          var cols = new ArrayList<>(after.keySet());
          String sql =
              "INSERT INTO "
                  + q
                  + " ("
                  + cols.stream().map(Sql::id).collect(java.util.stream.Collectors.joining(","))
                  + ") VALUES ("
                  + cols.stream()
                      .map(k -> Sql.value(after.get(k)))
                      .collect(java.util.stream.Collectors.joining(","))
                  + ")";
          var x =
              add(
                  tp,
                  s.name,
                  "ADD_ROW",
                  display(src, keys),
                  sql,
                  List.of("DELETE FROM " + q + " WHERE " + Sql.where(after, keys)),
                  false);
          x.after = after;
          x.matchColumns = new ArrayList<>(keys);
        } else if (!Json.hash(before).equals(Json.hash(after))) {
          var fields = new ArrayList<String>();
          after.forEach(
              (k, v) -> {
                if (!Json.hash(v).equals(Json.hash(before.get(k)))) fields.add(k);
              });
          String set =
              fields.stream()
                  .map(k -> Sql.id(k) + "=" + Sql.value(after.get(k)))
                  .collect(java.util.stream.Collectors.joining(","));
          String reverse =
              fields.stream()
                  .map(k -> Sql.id(k) + "=" + Sql.value(before.get(k)))
                  .collect(java.util.stream.Collectors.joining(","));
          var x =
              add(
                  tp,
                  s.name,
                  "UPDATE_ROW",
                  display(src, keys),
                  "UPDATE "
                      + q
                      + " SET "
                      + set
                      + " WHERE "
                      + Sql.where(before, new ArrayList<>(before.keySet())),
                  List.of(
                      "UPDATE "
                          + q
                          + " SET "
                          + reverse
                          + " WHERE "
                          + Sql.where(after, new ArrayList<>(after.keySet()))),
                  false);
          x.before = before;
          x.matchColumns = new ArrayList<>(keys);
          x.after = after;
          x.matchColumns = new ArrayList<>(keys);
        }
      }
      for (var entry : target.entrySet())
        if (!source.containsKey(entry.getKey())) {
          var before = entry.getValue();
          var cols = new ArrayList<>(before.keySet());
          String restore =
              "INSERT INTO "
                  + q
                  + " ("
                  + cols.stream().map(Sql::id).collect(java.util.stream.Collectors.joining(","))
                  + ") VALUES ("
                  + cols.stream()
                      .map(k -> Sql.value(before.get(k)))
                      .collect(java.util.stream.Collectors.joining(","))
                  + ")";
          var x =
              add(
                  tp,
                  s.name,
                  "DELETE_ROW",
                  display(before, keys),
                  "DELETE FROM " + q + " WHERE " + Sql.where(before, cols),
                  List.of(restore),
                  true);
          x.before = before;
          x.matchColumns = new ArrayList<>(keys);
        }
    } catch (Exception e) {
      ComparisonContext.check();
      if (e instanceof java.util.concurrent.CancellationException cancelled) throw cancelled;
      tp.changes.removeIf(x -> x.table.equals(s.name) && x.kind.endsWith("_ROW"));
      blocked(tp, s.name, "数据匹配失败", safeMessage(e));
    }
  }

  private static boolean orderChanged(Table source, Table target, Column c) {
    var common =
        source.columns.stream()
            .map(Column::name)
            .filter(n -> target.columns.stream().anyMatch(t -> t.name().equals(n)))
            .toList();
    var targetCommon = target.columns.stream().map(Column::name).filter(common::contains).toList();
    int a = common.indexOf(c.name()), b = targetCommon.indexOf(c.name());
    return !Objects.equals(a == 0 ? "" : common.get(a - 1), b == 0 ? "" : targetCommon.get(b - 1));
  }

  private static String position(Table t, Column c) {
    return c.ordinal() == 1 ? " FIRST" : " AFTER " + Sql.id(t.columns.get(c.ordinal() - 2).name());
  }

  private String display(Map<String, Object> row, List<String> keys) {
    return keys.stream()
        .map(k -> k + " = " + Objects.toString(row.get(k), "NULL"))
        .collect(java.util.stream.Collectors.joining(" / "));
  }
}
