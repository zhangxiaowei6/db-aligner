package io.dbaligner;

import static io.dbaligner.Model.*;

import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

public final class Jobs implements AutoCloseable {
  private final Store store;
  private final Database db;
  private final Archives archives;
  private final Consumer<Object> emitter;
  private final ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();
  private final ConcurrentMap<String, AtomicBoolean> active = new ConcurrentHashMap<>();
  private final ConcurrentMap<String, Semaphore> hosts = new ConcurrentHashMap<>();
  private volatile Semaphore slots = new Semaphore(4, true);

  public Jobs(Store s, Database d, Archives a, Consumer<Object> emitter) {
    store = s;
    db = d;
    archives = a;
    this.emitter = emitter;
  }

  public boolean busy() {
    return !active.isEmpty();
  }

  public synchronized SyncRecord save(
      SyncPlan plan, List<String> selected, String mode, String remark) throws Exception {
    if (!List.of("SAVE_ONLY", "EXECUTE_AND_SAVE").contains(mode))
      throw new IllegalArgumentException("无效执行方式");
    var all = plan.targets.stream().flatMap(t -> t.changes.stream()).toList();
    validateSelection(plan, selected);
    if (selected.isEmpty()
        || selected.size() != new HashSet<>(selected).size()
        || selected.stream()
            .anyMatch(id -> all.stream().noneMatch(c -> c.id.equals(id) && !c.blocked)))
      throw new IllegalArgumentException("请选择有效的同步变更");
    var r = new SyncRecord();
    r.recoveryFormat = "LOCAL_V1";
    r.id =
        "SYNC-"
            + LocalDate.now().toString().replace("-", "")
            + "-"
            + UUID.randomUUID().toString().substring(0, 8);
    r.workspaceId = plan.workspaceId;
    r.createdAt = Instant.now().toString();
    r.mode = mode;
    r.remark = remark;
    r.plan = plan;
    r.selectedIds = selected;
    for (var t : plan.targets) {
      var tr = new TargetResult();
      tr.ref = t.ref;
      for (var c : archives.chosen(r, t)) {
        var st = new Step();
        st.changeId = c.id;
        tr.steps.add(st);
      }
      if (tr.steps.isEmpty()) tr.status = "SKIPPED";
      if (mode.equals("SAVE_ONLY"))
        for (var choice : plan.tables)
          if (choice.data()
              && t.before.containsKey(choice.name())
              && archives.chosen(r, t).stream()
                  .anyMatch(x -> x.table.equals(choice.name()) && Archives.needsValueRestore(x)))
            Archives.captureRecovery(t, tr, choice.name(), t.before.get(choice.name()).rows);
      r.results.add(tr);
    }
    archives.prepare(r);
    store.put("record", r.id, r);
    store.event(r.id, Map.of("type", "created", "mode", mode));
    if (mode.equals("SAVE_ONLY")) {
      archives.finalizeRecord(r);
      return r;
    }
    r.status = "QUEUED";
    store.put("record", r.id, r);
    var token = new AtomicBoolean();
    active.put(r.id, token);
    configure();
    pool.submit(() -> run(r, token));
    return r;
  }

  private void configure() throws Exception {
    if (active.size() == 1) {
      var settings = store.get("settings", "global");
      slots = new Semaphore(Math.max(1, Math.min(16, settings.path("concurrency").asInt(4))), true);
      hosts.clear();
    }
  }

  private void run(SyncRecord r, AtomicBoolean token) {
    try {
      synchronized (r) {
        r.status = "RUNNING";
        persist(r, "started", Map.of());
      }
      var futures = new ArrayList<Future<?>>();
      for (int i = 0; i < r.plan.targets.size(); i++) {
        final int n = i;
        futures.add(
            pool.submit(() -> runTarget(r, r.plan.targets.get(n), r.results.get(n), token)));
      }
      for (var f : futures) f.get();
      synchronized (r) {
        long done =
            r.results.stream()
                .flatMap(t -> t.steps.stream())
                .filter(s -> s.status.equals("DONE"))
                .count();
        long total = r.selectedIds.size();
        r.status =
            done == total ? "SUCCESS" : done > 0 ? "PARTIAL" : token.get() ? "CANCELLED" : "FAILED";
        persist(r, "finished", Map.of("status", r.status));
        archives.finalizeRecord(r);
      }
    } catch (Exception e) {
      synchronized (r) {
        r.status = "INTERRUPTED";
        try {
          persist(r, "interrupted", Map.of("message", Planner.safeMessage(e)));
          archives.finalizeRecord(r);
        } catch (Exception ignored) {
        }
      }
    } finally {
      active.remove(r.id);
    }
  }

