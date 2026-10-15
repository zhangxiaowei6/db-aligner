package io.dbaligner;

import static io.dbaligner.Model.*;

import java.util.*;

public final class External {
  private final Store store;
  private final Database db;
  private final Archives archives;

  public External(Store s, Database d, Archives a) {
    store = s;
    db = d;
    archives = a;
  }

  public Object declare(String id, List<String> ids, boolean backup, String remark)
      throws Exception {
    var record = store.get("record", id);
    if (record == null || !record.path("mode").asText().equals("SAVE_ONLY"))
      throw new IllegalArgumentException("仅保存记录可登记外部执行");
    var r = Json.MAPPER.treeToValue(record, SyncRecord.class);
    if (ids.isEmpty() || new HashSet<>(ids).size() != ids.size() || !r.selectedIds.containsAll(ids))
      throw new IllegalArgumentException("执行范围无效");
    var state =
        Map.of(
            "id",
            id,
            "confirmedIds",
            ids,
            "backupCompleted",
            backup,
            "remark",
            remark,
            "declaredAt",
            java.time.Instant.now().toString(),
            "verified",
            false);
    store.event(id, Map.of("type", "external-declared", "declaration", state));
    return store.put("external", id, state);
  }

  public Object verify(String id) throws Exception {
    var r = Json.MAPPER.treeToValue(store.get("record", id), SyncRecord.class);
    var declaration = store.get("external", id);
    var confirmed =
        declaration == null ? List.<String>of() : Json.strings(declaration.path("confirmedIds"));
    boolean local = r.recoveryFormat.equals("LOCAL_V1");
    boolean all = declaration != null && (local || declaration.path("backupCompleted").asBoolean());
    var results = new ArrayList<TargetResult>();
    var checks = new ArrayList<Map<String, Object>>();
    for (var tp : r.plan.targets) {
      var chosen = archives.chosen(r, tp).stream().filter(c -> confirmed.contains(c.id)).toList();
      if (chosen.isEmpty()) continue;
      var tr = new TargetResult();
      tr.ref = tp.ref;
      if (local)
        r.results.stream()
            .filter(t -> t.ref.equals(tp.ref))
            .findFirst()
            .ifPresent(
                saved -> {
                  tr.recoveryRows.putAll(saved.recoveryRows);
                  tr.recoveryDigests.putAll(saved.recoveryDigests);
                });
      results.add(tr);
      try (var c = db.openBound(tp.ref, tp.connectionIdentity)) {
        for (String name : chosen.stream().map(x -> x.table).distinct().toList()) {
          var actual = db.snapshot(c, tp.ref, name, true);
          var keyColumns =
              r.plan.tables.stream()
                  .filter(t -> t.name().equals(name))
                  .findFirst()
                  .orElseThrow()
                  .keyColumns();
          if (keyColumns.isEmpty()) keyColumns = r.plan.sourceSnapshot.get(name).primaryKey();
          if (!keyColumns.isEmpty()) {
            db.keyTokens(c, tp.ref, actual, keyColumns);
            Planner.keyed(actual, keyColumns);
          }
          boolean valid = local || legacyEvidence(r, tp, tr, name, actual, c);
          String reason = valid ? "" : "旧记录的执行凭据、备份或执行后快照缺失／不一致";
          for (var x : chosen.stream().filter(x -> x.table.equals(name)).toList())
            if (!matches(x, actual, r.plan.sourceSnapshot.get(name), c, tp.ref)) {
              valid = false;
              reason = "目标状态不符合选中变更：" + x.label;
            }
          if (valid) {
            tr.expected.put(name, db.digest(c, tp.ref, name));
            for (var x :
                chosen.stream()
                    .filter(
                        x ->
                            x.table.equals(name)
                                && x.kind.endsWith("_ROW")
                                && !x.kind.equals("DELETE_ROW"))
                    .toList()) {
              var afterRow = db.rowFor(c, tp.ref, name, x.after, x.matchColumns);
              if (afterRow != null) tr.rowAfter.put(x.id, afterRow);
            }
          }
          boolean recoveryAvailable =
              chosen.stream()
                      .filter(x -> x.table.equals(name))
                      .noneMatch(Archives::needsValueRestore)
                  || Archives.valueRestoreAvailable(r, tp, tr, name);
          all = all && valid;
          checks.add(
              Map.of(
                  "target",
                  tp.ref.key(),
                  "table",
                  name,
                  "valid",
                  valid,
                  "declaredIds",
                  chosen.stream().filter(x -> x.table.equals(name)).map(x -> x.id).toList(),
                  "recoveryAvailable",
                  recoveryAvailable,
                  "message",
                  valid
                      ? "用户声明范围的当前状态验证通过；" + (recoveryAvailable ? "恢复资料可用" : "字段原值资料缺失或摘要不符，需人工恢复")
                      : reason));
          for (var x : chosen.stream().filter(x -> x.table.equals(name)).toList()) {
            var st = new Step();
            st.changeId = x.id;
            st.status = valid ? "DONE" : "UNKNOWN";
            tr.steps.add(st);
          }
        }
        tr.status =
            tr.steps.stream().allMatch(s -> s.status.equals("DONE")) ? "VERIFIED" : "UNKNOWN";
      } catch (Exception e) {
        all = false;
        tr.status = "UNKNOWN";
        checks.add(
            Map.of(
                "target",
                tp.ref.key(),
                "table",
                "",
                "valid",
                false,
                "message",
                Planner.safeMessage(e)));
      }
    }
    if (confirmed.isEmpty()) all = false;
    var state = Json.MAPPER.createObjectNode();
    if (declaration != null)
      state.setAll((com.fasterxml.jackson.databind.node.ObjectNode) declaration);
    state.put("id", id);
    state.put("verified", all);
    state.put("verifiedAt", java.time.Instant.now().toString());
    state.set("results", Json.node(results));
    state.set("checks", Json.node(checks));
    store.event(id, Map.of("type", "external-verified", "evidence", state));
    store.put("external", id, state);
    return state;
  }

