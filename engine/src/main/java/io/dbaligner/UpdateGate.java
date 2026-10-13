package io.dbaligner;

import java.util.Map;
import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.BooleanSupplier;

/** Serializes update preparation with request admission, without cancelling any work. */
final class UpdateGate {
  private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock();
  private boolean prepared;

  interface Request {
    Object run() throws Exception;
  }

  Object request(Request request) throws Exception {
    lock.readLock().lock();
    try {
      if (prepared) throw new IllegalArgumentException("客户端正在准备更新，暂不接受业务请求");
      return request.run();
    } finally {
      lock.readLock().unlock();
    }
  }

  Object prepare(BooleanSupplier busy) {
    if (!lock.writeLock().tryLock()) throw new IllegalArgumentException("仍有请求正在处理，请结束后重试更新");
    try {
      if (busy.getAsBoolean()) throw new IllegalArgumentException("仍有比较、同步或排队任务，请结束后重试更新");
      prepared = true;
      return Map.of("prepared", true);
    } finally {
      lock.writeLock().unlock();
    }
  }

  Object resume() {
    lock.writeLock().lock();
    try {
      prepared = false;
      return Map.of("prepared", false);
    } finally {
      lock.writeLock().unlock();
    }
  }
}
