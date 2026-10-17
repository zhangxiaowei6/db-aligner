package io.dbaligner;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.util.*;

/** Local metadata and deliberate deletion; never opens a target database. */
final class RecordManagement {
  private final Store store;

  RecordManagement(Store store) throws Exception {
    this.store = store;
    for (var journal : store.list("recordDeletion")) {
      try {
        finish(journal);
      } catch (Exception e) {
        failed(journal, e);
      }
    }
  }

  List<Map<String, String>> pending() throws Exception {
    return store.list("recordDeletion").stream()
        .map(
            j ->
                Map.of("id", j.path("id").asText(), "message", j.path("error").asText("本地档案清理待完成")))
        .toList();
  }

  Object remark(String id, String remark) throws Exception {
    return store.transaction(
        () -> {
          var record = require("record", id);
          idle(record);
          String before = record.path("remark").asText();
          var value = (ObjectNode) record.deepCopy();
          if (value.has("planId")) value.remove("plan");
          value.put("remark", remark);
          store.put("record", id, value);
          store.event(id, Map.of("type", "remark-updated", "before", before, "remark", remark));
          return Map.of("ok", true);
        });
  }

  Object deleteVersion(String id, String confirmation) throws Exception {
    return store.transaction(
        () -> {
          var version = require("version", id);
          if (!version.path("number").asText().equals(confirmation))
            throw new IllegalArgumentException("请输入完整版本号确认删除");
          store.unlinkVersion(id);
          store.delete("version", id);
          return Map.of("ok", true);
        });
  }

  Object deleteRecord(String id, String confirmation) throws Exception {
    if (!id.equals(confirmation) || !id.matches("(?:SYNC|ROLL)-[a-zA-Z0-9-]+"))
      throw new IllegalArgumentException("请输入完整记录编号确认删除");
    var pending = store.get("recordDeletion", id);
    if (pending != null) {
      try {
        finish(pending);
      } catch (Exception e) {
        failed(pending, e);
      }
      if (store.get("recordDeletion", id) != null) return result(id);
      if (store.get("record", id) == null) return Map.of("ok", true, "cleanupPending", false);
    }
    var record = require("record", id);
    idle(record);
    if (!record.path("parentId").asText().isBlank()
        || store.list("record").stream().anyMatch(r -> r.path("parentId").asText().equals(id)))
      throw new IllegalArgumentException("记录有关联恢复证据，不能删除原记录或恢复记录");
    Path original = Path.of(record.path("archivePath").asText()).toAbsolutePath().normalize();
    if (!original.getFileName().toString().equals(id))
      throw new IllegalArgumentException("档案目录不属于该记录");
    checkAncestors(original.getParent());
    for (var other : store.list("record")) {
      if (other.path("id").asText().equals(id) || other.path("archivePath").asText().isBlank())
        continue;
      Path path = Path.of(other.path("archivePath").asText()).toAbsolutePath().normalize();
      if (Files.exists(path) && Files.exists(original)) {
        var otherReal = path.toRealPath();
        var originalReal = original.toRealPath();
        if (otherReal.startsWith(originalReal) || originalReal.startsWith(otherReal))
          throw new IllegalArgumentException("档案目录被其他记录共享，不能删除");
      }
      if (path.startsWith(original) || original.startsWith(path))
        throw new IllegalArgumentException("档案目录被其他记录共享，不能删除");
    }
    if (Files.exists(original, LinkOption.NOFOLLOW_LINKS)) checkedEntries(original);
    String token = UUID.randomUUID().toString();
    Path staged = original.resolveSibling(".dbaligner-delete-" + id + "-" + token);
    var journal =
        Json.node(
            Map.of(
                "id",
                id,
                "original",
                original.toString(),
                "staged",
                staged.toString(),
                "token",
                token));
    store.put("recordDeletion", id, journal);
    try {
      if (Files.exists(original, LinkOption.NOFOLLOW_LINKS))
        Files.move(original, staged, StandardCopyOption.ATOMIC_MOVE);
      store.transaction(
          () -> {
            var current = require("record", id);
            idle(current);
            if (!current.path("archivePath").asText().equals(record.path("archivePath").asText()))
              throw new IllegalArgumentException("记录档案位置已变化，请重试");
            store.deleteRecordData(id, current.path("planId").asText());
            return null;
          });
    } catch (Exception e) {
      try {
        finish(journal);
      } catch (Exception restore) {
        failed(journal, restore);
        e.addSuppressed(restore);
      }
      throw e;
    }
    try {
      finish(journal);
    } catch (Exception e) {
      failed(journal, e);
    }
    return result(id);
  }