  private void runTarget(SyncRecord r, TargetPlan tp, TargetResult result, AtomicBoolean token) {
    if (result.steps.isEmpty()) return;
    boolean global = false, host = false;
    Semaphore hostGate = null;
    var selected = archives.chosen(r, tp);
    try {
      while (!token.get() && !(global = slots.tryAcquire(300, TimeUnit.MILLISECONDS))) {}
      if (!global) return;
      String hostKey =
          String.valueOf(tp.connectionIdentity.get("host")).toLowerCase()
              + ":"
              + tp.connectionIdentity.get("port");
      int perHost = store.get("settings", "global").path("perHost").asInt(1);
      hostGate =
          hosts.computeIfAbsent(
              hostKey, k -> new Semaphore(Math.max(1, Math.min(8, perHost)), true));
      while (!token.get() && !(host = hostGate.tryAcquire(300, TimeUnit.MILLISECONDS))) {}
      if (!host || token.get()) return;
      synchronized (r) {
        result.status = "RUNNING";
        persist(r, "target-started", Map.of("target", tp.ref.key()));
      }
      if (tp.ref.schema() != null) {
        new PostgresExecution(db, archives)
            .run(
                r,
                tp,
                result,
                token,
                (type, details) -> {
                  synchronized (r) {
                    persist(r, type, details);
                  }
                });
        synchronized (r) {
          result.status = "SUCCESS";
          persist(r, "target-finished", Map.of("target", tp.ref.key()));
        }
        return;
      }
      try (var c = db.openBound(tp.ref, tp.connectionIdentity)) {
        db.supportedServer(c);
        var tables = selected.stream().map(x -> x.table).distinct().toList();
        for (String name : tables) {
          var old = tp.before.get(name);
          var current = db.snapshot(c, tp.ref, name, choice(r, name).data());
          if (!Sql.schemaHash(old).equals(Sql.schemaHash(current))
              || choice(r, name).data() && !rowSetHash(old.rows).equals(rowSetHash(current.rows)))
            throw new IllegalArgumentException("目标库已变化，请重新比较：" + name);
        }
        // CREATE uses no IF NOT EXISTS; an intervening creation therefore fails safely.
        for (var x : selected.stream().filter(x -> x.kind.equals("CREATE_TABLE")).toList()) {
          if (token.get()) break;
          executeStep(r, tp, result, c, x);
        }
        if (token.get()) return;
        // 目标库零污染：不再创建备份表；执行前只做状态复核并在锁内采集字段原值恢复资料。
        var locks = new LinkedHashSet<String>();
        for (String name : tables) {
          locks.add(Sql.qualified(tp.ref, name) + " WRITE");
          for (var f : r.plan.sourceSnapshot.get(name).foreignKeys)
            if (!tables.contains(f.referencedTable()))
              locks.add(Sql.qualified(tp.ref, f.referencedTable()) + " READ");
          for (var f : tp.before.get(name).foreignKeys)
            if (!tables.contains(f.referencedTable()))
              locks.add(Sql.qualified(tp.ref, f.referencedTable()) + " READ");
        }
        c.setAutoCommit(false);
        db.execute(c, "LOCK TABLES " + String.join(",", locks));
        try {
          for (String name : tables) {
            var old = tp.before.get(name);
            var now = db.snapshot(c, tp.ref, name, choice(r, name).data());
            if (old.exists) {
              if (!Sql.schemaHash(old).equals(Sql.schemaHash(now))
                  || choice(r, name).data() && !rowSetHash(old.rows).equals(rowSetHash(now.rows)))
                throw new IllegalArgumentException("目标库在执行前发生变化：" + name);
            } else if (!db.rowsDigest(c, tp.ref, name).startsWith("0:"))
              throw new IllegalArgumentException("新建表已被外部写入，停止执行：" + name);
          }
          for (String name : tables) {
            if (!tp.before.get(name).exists) continue;
            boolean needsRestore =
                selected.stream()
                    .anyMatch(x -> x.table.equals(name) && Archives.needsValueRestore(x));
            if (!needsRestore) continue;
            if (tp.before.get(name).primaryKey().isEmpty()) continue;
            try {
              var rows = db.readRows(c, tp.ref, name, 20000);
              synchronized (r) {
                Archives.captureRecovery(tp, result, name, rows);
              }
            } catch (Database.RowLimitException over) {
              synchronized (r) {
                persist(
                    r,
                    "recovery-capture-skipped",
                    Map.of(
                        "target",
                        tp.ref.key(),
                        "table",
                        name,
                        "message",
                        Planner.safeMessage(over)));
              }
            }
          }
          // 本地档案与 SQLite 都必须完成持久化，才允许后续有损字段变更。
          synchronized (r) {
            archives.prepareLocalRecovery(r, tp, result);
            persist(r, "recovery-captured", Map.of("target", tp.ref.key()));
          }
          c.commit();
          synchronized (r) {
            persist(r, "pre-execute-verified", Map.of("target", tp.ref.key()));
          }
          int batchSize = store.get("settings", "global").path("batchSize").asInt(500);
          var batch = new ArrayList<Change>();
          for (var x : selected) {
            if (x.kind.equals("CREATE_TABLE")) continue;
            if (token.get()) break;
            if (x.kind.endsWith("_ROW")) {
              batch.add(x);
              if (batch.size() >= batchSize) {
                executeBatch(r, tp, result, c, batch);
                batch.clear();
              }
              continue;
            }
            if (!batch.isEmpty()) {
              executeBatch(r, tp, result, c, batch);
              batch.clear();
            }
            if ((x.kind.equals("DROP_COLUMN") || x.kind.equals("MODIFY_COLUMN") && !x.commentOnly())
                && db.incomingForeignKeys(c, tp.ref, x.table, x.label) > 0)
              throw new IllegalArgumentException("字段被其他表引用，阻止变更：" + x.label);
            executeStep(r, tp, result, c, x);
          }
          if (!batch.isEmpty() && !token.get()) executeBatch(r, tp, result, c, batch);
        } finally {
          c.rollback();
          for (String name : tables) {
            if (result.steps.stream()
                .anyMatch(
                    st ->
                        st.status.equals("DONE")
                            && selected.stream()
                                .anyMatch(x -> x.id.equals(st.changeId) && x.table.equals(name)))) {
              try {
                String hash = db.digest(c, tp.ref, name);
                synchronized (r) {
                  result.expected.put(name, hash);
                  persist(r, "post-state", Map.of("target", tp.ref.key(), "table", name));
                }
              } catch (Exception ex) {
                synchronized (r) {
                  persist(
                      r, "post-state-unavailable", Map.of("target", tp.ref.key(), "table", name));
                }
              }
            }
          }
          db.execute(c, "UNLOCK TABLES");
        }
        synchronized (r) {
          result.status = token.get() ? "CANCELLED" : "SUCCESS";
          persist(r, "target-finished", Map.of("target", tp.ref.key(), "status", result.status));
        }
      }
    } catch (Exception e) {
      synchronized (r) {
        result.status = "FAILED";
        result.error = Planner.safeMessage(e);
        try {
          persist(r, "target-failed", Map.of("target", tp.ref.key(), "message", result.error));
        } catch (Exception ignored) {
        }
      }
    } finally {
      if (host && hostGate != null) hostGate.release();
      if (global) slots.release();
      if (token.get())
        synchronized (r) {
          if (result.status.equals("PENDING")) result.status = "CANCELLED";
        }
    }
  }

