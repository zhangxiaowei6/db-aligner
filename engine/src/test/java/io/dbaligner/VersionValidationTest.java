package io.dbaligner;

import static org.junit.jupiter.api.Assertions.*;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class VersionValidationTest {
  @TempDir Path root;

  @Test
  void versionNumbersAreTrimmedUniqueWithinWorkspaceAndCanEditTheSameObject() throws Exception {
    try (var service = new Service(root, ignored -> {})) {
      service.store.put("workspace", "a", Map.of("id", "a", "name", "工作区一"));
      service.store.put("workspace", "b", Map.of("id", "b", "name", "工作区二"));
      var request =
          Json.MAPPER.valueToTree(
              Map.of("workspaceId", "a", "number", " v1.0 ", "recordIds", List.of()));
      var saved = Json.MAPPER.valueToTree(service.handle("version.save", request));
      assertEquals("v1.0", saved.path("number").asText());
      var failure =
          assertThrows(
              IllegalArgumentException.class, () -> service.handle("version.save", request));
      assertEquals("工作区内版本号已存在", failure.getMessage());
      var edit = saved.deepCopy();
      ((com.fasterxml.jackson.databind.node.ObjectNode) edit).put("description", "修改说明");
      var edited = Json.MAPPER.valueToTree(service.handle("version.save", edit));
      assertEquals(saved.path("createdAt"), edited.path("createdAt"));
      service.handle(
          "version.save",
          Json.MAPPER.valueToTree(
              Map.of("workspaceId", "b", "number", "v1.0", "recordIds", List.of())));
      assertEquals(2, service.store.list("version").size());
    }
  }

  @Test
  void concurrentCreationOfTheSameNumberOnlySucceedsOnce() throws Exception {
    try (var service = new Service(root, ignored -> {});
        var pool = Executors.newFixedThreadPool(2)) {
      service.store.put("workspace", "a", Map.of("id", "a", "name", "工作区"));
      var start = new CountDownLatch(1);
      java.util.concurrent.Callable<Boolean> create =
          () -> {
            start.await();
            try {
              service.handle(
                  "version.save",
                  Json.MAPPER.valueToTree(
                      Map.of("workspaceId", "a", "number", "v1.0", "recordIds", List.of())));
              return true;
            } catch (IllegalArgumentException error) {
              assertEquals("工作区内版本号已存在", error.getMessage());
              return false;
            }
          };
      var first = pool.submit(create);
      var second = pool.submit(create);
      start.countDown();
      assertNotEquals(first.get(), second.get());
      assertEquals(1, service.store.list("version").size());
    }
  }
}