  private Object result(String id) throws Exception {
    var journal = store.get("recordDeletion", id);
    return Map.of(
        "ok",
        true,
        "cleanupPending",
        journal != null,
        "message",
        journal == null ? "记录及本地资料已删除" : journal.path("error").asText("档案清理待重试"));
  }

  private void failed(JsonNode journal, Exception error) throws Exception {
    var copy = (ObjectNode) journal.deepCopy();
    copy.put("error", Planner.safeMessage(error));
    store.put("recordDeletion", journal.path("id").asText(), copy);
  }

  private void finish(JsonNode journal) throws Exception {
    String id = journal.path("id").asText();
    if (!id.matches("(?:SYNC|ROLL)-[a-zA-Z0-9-]+")) throw new IllegalArgumentException("删除日志标识无效");
    UUID.fromString(journal.path("token").asText());
    Path original = Path.of(journal.path("original").asText()).toAbsolutePath().normalize();
    Path staged = Path.of(journal.path("staged").asText()).toAbsolutePath().normalize();
    if (!original.getFileName().toString().equals(id)
        || !staged.equals(
            original.resolveSibling(
                ".dbaligner-delete-" + id + "-" + journal.path("token").asText())))
      throw new IllegalArgumentException("删除日志路径无效");
    checkAncestors(original.getParent());
    var record = store.get("record", id);
    if (record != null) {
      if (!Path.of(record.path("archivePath").asText())
          .toAbsolutePath()
          .normalize()
          .equals(original)) throw new IllegalArgumentException("记录档案位置与删除日志不符");
      if (Files.exists(staged, LinkOption.NOFOLLOW_LINKS)) {
        checkedEntries(staged);
        if (Files.exists(original, LinkOption.NOFOLLOW_LINKS))
          throw new IllegalArgumentException("档案恢复位置已被占用");
        Files.move(staged, original, StandardCopyOption.ATOMIC_MOVE);
      }
    } else if (Files.exists(staged, LinkOption.NOFOLLOW_LINKS)) {
      for (Path entry : checkedEntries(staged)) Files.delete(entry);
    }
    store.delete("recordDeletion", id);
  }

  static void checkAncestors(Path path) throws Exception {
    for (Path p = path; p != null; p = p.getParent()) {
      if (Files.exists(p, LinkOption.NOFOLLOW_LINKS)
          && (Files.isSymbolicLink(p)
              || !p.toRealPath().equals(p.toRealPath(LinkOption.NOFOLLOW_LINKS))))
        throw new IllegalArgumentException("档案路径包含符号链接或重解析目录");
    }
  }

  private List<Path> checkedEntries(Path root) throws Exception {
    checkAncestors(root);
    Path real = root.toRealPath();
    try (var walk = Files.walk(root)) {
      var entries = walk.sorted(Comparator.reverseOrder()).toList();
      for (Path entry : entries) {
        var attributes =
            Files.readAttributes(
                entry,
                java.nio.file.attribute.BasicFileAttributes.class,
                LinkOption.NOFOLLOW_LINKS);
        if (attributes.isSymbolicLink()
            || attributes.isOther()
            || !entry.toRealPath().startsWith(real)
            || !entry.toRealPath().equals(entry.toRealPath(LinkOption.NOFOLLOW_LINKS)))
          throw new IllegalArgumentException("档案包含不安全路径");
      }
      return entries;
    }
  }

  private JsonNode require(String kind, String id) throws Exception {
    var value = store.get(kind, id);
    if (value == null)
      throw new IllegalArgumentException(kind.equals("record") ? "记录不存在" : "版本不存在");
    return value;
  }

  private void idle(JsonNode record) {
    if (List.of("QUEUED", "RUNNING").contains(record.path("status").asText()))
      throw new IllegalArgumentException("记录正在排队或执行，请等待任务完成");
  }
}
