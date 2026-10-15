package io.dbaligner;

import static io.dbaligner.Model.*;

import java.sql.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** PostgreSQL 的锁、变更和状态采样在同一个目标事务内完成。 */
public final class PostgresExecution {
  @FunctionalInterface
  interface Recorder {
    void save(String type, Map<String, Object> details) throws Exception;
  }

  @FunctionalInterface
  interface RecoveryCheck {
    void check(Connection c, Change change, TargetResult proof, String digest) throws Exception;
  }

  private final Database db;
  private final Archives archives;

  PostgresExecution(Database db, Archives archives) {
    this.db = db;
    this.archives = archives;
  }

  private void lock(Connection c, DbRef ref, List<String> tables, Collection<String> dependencies)
      throws Exception {
    c.setAutoCommit(false);
    var names = new TreeSet<String>(tables);
    names.addAll(dependencies);
    for (String name : names)
      if (db.snapshot(c, ref, name, false).exists)
        db.execute(c, "LOCK TABLE " + Sql.qualified(ref, name) + " IN ACCESS EXCLUSIVE MODE");
  }

  private Set<String> dependencies(SyncPlan plan, TargetPlan target, List<String> tables) {
    var names = new HashSet<String>();
    for (String name : tables)
      for (var table : List.of(plan.sourceSnapshot.get(name), target.before.get(name)))
        for (var fk : table.foreignKeys) names.add(fk.referencedTable());
    return names;
  }

  void run(
      SyncRecord record,
      TargetPlan target,
      TargetResult result,
      AtomicBoolean token,
      Recorder recorder)
      throws Exception {
    var selected = archives.chosen(record, target);
    var tables = selected.stream().map(x -> x.table).distinct().toList();
    boolean submitted = false, committed = false;
    try (var c = db.openBound(target.ref, target.connectionIdentity)) {
      db.supportedServer(c);
      lock(c, target.ref, tables, dependencies(record.plan, target, tables));
      try {
        for (String name : tables) {
          boolean data =
              record.plan.tables.stream().anyMatch(t -> t.name().equals(name) && t.data());
          var before = target.before.get(name);
          var now = db.snapshot(c, target.ref, name, data);
          if (!now.supported
              || !Sql.schemaHash(before).equals(Sql.schemaHash(now))
              || data && !Jobs.rowSetHash(before.rows).equals(Jobs.rowSetHash(now.rows)))
            throw new IllegalArgumentException("目标库已变化，请重新比较：" + name);
          if (before.exists
              && !before.primaryKey().isEmpty()
              && selected.stream()
                  .anyMatch(x -> x.table.equals(name) && Archives.needsValueRestore(x))) {
            try {
              Archives.captureRecovery(
                  target, result, name, db.readRows(c, target.ref, name, 20000));
            } catch (Database.RowLimitException over) {
              recorder.save(
                  "recovery-capture-skipped", Map.of("table", name, "message", over.getMessage()));
            }
          }
        }
        archives.prepareLocalRecovery(record, target, result);
        recorder.save("recovery-captured", Map.of("target", target.ref.key()));
        for (var change : selected) {
          if (token.get()) throw new java.util.concurrent.CancellationException("执行已取消");
          var step =
              result.steps.stream()
                  .filter(s -> s.changeId.equals(change.id))
                  .findFirst()
                  .orElseThrow();
          step.status = "IN_FLIGHT";
          step.startedAt = Instant.now().toString();
          recorder.save("step-started", Map.of("target", target.ref.key(), "change", change.id));
          if (change.kind.endsWith("_ROW")) {
            if (db.inboundWrite(c, target.ref, change, false))
              throw new IllegalArgumentException("外键关联发生变化，阻止级联写入");
            if (db.executeData(c, target.ref, change) != 1)
              throw new IllegalArgumentException("记录写入数量不符合预期");
          } else {
            if (Archives.needsValueRestore(change)
                && db.incomingForeignKeys(c, target.ref, change.table, change.label) > 0)
              throw new IllegalArgumentException("字段被其他表引用，阻止变更");
            for (String sql : change.statements.isEmpty() ? List.of(change.sql) : change.statements)
              db.execute(c, sql);
          }
        }
        for (var change : selected)
          if (change.kind.endsWith("_ROW") && !change.kind.equals("DELETE_ROW")) {
            var row = db.rowFor(c, target.ref, change.table, change.after, change.matchColumns);
            if (row == null) throw new IllegalArgumentException("无法读取执行后行");
            result.rowAfter.put(change.id, row);
          }
        for (String name : tables) result.expected.put(name, db.digest(c, target.ref, name));
        if (token.get()) throw new java.util.concurrent.CancellationException("执行已取消");
        submitted = true;
        c.commit();
        committed = true;
        for (var step : result.steps) {
          step.status = "DONE";
          step.finishedAt = Instant.now().toString();
        }
        recorder.save("target-committed", Map.of("target", target.ref.key()));
      } catch (Exception error) {
        boolean unknown = submitted;
        try {
          c.rollback();
        } catch (Exception ignored) {
          unknown = true;
        }
        if (!committed) {
          result.expected.clear();
          result.rowAfter.clear();
        }
        for (var step : result.steps)
          if (step.status.equals("IN_FLIGHT") || committed) {
            step.status =
                unknown
                    ? "UNKNOWN"
                    : error instanceof java.util.concurrent.CancellationException
                        ? "CANCELLED"
                        : "FAILED";
            step.error = Planner.safeMessage(error);
          }
        recorder.save(
            "target-transaction-failed", Map.of("target", target.ref.key(), "unknown", unknown));
        throw error;
      }
    }
  }

