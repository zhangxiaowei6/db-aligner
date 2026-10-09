package io.datasync;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.springframework.boot.*;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class EngineMain {
  private static final Object OUTPUT_LOCK = new Object();

  static void emit(Object value) {
    synchronized (OUTPUT_LOCK) {
      byte[] bytes =
          (Json.write(Json.presentation(value)) + "\n")
              .getBytes(java.nio.charset.StandardCharsets.UTF_8);
      System.out.write(bytes, 0, bytes.length);
      System.out.flush();
    }
  }

  public static void main(String[] args) throws Exception {
    var boot = new SpringApplication(EngineMain.class);
    boot.setWebApplicationType(WebApplicationType.NONE);
    var context = boot.run();
    String root = System.getenv("DATA_SYNC_HOME");
    if (root == null || root.isBlank())
      throw new IllegalArgumentException("DATA_SYNC_HOME is required");
    try (var service = new Service(Path.of(root), EngineMain::emit);
        var worker = Executors.newVirtualThreadPerTaskExecutor();
        var in =
            new BufferedReader(
                new InputStreamReader(System.in, java.nio.charset.StandardCharsets.UTF_8))) {
      emit(Map.of("event", "ready", "protocol", 1));
      String line;
      while ((line = in.readLine()) != null) {
        if (line.length() > 12_000_000) {
          emit(Map.of("id", "", "error", Map.of("code", "INVALID_REQUEST", "message", "请求过大")));
          continue;
        }
        String request = line;
        worker.submit(
            () -> {
              String id = "";
              try {
                var n = Json.read(request, com.fasterxml.jackson.databind.JsonNode.class);
                id = n.path("id").asText();
                if (id.isBlank()) throw new IllegalArgumentException("缺少请求标识");
                var result = service.handle(n.path("method").asText(), n.path("params"));
                emit(Map.of("id", id, "result", result));
              } catch (Exception e) {
                emit(
                    Map.of(
                        "id",
                        id,
                        "error",
                        Map.of(
                            "code",
                            e instanceof IllegalArgumentException ? "VALIDATION" : "ENGINE_ERROR",
                            "message",
                            Planner.safeMessage(e))));
              }
            });
      }
    } finally {
      context.close();
    }
  }
}