  private TableChoice choice(SyncRecord r, String table) {
    return r.plan.tables.stream().filter(x -> x.name().equals(table)).findFirst().orElseThrow();
  }

  static String rowSetHash(List<Map<String, Object>> rows) {
    return Json.hash(rows.stream().map(Json::hash).sorted().toList());
  }

  private void executeStep(
      SyncRecord r, TargetPlan tp, TargetResult result, Connection c, Change change)
      throws Exception {
    var step =
        result.steps.stream().filter(x -> x.changeId.equals(change.id)).findFirst().orElseThrow();
    synchronized (r) {
      step.status = "IN_FLIGHT";
      step.startedAt = Instant.now().toString();
      persist(r, "step-started", Map.of("target", tp.ref.key(), "change", change.id));
    }
    try {
      int rows =
          change.kind.endsWith("_ROW")
              ? db.executeData(c, tp.ref, change)
              : db.execute(c, change.sql);
      if (change.kind.endsWith("_ROW") && rows != 1)
        throw new IllegalArgumentException("记录写入数量不符合预期，停止后续变更");
      synchronized (r) {
        step.status = "DONE";
        step.finishedAt = Instant.now().toString();
        persist(r, "step-done", Map.of("target", tp.ref.key(), "change", change.id));
      }
    } catch (SQLException e) {
      synchronized (r) {
        step.status =
            e.getSQLState() != null && e.getSQLState().startsWith("08") ? "UNKNOWN" : "FAILED";
        step.error = Planner.safeMessage(e);
        persist(
            r,
            "step-failed",
            Map.of("target", tp.ref.key(), "change", change.id, "message", step.error));
      }
      throw e;
    }
  }

