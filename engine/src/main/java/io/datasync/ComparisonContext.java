package io.datasync;

import static io.datasync.Model.*;

import java.lang.reflect.*;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** Request-scoped read cancellation. Never wraps connections used by execution jobs. */
final class ComparisonContext {
  static final ThreadLocal<ComparisonContext> CURRENT = new ThreadLocal<>();
  private final Set<Connection> connections = ConcurrentHashMap.newKeySet();
  private final Set<Statement> statements = ConcurrentHashMap.newKeySet();
  private final Executor executor;
  private final Consumer<Map<String, Object>> emit;
  private volatile boolean cancelled;
  private DbRef ref;
  private String table = "", phase = "准备比较";
  private int completed, total, rows;
  private long lastEmission;
  private volatile Map<String, Object> lastProgress;

  ComparisonContext(Executor executor, Consumer<Map<String, Object>> emit) {
    this.executor = executor;
    this.emit = emit;
    lastProgress = buildProgress();
  }

  static void check() {
    var current = CURRENT.get();
    if (current != null && current.cancelled) throw new CancellationException("比较已停止");
  }

  Map<String, Object> progress() {
    return lastProgress;
  }

  private Map<String, Object> buildProgress() {
    var value = new LinkedHashMap<String, Object>();
    value.put("ref", ref);
    value.put("table", table);
    value.put("phase", phase);
    value.put("completed", completed);
    value.put("total", total);
    value.put("rows", rows);
    return value;
  }

  synchronized void stage(DbRef ref, String table, String phase) {
    check();
    this.ref = ref;
    this.table = table;
    this.phase = phase;
    rows = 0;
    publish(true);
  }

  synchronized void total(int total) {
    this.total = total;
    publish(true);
  }

  synchronized void done() {
    check();
    completed++;
    publish(true);
  }

  static void rows(int rows) {
    check();
    var current = CURRENT.get();
    if (current != null)
      synchronized (current) {
        current.rows = rows;
        current.publish(false);
      }
  }

  private void publish(boolean force) {
    long now = System.nanoTime();
    if (force || now - lastEmission >= 200_000_000L) {
      lastEmission = now;
      lastProgress = buildProgress();
      emit.accept(lastProgress);
    }
  }

  void cancel() {
    cancelled = true;
    for (Statement statement : statements)
      executor.execute(
          () -> {
            try {
              statement.cancel();
            } catch (Exception ignored) {
            }
          });
    for (Connection connection : connections) abort(connection);
  }

  private void abort(Connection connection) {
    executor.execute(
        () -> {
          try {
            connection.abort(executor);
          } catch (Exception ignored) {
            try {
              connection.close();
            } catch (Exception ignoredClose) {
            }
          }
        });
  }

  Connection wrap(Connection connection) {
    connections.add(connection);
    if (cancelled) {
      abort(connection);
      check();
    }
    return (Connection) proxy(connection, Connection.class);
  }

  private Object proxy(Object delegate, Class<?> type) {
    return Proxy.newProxyInstance(
        type.getClassLoader(),
        new Class<?>[] {type},
        (proxy, method, args) -> {
          String name = method.getName();
          boolean cleanup =
              name.equals("close") || name.equals("isClosed") || name.equals("rollback");
          if (!cleanup) check();
          try {
            Object result = method.invoke(delegate, args);
            if (result instanceof PreparedStatement statement) {
              statement.setQueryTimeout(60);
              statements.add(statement);
              result = proxy(statement, PreparedStatement.class);
            } else if (result instanceof Statement statement) {
              statement.setQueryTimeout(60);
              statements.add(statement);
              result = proxy(statement, Statement.class);
            } else if (result instanceof ResultSet rs) result = proxy(rs, ResultSet.class);
            if (!cleanup) check();
            return result;
          } catch (InvocationTargetException e) {
            if (!cleanup) check();
            throw e.getCause();
          } finally {
            if (name.equals("close")) {
              if (delegate instanceof Connection c) connections.remove(c);
              if (delegate instanceof Statement s) statements.remove(s);
            }
          }
        });
  }
}
