package io.dbaligner;

import static io.dbaligner.Model.*;

import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** One active comparison, registered before dispatch so immediate cancellation is reliable. */
final class Comparisons implements AutoCloseable {
  @FunctionalInterface
  interface Work {
    SyncPlan run() throws Exception;
  }

  private final ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor();
  private final ScheduledExecutorService cleanup = Executors.newSingleThreadScheduledExecutor();
  private final Map<String, Task> tasks = new ConcurrentHashMap<>();
  private final Consumer<Object> emit;
  private final Consumer<SyncPlan> save;
  private Task active;

  Comparisons(Consumer<Object> emit, Consumer<SyncPlan> save) {
    this.emit = emit;
    this.save = save;
    cleanup.scheduleWithFixedDelay(
        () -> tasks.values().removeIf(t -> t.expired()), 1, 1, TimeUnit.MINUTES);
  }

  final class Task {
    final String id;

    Task(String id) {
      this.id = id;
    }

    final ComparisonContext context =
        new ComparisonContext(workers, progress -> event(this, progress));
    String status = "RUNNING", error = "";
    SyncPlan plan;
    long finished;

    synchronized boolean expired() {
      return finished != 0 && System.currentTimeMillis() - finished > 600_000;
    }

    synchronized Map<String, Object> snapshot() {
      var value = new LinkedHashMap<String, Object>();
      value.put("compareId", id);
      value.put("status", status);
      value.put("progress", context.progress());
      value.put("error", error);
      if (plan != null) value.put("plan", plan);
      return value;
    }
  }

  private void event(Task task, Map<String, Object> progress) {
    // Avoid taking the task lock inside context callbacks (cancellation takes it first).
    emit.accept(Map.of("event", "compare-progress", "compareId", task.id, "progress", progress));
  }

  synchronized Map<String, Object> start(Work work) {
    return start("COMPARE-" + UUID.randomUUID(), work);
  }

  synchronized Map<String, Object> start(String id, Work work) {
    if (active != null) throw new IllegalArgumentException("已有比较任务，请等待完成或停止后重试");
    if (tasks.containsKey(id)) throw new IllegalArgumentException("比较任务标识重复");
    Task task = new Task(id);
    active = task;
    tasks.put(task.id, task);
    workers.submit(() -> run(task, work));
    return Map.of("compareId", task.id);
  }

  private void run(Task task, Work work) {
    ComparisonContext.CURRENT.set(task.context);
    SyncPlan plan = null;
    Exception failure = null;
    try {
      ComparisonContext.check();
      plan = work.run();
      ComparisonContext.check();
    } catch (Exception e) {
      failure = e;
    } finally {
      ComparisonContext.CURRENT.remove();
    }
    synchronized (this) {
      synchronized (task) {
        if (task.status.equals("CANCELLING") || failure instanceof CancellationException)
          task.status = "CANCELLED";
        else if (failure != null) {
          task.status = "FAILED";
          task.error = Planner.safeMessage(failure);
        } else {
          task.status = "COMPLETED";
          task.plan = plan;
          save.accept(plan);
        }
        task.finished = System.currentTimeMillis();
      }
      active = null;
    }
    var event = new LinkedHashMap<>(task.snapshot());
    event.remove("plan");
    event.put("event", "compare-progress");
    emit.accept(event);
  }

  Map<String, Object> get(String id) {
    return task(id).snapshot();
  }

  synchronized Map<String, Object> cancel(String id) {
    Task task = task(id);
    synchronized (task) {
      if (task.status.equals("RUNNING")) {
        task.status = "CANCELLING";
        task.context.cancel();
      }
      var event = new LinkedHashMap<>(task.snapshot());
      event.remove("plan");
      event.put("event", "compare-progress");
      emit.accept(event);
      return Map.of("compareId", id, "status", task.status);
    }
  }

  private Task task(String id) {
    Task task = tasks.get(id);
    if (task == null) throw new IllegalArgumentException("比较任务不存在或已过期");
    return task;
  }

  public void close() {
    synchronized (this) {
      if (active != null) cancel(active.id);
    }
    cleanup.shutdownNow();
    workers.close();
  }
}