  private void persist(SyncRecord r, String type, Map<String, Object> details) throws Exception {
    store.put("record", r.id, r);
    var e = new LinkedHashMap<String, Object>(details);
    e.put("type", type);
    store.event(r.id, e);
    emitter.accept(Map.of("event", "job", "recordId", r.id, "status", r.status, "details", e));
  }

  public void cancel(String id) {
    var t = active.get(id);
    if (t == null) throw new IllegalArgumentException("该任务已结束");
    t.set(true);
  }

  private void validateSelection(SyncPlan plan, List<String> ids) {
    for (var tp : plan.targets) {
      var selected = tp.changes.stream().filter(x -> ids.contains(x.id)).toList();
      for (var x : selected) {
        if (x.kind.endsWith("_ROW")
            && !tp.before.get(x.table).exists
            && selected.stream()
                .noneMatch(i -> i.table.equals(x.table) && i.kind.equals("CREATE_TABLE")))
          throw new IllegalArgumentException("新增表的数据必须同时选择创建表操作");
        if ((x.kind.equals("ADD_COLUMN") || x.kind.equals("MODIFY_COLUMN"))
            && x.after.containsKey("previous")) {
          String prev = String.valueOf(x.after.get("previous"));
          if (tp.before.get(x.table).columns.stream().noneMatch(c -> c.name().equals(prev))
              && selected.stream()
                  .noneMatch(
                      i ->
                          i.table.equals(x.table)
                              && i.kind.equals("ADD_COLUMN")
                              && i.label.equals(prev)))
            throw new IllegalArgumentException("字段顺序依赖未选择的新增字段：" + prev);
        }
        if ((List.of("ADD_INDEX", "REPLACE_INDEX", "ADD_FK", "REPLACE_FK").contains(x.kind))
            && tp.changes.stream()
                .anyMatch(
                    i ->
                        i.table.equals(x.table)
                            && i.kind.equals("ADD_COLUMN")
                            && !ids.contains(i.id)
                            && x.sql.contains(Sql.id(tp.ref, i.label))))
          throw new IllegalArgumentException("索引或外键依赖未选择的新增字段");
      }
    }
  }

