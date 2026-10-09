package io.datasync;

import static io.datasync.Model.*;

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
    if (ids.isEmpty() || !r.selectedIds.containsAll(ids))
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
    boolean all = declaration != null && declaration.path("backupCompleted").asBoolean();
    var results = new ArrayList<TargetResult>();
    var checks = new ArrayList<Map<String, Object>>();
    for (var tp : r.plan.targets) {
      var chosen = archives.chosen(r, tp).stream().filter(c -> confirmed.contains(c.id)).toList();
      if (chosen.isEmpty()) continue;
      var tr = new TargetResult();
      tr.ref = tp.ref;
      results.add(tr);
      try (var c = db.openBound(tp.ref, tp.connectionIdentity)) {
        String receipt = Sql.qualified(tp.ref, Archives.receiptName(r.id));
        boolean receiptValid = false;
        try (var s = c.createStatement();
            var rs = s.executeQuery("SELECT stage,record_id,plan_hash FROM " + receipt)) {
          var stages = new HashSet<String>();
          while (rs.next())
            if (rs.getString(2).equals(id) && rs.getString(3).equals(Json.hash(r.plan)))
              stages.add(rs.getString(1));
          receiptValid = stages.containsAll(List.of("prepared", "applied"));
        } catch (java.sql.SQLException ignored) {
        }
        for (String name : chosen.stream().map(x -> x.table).distinct().toList()) {
          var actual = db.snapshot(c, tp.ref, name, true);
          var original = tp.before.get(name);
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
          String b = Archives.backupName(id, tp.ref.key(), name),
              post = Archives.postName(id, tp.ref.key(), name);
          var postTable = db.snapshot(c, tp.ref, post, false);
          boolean valid =
              receiptValid
                  && postTable.exists
                  && sameColumns(actual, postTable)
                  && db.rowsDigest(c, tp.ref, name).equals(db.rowsDigest(c, tp.ref, post));
          String reason = valid ? "" : "执行凭据或执行后快照缺失／不一致";
          if (original.exists) {
            var backup =
                db.snapshot(
                    c,
                    tp.ref,
                    b,
                    r.plan.tables.stream().anyMatch(t -> t.name().equals(name) && t.data()));
            valid = valid && backup.exists && sameColumns(original, backup);
            if (!valid && reason.isBlank()) reason = "备份结构与原始定义不符";
            if (backup.exists
                && r.plan.tables.stream().anyMatch(t -> t.name().equals(name) && t.data())
                && !Jobs.rowSetHash(original.rows).equals(Jobs.rowSetHash(backup.rows))) {
              valid = false;
              reason = "备份原值与生成脚本时不符";
            }
            if (valid) {
              tr.backups.put(name, b);
              tr.backupDigests.put(name, db.digest(c, tp.ref, b));
            }
          }
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
          all = all && valid;
          checks.add(
              Map.of(
                  "target",
                  tp.ref.key(),
                  "table",
                  name,
                  "valid",
                  valid,
                  "message",
                  valid ? "目标状态与恢复资料校验通过" : reason));
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
                    trusted && (!tp.before.get(table).exists || backupValid)
                        ? "可信执行后状态与恢复资料一致"
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
      case "ADD_COLUMN", "MODIFY_COLUMN" ->
          actual.columns.stream()
              .anyMatch(
                  c ->
                      c.name().equals(x.label)
                          && source.columns.stream()
                              .anyMatch(
                                  s ->
                                      s.name().equals(c.name())
                                          && Sql.columnSignature(s)
                                              .equals(Sql.columnSignature(c))));
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
                                          && s.definition().equals(i.definition())));
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
}