  /** 只读取旧脚本已创建的资料；新记录永远不会创建或依赖目标库辅助对象。 */
  private boolean legacyEvidence(
      SyncRecord r,
      TargetPlan tp,
      TargetResult proof,
      String name,
      Table actual,
      java.sql.Connection c)
      throws Exception {
    boolean receiptValid = false;
    try (var s = c.createStatement();
        var rs =
            s.executeQuery(
                "SELECT stage,record_id,plan_hash FROM "
                    + Sql.qualified(tp.ref, Archives.receiptName(r.id)))) {
      var stages = new HashSet<String>();
      while (rs.next())
        if (rs.getString(2).equals(r.id) && rs.getString(3).equals(Json.hash(r.plan)))
          stages.add(rs.getString(1));
      receiptValid = stages.containsAll(List.of("prepared", "applied"));
    } catch (java.sql.SQLException ignored) {
    }
    if (!receiptValid) return false;
    String post = Archives.postName(r.id, tp.ref.key(), name);
    var postTable = db.snapshot(c, tp.ref, post, false);
    if (!postTable.exists
        || !sameColumns(actual, postTable)
        || !db.rowsDigest(c, tp.ref, name).equals(db.rowsDigest(c, tp.ref, post))) return false;
    var old = tp.before.get(name);
    if (old.exists) {
      String backupName = Archives.backupName(r.id, tp.ref.key(), name);
      boolean data = r.plan.tables.stream().anyMatch(t -> t.name().equals(name) && t.data());
      var backup = db.snapshot(c, tp.ref, backupName, data);
      if (!backup.exists
          || !sameColumns(old, backup)
          || data && !Jobs.rowSetHash(old.rows).equals(Jobs.rowSetHash(backup.rows))) return false;
      proof.backups.put(name, backupName);
      proof.backupDigests.put(name, db.digest(c, tp.ref, backupName));
    }
    return true;
  }

  private boolean sameColumns(Table a, Table b) {
    return a.columns.stream()
        .map(c -> List.of(c.name(), Sql.columnSignature(c)))
        .toList()
        .equals(b.columns.stream().map(c -> List.of(c.name(), Sql.columnSignature(c))).toList());
  }

  public Object audit(String id) throws Exception {
    var n = store.get("record", id);
    if (n == null) throw new IllegalArgumentException("记录不存在");
    var r = Json.MAPPER.treeToValue(n, SyncRecord.class);
    var checks = new ArrayList<Map<String, Object>>();
    for (var tp : r.plan.targets) {
      var result = r.results.stream().filter(t -> t.ref.equals(tp.ref)).findFirst().orElse(null);
      try (var c = db.openBound(tp.ref, tp.connectionIdentity)) {
        for (String table : archives.chosen(r, tp).stream().map(x -> x.table).distinct().toList()) {
          boolean data = r.plan.tables.stream().anyMatch(t -> t.name().equals(table) && t.data());
          var actual = db.snapshot(c, tp.ref, table, data);
          boolean trusted =
              result != null
                  && Objects.equals(result.expected.get(table), db.digest(c, tp.ref, table));
          boolean backupValid =
              result != null
                  && result.backups.containsKey(table)
                  && Objects.equals(
                      result.backupDigests.get(table),
                      db.digest(c, tp.ref, result.backups.get(table)));
          for (var change :
              archives.chosen(r, tp).stream().filter(x -> x.table.equals(table)).toList()) {
            String recorded =
                result == null
                    ? "PENDING"
                    : result.steps.stream()
                        .filter(st -> st.changeId.equals(change.id))
                        .findFirst()
                        .map(st -> st.status)
                        .orElse("PENDING");
            String state =
                matches(change, actual, r.plan.sourceSnapshot.get(table), c, tp.ref)
                    ? "符合变更后的状态"
                    : change.kind.endsWith("_ROW")
                            && !change.before.isEmpty()
                            && actual.rows.stream()
                                .anyMatch(
                                    row ->
                                        change.before.entrySet().stream()
                                            .allMatch(
                                                e ->
                                                    Json.hash(e.getValue())
                                                        .equals(Json.hash(row.get(e.getKey())))))
                        ? "符合变更前的状态"
                        : "不符合预期或需人工检查";
            checks.add(
                Map.of(
                    "target",
                    tp.ref.key(),
                    "table",
                    table,
                    "changeId",
                    change.id,
                    "label",
                    change.label,
                    "recordedStatus",
                    recorded,
                    "currentState",
                    state,
                    "recoveryStatus",
                    trusted
                            && recorded.equals("DONE")
                            && (!result.backups.containsKey(table) || backupValid)
                            && (!Archives.needsValueRestore(change)
                                || Archives.valueRestoreAvailable(r, tp, result, table))
                        ? "可信执行后状态一致，恢复资料可用"
                        : "缺少可信执行后证据或存在后续修改；自动恢复受限"));
          }
        }
      } catch (Exception e) {
        checks.add(
            Map.of(
                "target",
                tp.ref.key(),
                "table",
                "",
                "currentState",
                Planner.safeMessage(e),
                "recoveryStatus",
                "无法核验"));
      }
    }
    var report =
        Map.of(
            "id",
            id,
            "checkedAt",
            java.time.Instant.now().toString(),
            "notice",
            "这是当前状态核验，不能据此推断所有脚本曾成功执行；原执行记录保持不变。",
            "checks",
            checks);
    store.event(id, Map.of("type", "state-audited", "report", report));
    store.put("verification", id, report);
    return report;
  }