  private void executeBatch(
      SyncRecord r, TargetPlan tp, TargetResult result, Connection c, List<Change> changes)
      throws Exception {
    var steps =
        result.steps.stream()
            .filter(st -> changes.stream().anyMatch(x -> x.id.equals(st.changeId)))
            .toList();
    synchronized (r) {
      for (var st : steps) {
        st.status = "IN_FLIGHT";
        st.startedAt = Instant.now().toString();
      }
      persist(r, "batch-started", Map.of("target", tp.ref.key(), "count", changes.size()));
    }
    boolean committed = false;
    try {
      for (var change : changes) {
        if (db.inboundWrite(c, tp.ref, change, false))
          throw new IllegalArgumentException("外键关联发生变化，阻止可能的级联写入");
        if (db.executeData(c, tp.ref, change) != 1)
          throw new IllegalArgumentException("记录写入数量不符合预期");
      }
      c.commit();
      committed = true;
      for (var change : changes)
        if (!change.kind.equals("DELETE_ROW")) {
          var row = db.rowFor(c, tp.ref, change.table, change.after, change.matchColumns);
          if (row == null) throw new IllegalArgumentException("无法读取可信执行后记录");
          result.rowAfter.put(change.id, row);
        }
      synchronized (r) {
        for (var st : steps) {
          st.status = "DONE";
          st.finishedAt = Instant.now().toString();
        }
        persist(r, "batch-committed", Map.of("target", tp.ref.key(), "count", changes.size()));
      }
    } catch (Exception e) {
      boolean unknown =
          committed
              || e instanceof SQLException se
                  && se.getSQLState() != null
                  && se.getSQLState().startsWith("08");
      try {
        c.rollback();
      } catch (Exception ignored) {
        unknown = true;
      }
      synchronized (r) {
        for (var st : steps) {
          st.status = unknown ? "UNKNOWN" : "FAILED";
          st.error = Planner.safeMessage(e);
        }
        persist(r, "batch-failed", Map.of("target", tp.ref.key(), "unknown", unknown));
      }
      throw e;
    }
  }

  private Set<String> rolledIds(String id) throws Exception {
    var ids = new HashSet<String>();
    for (var n : store.list("record"))
      if (n.path("parentId").asText().equals(id))
        for (var t : n.path("results"))
          for (var st : t.path("steps"))
            if (st.path("status").asText().equals("DONE")) ids.add(st.path("changeId").asText());
    return ids;
  }

  private List<TargetResult> evidence(SyncRecord r) throws Exception {
    List<TargetResult> results = r.results;
    if (r.mode.equals("SAVE_ONLY")) {
      var ex = store.get("external", r.id);
      if (ex == null || !ex.path("verified").asBoolean())
        throw new IllegalArgumentException("请先登记外部执行并核验恢复资料");
      results = Arrays.asList(Json.MAPPER.treeToValue(ex.path("results"), TargetResult[].class));
    }
    var descendants =
        new ArrayList<>(
            store.list("record").stream()
                .filter(n -> n.path("parentId").asText().equals(r.id))
                .toList());
    Collections.reverse(descendants);
    for (var n : descendants)
      for (var t : n.path("results")) {
        var ref = Json.MAPPER.treeToValue(t.path("ref"), DbRef.class);
        for (var proof : results)
          if (proof.ref.equals(ref)) {
            t.path("expected")
                .fields()
                .forEachRemaining(e -> proof.expected.put(e.getKey(), e.getValue().asText()));
            for (var st : t.path("steps"))
              if (List.of("UNKNOWN", "IN_FLIGHT").contains(st.path("status").asText()))
                r.plan.targets.stream()
                    .flatMap(tp -> tp.changes.stream())
                    .filter(x -> x.id.equals(st.path("changeId").asText()))
                    .forEach(x -> proof.expected.remove(x.table));
          }
      }
    return results;
  }

