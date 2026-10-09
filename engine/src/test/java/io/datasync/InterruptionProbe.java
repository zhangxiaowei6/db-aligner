package io.datasync;

import static io.datasync.Model.*;
import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/** Kills only the owned child engine, after a real batch commit, then restarts it. */
final class InterruptionProbe implements AutoCloseable {
  private final Process process;
  private final BufferedReader output;
  private final BufferedWriter input;
  private final ExecutorService reads = Executors.newVirtualThreadPerTaskExecutor();

  InterruptionProbe(Path root) throws Exception {
    Files.createDirectories(root);
    var builder =
        new ProcessBuilder(
                Path.of(System.getProperty("java.home"), "bin", "java.exe").toString(),
                "-Dfile.encoding=UTF-8",
                "-cp",
                System.getProperty("java.class.path"),
                "io.datasync.EngineMain")
            .redirectError(root.resolve("engine-stderr.log").toFile());
    builder.environment().put("DATA_SYNC_HOME", root.toString());
    process = builder.start();
    output = process.inputReader(java.nio.charset.StandardCharsets.UTF_8);
    input = process.outputWriter(java.nio.charset.StandardCharsets.UTF_8);
    until(n -> n.path("event").asText().equals("ready"));
  }

  void send(String id, String method, Object params) throws Exception {
    input.write(Json.write(Map.of("id", id, "method", method, "params", params)));
    input.newLine();
    input.flush();
  }

  JsonNode until(java.util.function.Predicate<JsonNode> condition) throws Exception {
    return reads
        .submit(
            () -> {
              String line;
              while ((line = output.readLine()) != null) {
                var n = Json.read(line, JsonNode.class);
                if (condition.test(n)) return n;
              }
              throw new IOException("Child engine exited before expected response");
            })
        .get(40, TimeUnit.SECONDS);
  }

  JsonNode response(String id) throws Exception {
    var n = until(v -> v.path("id").asText().equals(id));
    assertFalse(n.has("error"), n.toString());
    return n.path("result");
  }

  void kill() throws Exception {
    process.destroyForcibly();
    assertTrue(process.waitFor(10, TimeUnit.SECONDS));
  }

  public void close() throws Exception {
    try {
      if (process.isAlive()) {
        input.close();
        if (!process.waitFor(10, TimeUnit.SECONDS)) process.destroyForcibly();
      }
    } finally {
      reads.shutdownNow();
      output.close();
    }
  }

  static void verify(
      Database db,
      java.sql.Connection admin,
      JsonNode config,
      JsonNode credentials,
      DbRef source,
      DbRef target,
      Path root)
      throws Exception {
    String table = "中断核验";
    db.execute(
        admin,
        "CREATE TABLE "
            + Sql.qualified(source, table)
            + " (id int PRIMARY KEY,v varchar(20)) ENGINE=InnoDB");
    db.execute(
        admin,
        "CREATE TABLE " + Sql.qualified(target, table) + " LIKE " + Sql.qualified(source, table));
    var values = new ArrayList<String>();
    for (int i = 1; i <= 500; i++) values.add("(" + i + ",'值')");
    db.execute(
        admin,
        "INSERT INTO " + Sql.qualified(source, table) + " VALUES " + String.join(",", values));
    try (var store = new Store(root)) {
      store.put("connection", "server", config);
      var settings =
          (com.fasterxml.jackson.databind.node.ObjectNode) store.get("settings", "global");
      settings.put("batchSize", 1);
      store.put("settings", "global", settings);
    }
    var secrets = Map.of("server", credentials.path("password").asText());
    String recordId;
    try (var child = new InterruptionProbe(root)) {
      child.send(
          "compare",
          "sync.compare",
          Map.of(
              "workspaceId",
              "default",
              "source",
              source,
              "targets",
              List.of(target),
              "tables",
              List.of(new TableChoice(table, false, true, List.of())),
              "$secrets",
              secrets));
      var plan = child.response("compare");
      var ids = new ArrayList<String>();
      for (var change : plan.path("targets").get(0).path("changes"))
        if (!change.path("blocked").asBoolean()) ids.add(change.path("id").asText());
      assertEquals(500, ids.size());
      child.send(
          "execute",
          "sync.save",
          Map.of(
              "planId",
              plan.path("id").asText(),
              "selectedIds",
              ids,
              "mode",
              "EXECUTE_AND_SAVE",
              "remark",
              "Interruption integration test",
              "$secrets",
              secrets));
      var committed =
          child.until(n -> n.path("details").path("type").asText().equals("batch-committed"));
      recordId = committed.path("recordId").asText();
      child.kill();
    }
    try (var restarted = new InterruptionProbe(root)) {
      restarted.send("get", "record.get", Map.of("id", recordId));
      var record = restarted.response("get").path("record");
      assertEquals("INTERRUPTED", record.path("status").asText());
      restarted.send("audit", "record.verify", Map.of("id", recordId, "$secrets", secrets));
      var audit = restarted.response("audit");
      assertFalse(audit.path("checks").isEmpty());
      assertTrue(audit.path("notice").asText().contains("不能"));
      restarted.send("again", "record.get", Map.of("id", recordId));
      assertEquals(
          "INTERRUPTED", restarted.response("again").path("record").path("status").asText());
      restarted.send("rollback", "rollback.preview", Map.of("id", recordId, "$secrets", secrets));
      var rollback = restarted.response("rollback");
      assertFalse(rollback.path("items").isEmpty());
      for (var item : rollback.path("items"))
        assertFalse(
            item.path("eligible").asBoolean(), "No trusted post-state after process interruption");
    }
  }
}
