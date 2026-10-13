package io.dbaligner;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class UpdateGateTest {
  @TempDir Path root;

  @Test
  void inFlightRequestRefusesPreparationWithoutCancellingWork() throws Exception {
    var gate = new UpdateGate();
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
      var request =
          executor.submit(
              () ->
                  gate.request(
                      () -> {
                        entered.countDown();
                        assertTrue(release.await(5, TimeUnit.SECONDS));
                        return "completed";
                      }));
      assertTrue(entered.await(5, TimeUnit.SECONDS));
      try {
        assertThrows(IllegalArgumentException.class, () -> gate.prepare(() -> false));
      } finally {
        release.countDown();
      }
      assertEquals("completed", request.get(5, TimeUnit.SECONDS));
      assertEquals(Map.of("prepared", true), gate.prepare(() -> false));
      assertThrows(IllegalArgumentException.class, () -> gate.request(() -> "new request"));
      gate.resume();
      assertEquals("new request", gate.request(() -> "new request"));
    }
  }

  @Test
  void asyncRegisteredWorkIncludingQueuedAndCancellingTasksRefusesPreparation() throws Exception {
    var gate = new UpdateGate();
    assertThrows(IllegalArgumentException.class, () -> gate.prepare(() -> true));
    assertEquals("still usable", gate.request(() -> "still usable"));
    gate.prepare(() -> false);
    assertThrows(IllegalArgumentException.class, () -> gate.request(() -> null));
  }

  @Test
  void serviceRoutesEnforcePreparationAndResumeAndUseBuildVersion() throws Exception {
    try (var service = new Service(root, event -> {})) {
      var params = Json.node(Map.of());
      assertEquals(
          BuildVersion.get(), Json.node(service.handle("ping", params)).path("version").asText());
      assertEquals(Map.of("prepared", true), service.handle("engine.prepareUpdate", params));
      assertThrows(IllegalArgumentException.class, () -> service.handle("state.load", params));
      assertThrows(IllegalArgumentException.class, () -> service.handle("entity.save", params));
      service.handle("engine.resumeUpdate", params);
      assertNotNull(service.handle("state.load", params));
    }
  }
}