  public RollbackPlan preview(String id) throws Exception {
    var r = Json.MAPPER.treeToValue(store.get("record", id), SyncRecord.class);
    if (List.of("QUEUED", "RUNNING").contains(r.status))
      throw new IllegalArgumentException("执行中不能回滚");
    if (store.events(id).stream()
        .anyMatch(e -> e.path("event").path("type").asText().equals("archive-cleared")))
      throw new IllegalArgumentException("该记录的恢复资料已清理，不能回滚");
    if (r.mode.equals("ROLLBACK"))
      throw new IllegalArgumentException("恢复记录保留审计证据，不支持再次反向执行；请重新比较生成同步任务");
    var p = new RollbackPlan();
    p.id = UUID.randomUUID().toString();
    p.recordId = id;
    var results = evidence(r);
    var rolled = rolledIds(id);
    for (var result : results) {
      var tp =
          r.plan.targets.stream().filter(t -> t.ref.equals(result.ref)).findFirst().orElseThrow();
      var done =
          result.steps.stream()
              .filter(s -> s.status.equals("DONE") && !rolled.contains(s.changeId))
              .map(s -> s.changeId)
              .toList();
      var selected = new ArrayList<>(archives.chosen(r, tp));
      Collections.reverse(selected);
      Map<String, String> reasons = new HashMap<>(),
          actualDigests = new HashMap<>(),
          rowReasons = new HashMap<>();
      try (var c = db.openBound(tp.ref, tp.connectionIdentity)) {
        for (String name :
            selected.stream()
                .filter(x -> done.contains(x.id))
                .map(x -> x.table)
                .distinct()
                .toList()) {
          String expected = result.expected.get(name);
          String reason = "";
          if (expected == null) reason = "缺少可信执行后状态，需人工核验";
          else {
            String actual = db.digest(c, tp.ref, name);
            actualDigests.put(name, actual);
            if (!expected.equals(actual)) reason = "存在后续结构或数据修改";
          }
          if (result.backups.containsKey(name)
              && !db.snapshot(c, tp.ref, result.backups.get(name), false).exists)
            reason = "恢复备份不存在";
          else if (result.backups.containsKey(name)
              && (!result.backupDigests.containsKey(name)
                  || !result
                      .backupDigests
                      .get(name)
                      .equals(db.digest(c, tp.ref, result.backups.get(name)))))
            reason = "恢复备份已修改或缺少备份指纹";
          else if (reason.isBlank()
              && selected.stream()
                  .filter(x -> done.contains(x.id) && x.table.equals(name))
                  .anyMatch(Archives::needsValueRestore)
              && !Archives.valueRestoreAvailable(r, tp, result, name))
            reason = "缺少字段原值恢复资料（该表未纳入数据比较、超过 20,000 行或无主键），需人工恢复";
          reasons.put(name, reason);
        }
        for (var x : selected)
          if (done.contains(x.id)
              && x.kind.endsWith("_ROW")
              && (reasons.getOrDefault(x.table, "缺少资料").isBlank()
                  || reasons.get(x.table).equals("存在后续结构或数据修改")))
            rowReasons.put(
                x.id, dataRecoveryReason(c, tp.ref, result, x, actualDigests.get(x.table)));
      } catch (Exception e) {
        selected.forEach(x -> reasons.put(x.table, Planner.safeMessage(e)));
      }
      for (var x : selected)
        if (done.contains(x.id)) {
          var item = new RollbackItem();
          item.id = x.id;
          item.targetKey = tp.ref.key();
          item.table = x.table;
          item.label = x.label;
          item.sql = archives.inverse(r, tp, x, result);
          item.reason = reasons.getOrDefault(x.table, "无法校验");
          if (rowReasons.containsKey(x.id)) item.reason = rowReasons.get(x.id);
          item.eligible = item.reason.isBlank();
          item.selected = item.eligible;
          p.items.add(item);
        }
    }
    return p;
  }

  private String dataRecoveryReason(
      Connection c, DbRef ref, TargetResult proof, Change change, String cachedDigest)
      throws Exception {
    String expected = proof.expected.get(change.table);
    if (expected == null) return "缺少可信执行后状态";
    String actual = cachedDigest == null ? db.digest(c, ref, change.table) : cachedDigest;
    if (!expected.split(":", 2)[0].equals(actual.split(":", 2)[0])) return "表结构存在后续修改";
    if (db.inboundWrite(c, ref, change, true)) return "存在外键关联，恢复可能级联修改其他表";
    if (change.kind.equals("DELETE_ROW")) {
      if (db.keyExists(c, ref, change.table, change.before, change.matchColumns))
        return "待恢复的记录键已被后续写入占用";
      return "";
    }
    var row = proof.rowAfter.get(change.id);
    if (row == null) return expected.equals(actual) ? "" : "缺少该记录的可信执行后原值";
    var now = db.rowFor(c, ref, change.table, row, change.matchColumns);
    return now != null && Json.hash(now).equals(Json.hash(row)) ? "" : "该记录存在后续修改";
  }

