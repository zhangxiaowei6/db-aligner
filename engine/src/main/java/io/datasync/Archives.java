package io.datasync;

import static io.datasync.Model.*;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public final class Archives {
  private final Store store;

  public Archives(Store s) {
    store = s;
  }

  public static String backupName(String recordId, String target, String table) {
    return "__ds_bak_" + Json.hash(List.of(recordId, target, table)).substring(0, 24);
  }

  public static String postName(String recordId, String target, String table) {
    return "__ds_post_" + Json.hash(List.of(recordId, target, table)).substring(0, 24);
  }

  public static String receiptName(String id) {
    return "__ds_receipt_" + Json.hash(id).substring(0, 20);
  }

  public List<Change> chosen(SyncRecord r, TargetPlan tp) {
    return ordered(
        tp.changes.stream().filter(x -> r.selectedIds.contains(x.id) && !x.blocked).toList());
  }

  public static List<Change> ordered(List<Change> input) {
    return input.stream()
        .sorted(
            Comparator.comparingInt(
                x ->
                    switch (x.kind) {
                      case "DROP_FK" -> 0;
                      case "DROP_INDEX" -> 1;
                      case "CREATE_TABLE" -> 2;
                      case "ADD_COLUMN",
                          "MODIFY_COLUMN",
                          "DROP_COLUMN",
                          "TABLE_COMMENT",
                          "TABLE_COLLATION" ->
                          3;
                      case "ADD_INDEX", "REPLACE_INDEX" -> 4;
                      case "DELETE_ROW" -> 5;
                      case "ADD_ROW", "UPDATE_ROW" -> 6;
                      case "ADD_FK", "REPLACE_FK" -> 7;
                      default -> 9;
                    }))
        .toList();
  }

  public List<String> inverse(SyncRecord r, TargetPlan tp, Change x) {
    var result = new ArrayList<>(x.rollbackSql);
    if (x.kind.equals("DROP_COLUMN") || x.kind.equals("MODIFY_COLUMN") && !x.commentOnly()) {
      var old = tp.before.get(x.table);
      String name = x.label;
      var pk = old.primaryKey();
      String b = backupName(r.id, tp.ref.key(), x.table);
      result.add(
          "UPDATE "
              + Sql.qualified(tp.ref, x.table)
              + " AS t JOIN "
              + Sql.qualified(tp.ref, b)
              + " AS b ON "
              + pk.stream()
                  .map(k -> "t." + Sql.id(k) + " <=> b." + Sql.id(k))
                  .collect(java.util.stream.Collectors.joining(" AND "))
              + " SET t."
              + Sql.id(name)
              + "=b."
              + Sql.id(name));
    }
    return result;
  }

  public Path prepare(SyncRecord r) throws Exception {
    Path base = Path.of(store.get("settings", "global").path("archivePath").asText());
    Files.createDirectories(base);
    Path folder = base.resolve(r.id);
    Files.createDirectory(folder);
    r.archivePath = folder.toString();
    write(folder.resolve("plan.json"), Json.write(r.plan));
    write(folder.resolve("selection.json"), Json.write(r.selectedIds));
    for (var tp : r.plan.targets) {
      Path td =
          folder.resolve(
              Json.hash(tp.ref.key()).substring(0, 12) + "-" + sanitize(tp.ref.database()));
      Files.createDirectory(td);
      var selected = chosen(r, tp);
      var tables = selected.stream().map(x -> x.table).distinct().toList();
      if (selected.isEmpty()) {
        write(td.resolve("target.json"), Json.write(tp.ref));
        write(
            td.resolve("00_full_diff.sql"),
            "-- 此目标库未选择任何变更，不执行任何操作。\n"
                + tp.changes.stream()
                    .map(x -> "-- " + x.kind + " / " + x.label.replace('\n', ' '))
                    .collect(java.util.stream.Collectors.joining("\n")));
        continue;
      }
      var backup = new StringBuilder(Sql.header());
      var apply = new StringBuilder(Sql.header());
      var verify = new StringBuilder(Sql.header());
      var rollback = new StringBuilder(Sql.header());
      var full = new StringBuilder(Sql.header());
      String receipt = Sql.qualified(tp.ref, receiptName(r.id));
      backup
          .append("-- 先完成备份；任一步报错后停止，不要继续执行后续脚本。\nCREATE TABLE ")
          .append(receipt)
          .append(
              " (stage varchar(20) PRIMARY KEY, record_id varchar(100) NOT NULL, plan_hash"
                  + " varchar(64) NOT NULL);\n");
      for (String name : tables) {
        var old = tp.before.get(name);
        if (old.exists) {
          String b = Sql.qualified(tp.ref, backupName(r.id, tp.ref.key(), name));
          backup
              .append("CREATE TABLE ")
              .append(b)
              .append(" LIKE ")
              .append(Sql.qualified(tp.ref, name))
              .append(";\nINSERT INTO ")
              .append(b)
              .append(" SELECT * FROM ")
              .append(Sql.qualified(tp.ref, name))
              .append(";\n");
        }
      }
      backup
          .append("INSERT INTO ")
          .append(receipt)
          .append(" VALUES ('prepared',")
          .append(Sql.quote(r.id))
          .append(',')
          .append(Sql.quote(Json.hash(r.plan)))
          .append(");\n");
      for (var x : selected)
        apply
            .append("-- ")
            .append(Sql.comment(x.table))
            .append(" / ")
            .append(x.kind)
            .append(" / ")
            .append(x.id)
            .append('\n')
            .append(x.sql)
            .append(";\n");
      for (String name : tables) {
        String post = Sql.qualified(tp.ref, postName(r.id, tp.ref.key(), name));
        verify
            .append("CREATE TABLE ")
            .append(post)
            .append(" LIKE ")
            .append(Sql.qualified(tp.ref, name))
            .append(";\nINSERT INTO ")
            .append(post)
            .append(" SELECT * FROM ")
            .append(Sql.qualified(tp.ref, name))
            .append(";\n");
      }
      verify
          .append("INSERT INTO ")
          .append(receipt)
          .append(" VALUES ('applied',")
          .append(Sql.quote(r.id))
          .append(',')
          .append(Sql.quote(Json.hash(r.plan)))
          .append(");\nSELECT * FROM ")
          .append(receipt)
          .append(";\n");
      var reversed = new ArrayList<>(selected);
      Collections.reverse(reversed);
      rollback.append("-- 请先在 Data Sync 核验备份和后续变更；发生冲突时不要执行。\n");
      for (var x : reversed)
        for (String sql : inverse(r, tp, x)) rollback.append(sql).append(";\n");
      for (var x : tp.changes)
        full.append(
            x.blocked ? "-- BLOCKED: " + x.reason.replace('\n', ' ') + "\n" : x.sql + ";\n");
      write(td.resolve("00_full_diff.sql"), full.toString());
      write(td.resolve("01_prepare_backup.sql"), backup.toString());
      write(td.resolve("02_sync.sql"), apply.toString());
      write(td.resolve("03_verify.sql"), verify.toString());
      write(td.resolve("04_rollback.sql"), rollback.toString());
      write(td.resolve("target.json"), Json.write(tp.ref));
    }
    write(
        folder.resolve("README.txt"),
        "Data Sync 脚本包\n记录："
            + r.id
            + "\n模式："
            + r.mode
            + "\n"
            + "每个目标库单独执行。00_full_diff.sql 仅用于查看完整差异，切勿直接执行。\n"
            + "外部执行顺序：01_prepare_backup.sql → 02_sync.sql →"
            + " 03_verify.sql。必须配置数据库工具遇到错误停止。任何步骤失败都应停止后续步骤。\n"
            + "02 中含 DDL 时不具备整个文件的事务原子性。请在维护窗口执行，避免同时写入相关表。\n"
            + "备份与执行后快照会占用目标库空间，需要建表权限。保留 __ds_ 前缀资料直到不再需要回滚。\n"
            + "执行后回到客户端登记执行范围并校验。04_rollback.sql 仅在恢复资料完整、且后续变更校验通过时使用。\n"
            + "导出文件不会自动执行，原始记录与执行结果分别归档。\n");
    return folder;
  }

  public void finalizeRecord(SyncRecord r) throws Exception {
    Path f = Path.of(r.archivePath);
    Path record = f.resolve("record.json");
    if (!Files.exists(record)) write(record, Json.write(r));
    Path logs = f.resolve("execution-events.json");
    if (!Files.exists(logs)) write(logs, Json.write(store.events(r.id)));
  }

  private void write(Path path, String text) throws IOException {
    Files.writeString(
        path, text, java.nio.charset.StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
  }

  private String sanitize(String s) {
    return s.replaceAll("[^a-zA-Z0-9_\\-\\u4e00-\\u9fff]", "_")
        .substring(0, Math.min(40, s.length()));
  }

  public void zip(List<String> recordIds, Path destination) throws Exception {
    try (var z =
        new ZipOutputStream(Files.newOutputStream(destination, StandardOpenOption.CREATE_NEW))) {
      z.putNextEntry(new ZipEntry("archive-manifest.json"));
      var links = store.versionLinks();
      var versionIds =
          recordIds.stream().map(links::get).filter(Objects::nonNull).distinct().toList();
      z.write(
          Json.write(
                  Map.of(
                      "format",
                      "datasync-script-package-v1",
                      "recordIds",
                      recordIds,
                      "versions",
                      store.list("version").stream()
                          .filter(v -> versionIds.contains(v.path("id").asText()))
                          .toList(),
                      "versionLinks",
                      recordIds.stream()
                          .filter(links::containsKey)
                          .collect(java.util.stream.Collectors.toMap(id -> id, links::get))))
              .getBytes(java.nio.charset.StandardCharsets.UTF_8));
      z.closeEntry();
      for (String id : recordIds) {
        var n = store.get("record", id);
        if (n == null) throw new IllegalArgumentException("记录不存在");
        Path root = Path.of(n.path("archivePath").asText()).toRealPath();
        try (var files = Files.walk(root)) {
          for (Path f : files.filter(Files::isRegularFile).toList()) {
            if (Files.isSymbolicLink(f) || !f.toRealPath().startsWith(root))
              throw new IllegalArgumentException("档案路径不安全");
            z.putNextEntry(
                new ZipEntry(id + "/" + root.relativize(f).toString().replace('\\', '/')));
            Files.copy(f, z);
            z.closeEntry();
          }
        }
        z.putNextEntry(new ZipEntry(id + "/additional-events.json"));
        z.write(Json.write(store.events(id)).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        z.closeEntry();
      }
    }
  }
}