  void rollback(
      SyncRecord original,
      SyncRecord record,
      TargetPlan target,
      TargetResult result,
      TargetResult proof,
      List<RollbackItem> items,
      Recorder recorder,
      RecoveryCheck checker)
      throws Exception {
    var tables = items.stream().map(i -> i.table).distinct().toList();
    boolean submitted = false;
    try (var c = db.openBound(target.ref, target.connectionIdentity)) {
      db.supportedServer(c);
      lock(c, target.ref, tables, dependencies(original.plan, target, tables));
      try {
        var digests = new HashMap<String, String>();
        for (String name : tables) digests.put(name, db.digest(c, target.ref, name));
        for (var item : items) {
          var change =
              target.changes.stream().filter(x -> x.id.equals(item.id)).findFirst().orElseThrow();
          checker.check(c, change, proof, digests.get(item.table));
        }
        for (var item : items) {
          var change =
              target.changes.stream().filter(x -> x.id.equals(item.id)).findFirst().orElseThrow();
          if (db.inboundWrite(c, target.ref, change, true))
            throw new IllegalArgumentException("外键关联发生变化，阻止级联恢复");
          var step = new Step();
          step.changeId = item.id;
          step.status = "IN_FLIGHT";
          step.startedAt = Instant.now().toString();
          result.steps.add(step);
          recorder.save(
              "rollback-step-started", Map.of("target", target.ref.key(), "change", item.id));
          for (String sql : archives.inverse(original, target, change, proof)) {
            int count = db.execute(c, sql);
            if (change.kind.endsWith("_ROW") && count != 1)
              throw new IllegalArgumentException("恢复写入数量不符合预期");
          }
        }
        for (String name : tables) result.expected.put(name, db.digest(c, target.ref, name));
        submitted = true;
        c.commit();
        for (var step : result.steps) {
          step.status = "DONE";
          step.finishedAt = Instant.now().toString();
        }
        result.status = "SUCCESS";
        recorder.save("rollback-target-committed", Map.of("target", target.ref.key()));
      } catch (Exception error) {
        boolean unknown = submitted;
        try {
          c.rollback();
        } catch (Exception ignored) {
          unknown = true;
        }
        result.expected.clear();
        for (var step : result.steps) {
          step.status = unknown ? "UNKNOWN" : "FAILED";
          step.error = Planner.safeMessage(error);
        }
        recorder.save(
            "rollback-target-failed", Map.of("target", target.ref.key(), "unknown", unknown));
        throw error;
      }
    }
  }
}