  public synchronized SyncRecord rollback(String recordId, List<String> ids, String remark)
      throws Exception {
    if (ids.isEmpty() || new HashSet<>(ids).size() != ids.size())
      throw new IllegalArgumentException("请选择恢复项");
    var preview = preview(recordId);
    for (String id : ids)
      if (preview.items.stream().noneMatch(i -> i.id.equals(id) && i.eligible))
        throw new IllegalArgumentException("存在无法回滚的项，请重新校验");
    var original = Json.MAPPER.treeToValue(store.get("record", recordId), SyncRecord.class);
    for (var tp : original.plan.targets)
      for (var x : tp.changes)
        if (ids.contains(x.id) && !x.kind.endsWith("_ROW")) {
          var remaining =
              preview.items.stream()
                  .filter(
                      i ->
                          i.targetKey.equals(tp.ref.key()) && i.table.equals(x.table) && i.eligible)
                  .map(i -> i.id)
                  .toList();
          if (!ids.containsAll(remaining))
            throw new IllegalArgumentException("结构恢复需同时选择该表的所有可恢复项，以保留字段、索引及数据依赖");
        }
    var r = new SyncRecord();
    r.id =
        "ROLL-"
            + LocalDate.now().toString().replace("-", "")
            + "-"
            + UUID.randomUUID().toString().substring(0, 8);
    r.workspaceId = original.workspaceId;
    r.parentId = original.id;
    r.createdAt = Instant.now().toString();
    r.mode = "ROLLBACK";
    r.remark = remark;
    r.plan = original.plan;
    r.selectedIds = ids;
    r.status = "RUNNING";
    java.nio.file.Path f =
        java.nio.file.Path.of(store.get("settings", "global").path("archivePath").asText())
            .resolve(r.id);
    java.nio.file.Files.createDirectory(f);
    r.archivePath = f.toString();
    java.nio.file.Files.writeString(f.resolve("rollback-plan.json"), Json.write(preview));
    store.put("record", r.id, r);
    for (var tp : original.plan.targets) {
      var items =
          preview.items.stream()
              .filter(i -> ids.contains(i.id) && i.targetKey.equals(tp.ref.key()))
              .toList();
      if (items.isEmpty()) continue;
      var tr = new TargetResult();
      tr.ref = tp.ref;
      r.results.add(tr);
      if (tp.ref.schema() != null) {
        var proof =
            evidence(original).stream().filter(t -> t.ref.equals(tp.ref)).findFirst().orElseThrow();
        try {
          new PostgresExecution(db, archives)
              .rollback(
                  original,
                  r,
                  tp,
                  tr,
                  proof,
                  items,
                  (type, details) -> persist(r, type, details),
                  (connection, change, evidence, digest) -> {
                    if (Archives.needsValueRestore(change)
                        && !Archives.valueRestoreAvailable(original, tp, evidence, change.table))
                      throw new IllegalArgumentException("恢复资料缺失或摘要不符");
                    if (change.kind.endsWith("_ROW")) {
                      String reason =
                          dataRecoveryReason(connection, tp.ref, evidence, change, digest);
                      if (!reason.isBlank()) throw new IllegalArgumentException(reason);
                    } else if (!Objects.equals(evidence.expected.get(change.table), digest))
                      throw new IllegalArgumentException("回滚前状态发生变化");
                  });
        } catch (Exception error) {
          tr.status = "FAILED";
          tr.error = Planner.safeMessage(error);
        }
        persist(r, "rollback-target-finished", Map.of("target", tp.ref.key(), "status", tr.status));
        continue;
      }
      try (var c = db.openBound(tp.ref, tp.connectionIdentity)) {
        var tables = items.stream().map(i -> i.table).distinct().toList();
        var locks = new ArrayList<String>();
        for (String table : tables) {
          locks.add(Sql.qualified(tp.ref, table) + " WRITE");
          locks.add(Sql.qualified(tp.ref, table) + " AS t WRITE");
          var targetProof =
              evidence(original).stream()
                  .filter(t -> t.ref.equals(tp.ref))
                  .findFirst()
                  .orElseThrow();
          String b = targetProof.backups.get(table);
          if (b != null) {
            locks.add(Sql.qualified(tp.ref, b) + " READ");
            locks.add(Sql.qualified(tp.ref, b) + " AS b READ");
          }
        }
        for (String table : tables)
          for (var fk : tp.before.get(table).foreignKeys)
            if (!tables.contains(fk.referencedTable()))
              locks.add(Sql.qualified(tp.ref, fk.referencedTable()) + " READ");
        var proof =
            evidence(original).stream().filter(t -> t.ref.equals(tp.ref)).findFirst().orElseThrow();
        db.execute(c, "LOCK TABLES " + String.join(",", locks));
        try {
          var lockedDigests = new HashMap<String, String>();
          for (String table : tables) lockedDigests.put(table, db.digest(c, tp.ref, table));
          for (String table : tables)
            if (proof.backups.containsKey(table)
                && !Objects.equals(
                    proof.backupDigests.get(table), db.digest(c, tp.ref, proof.backups.get(table))))
              throw new IllegalArgumentException("恢复备份发生变化");
          for (var item : items) {
            var change =
                tp.changes.stream().filter(x -> x.id.equals(item.id)).findFirst().orElseThrow();
            if (Archives.needsValueRestore(change)
                && !Archives.valueRestoreAvailable(original, tp, proof, item.table))
              throw new IllegalArgumentException("字段原值恢复资料缺失或摘要不符，需人工恢复");
            if (change.kind.endsWith("_ROW")) {
              String reason =
                  dataRecoveryReason(c, tp.ref, proof, change, lockedDigests.get(item.table));
              if (!reason.isBlank()) throw new IllegalArgumentException(reason);
            } else if (!Objects.equals(
                proof.expected.get(item.table), lockedDigests.get(item.table)))
              throw new IllegalArgumentException("回滚前状态发生变化");
          }
          for (var item : items) {
            var originalChange =
                tp.changes.stream().filter(x -> x.id.equals(item.id)).findFirst().orElseThrow();
            if (db.inboundWrite(c, tp.ref, originalChange, true))
              throw new IllegalArgumentException("外键关联发生变化，阻止级联恢复");
            var st = new Step();
            st.changeId = item.id;
            st.status = "IN_FLIGHT";
            tr.steps.add(st);
            persist(r, "rollback-step-started", Map.of("target", tp.ref.key(), "change", item.id));
            for (String sql : archives.inverse(original, tp, originalChange, proof)) {
              int count = db.execute(c, sql);
              if (originalChange.kind.endsWith("_ROW") && count != 1)
                throw new IllegalArgumentException("恢复写入数量不符合预期");
            }
            st.status = "DONE";
            persist(r, "rollback-step-done", Map.of("target", tp.ref.key(), "change", item.id));
          }
        } finally {
          for (String table : tables)
            try {
              tr.expected.put(table, db.digest(c, tp.ref, table));
            } catch (Exception ignored) {
            }
          db.execute(c, "UNLOCK TABLES");
        }
        tr.status = "SUCCESS";
      } catch (Exception e) {
        tr.status = "FAILED";
        tr.error = Planner.safeMessage(e);
      }
      persist(r, "rollback-target-finished", Map.of("target", tp.ref.key(), "status", tr.status));
    }
    r.status =
        r.results.stream().allMatch(t -> t.status.equals("SUCCESS"))
            ? "SUCCESS"
            : r.results.stream().anyMatch(t -> t.status.equals("SUCCESS")) ? "PARTIAL" : "FAILED";
    persist(r, "rollback-finished", Map.of("status", r.status));
    archives.finalizeRecord(r);
    store.event(original.id, Map.of("type", "rollback", "recordId", r.id, "status", r.status));
    return r;
  }

  public void close() {
    active.values().forEach(t -> t.set(true));
    pool.shutdown();
  }
}