  private boolean matches(
      Change x, Table actual, Table source, java.sql.Connection connection, DbRef ref)
      throws Exception {
    return switch (x.kind) {
      case "CREATE_TABLE" -> actual.exists && sameColumns(source, actual);
      case "ADD_COLUMN", "MODIFY_COLUMN" -> matchesColumn(x, actual, source);
      case "DROP_COLUMN" -> actual.columns.stream().noneMatch(c -> c.name().equals(x.label));
      case "ADD_INDEX", "REPLACE_INDEX" ->
          actual.indexes.stream()
              .anyMatch(
                  i ->
                      i.name().equals(x.label)
                          && source.indexes.stream()
                              .anyMatch(
                                  s ->
                                      s.name().equals(i.name())
                                          && s.definition().equals(i.definition())));
      case "DROP_INDEX" -> actual.indexes.stream().noneMatch(i -> i.name().equals(x.label));
      case "ADD_FK", "REPLACE_FK" ->
          actual.foreignKeys.stream()
              .anyMatch(
                  i ->
                      i.name().equals(x.label)
                          && source.foreignKeys.stream()
                              .anyMatch(
                                  s ->
                                      s.name().equals(i.name())
                                          && (source.databaseType.equals("postgresql")
                                                  ? PostgresSql.foreignKey(
                                                      s.name(),
                                                      Json.node(
                                                              source.attributes.get(
                                                                  "foreignKeySpecs"))
                                                          .path(s.name()),
                                                      ref.schema())
                                                  : s.definition())
                                              .equals(i.definition())));
      case "DROP_FK" -> actual.foreignKeys.stream().noneMatch(i -> i.name().equals(x.label));
      case "TABLE_COMMENT" -> Objects.equals(actual.comment, source.comment);
      case "TABLE_COLLATION" ->
          Objects.equals(actual.collation, source.collation)
              && Objects.equals(actual.charset, source.charset);
      case "ADD_ROW", "UPDATE_ROW" ->
          actual.rows.stream()
              .anyMatch(
                  row ->
                      x.after.entrySet().stream()
                          .allMatch(
                              e -> Json.hash(e.getValue()).equals(Json.hash(row.get(e.getKey())))));
      case "DELETE_ROW" ->
          !actual.exists
              || !db.keyExists(
                  connection,
                  ref,
                  x.table,
                  x.before,
                  actual.primaryKey().isEmpty() ? x.matchColumns : actual.primaryKey());
      default -> false;
    };
  }

  static boolean matchesColumn(Change change, Table actual, Table source) throws Exception {
    var expected =
        change.after.containsKey("column")
            ? Json.MAPPER.treeToValue(Json.node(change.after.get("column")), Column.class)
            : source.columns.stream()
                .filter(c -> c.name().equals(change.label))
                .findFirst()
                .orElse(null);
    var column =
        actual.columns.stream().filter(c -> c.name().equals(change.label)).findFirst().orElse(null);
    if (expected == null
        || column == null
        || !Sql.columnSignature(expected).equals(Sql.columnSignature(column))) return false;
    if (change.after.containsKey("previous")) {
      int index = actual.columns.indexOf(column);
      return index > 0 && actual.columns.get(index - 1).name().equals(change.after.get("previous"));
    }
    return !Boolean.TRUE.equals(change.after.get("first")) || actual.columns.indexOf(column) == 0;
  }
}
