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

  /** 结构变化是否需要恢复字段原值（删除字段或改定义可能造成有损转换）。 */
  public static boolean needsValueRestore(Change x) {
    return x.kind.equals("DROP_COLUMN") || x.kind.equals("MODIFY_COLUMN") && !x.commentOnly();
  }

  /** 字段原值恢复资料是否可用于该表：旧记录可用目标库备份表；新记录需要主键与本地行数据（计划快照或执行前采集）。 */
  public static boolean valueRestoreAvailable(
      SyncRecord r, TargetPlan tp, TargetResult proof, String table) {
    if (!r.recoveryFormat.equals("LOCAL_V1") && proof != null && proof.backups.containsKey(table))
      return true;
    var old = tp.before.get(table);
    if (old == null || old.primaryKey().isEmpty()) return false;
    if (proof != null && proof.recoveryRows.containsKey(table)) {
      var rows = proof.recoveryRows.get(table);
      return rows != null
          && rows.size() <= 20000
          && Objects.equals(proof.recoveryDigests.get(table), recoveryDigest(old, rows));
    }
    return !r.recoveryFormat.equals("LOCAL_V1")
        && r.plan.tables.stream().anyMatch(t -> t.name().equals(table) && t.data())
        && old.rows.size() <= 20000;
  }

  public static String recoveryDigest(Table original, List<Map<String, Object>> rows) {
    return Json.hash(List.of(Sql.schemaHash(original), rows));
  }

  public static void captureRecovery(
      TargetPlan tp, TargetResult proof, String table, List<Map<String, Object>> rows) {
    proof.recoveryRows.put(table, rows);
    proof.recoveryDigests.put(table, recoveryDigest(tp.before.get(table), rows));
  }

  /** 本地字段原值恢复资料行：优先计划快照，其次执行前采集。 */
  public static List<Map<String, Object>> valueRestoreRows(
      SyncRecord r, TargetPlan tp, TargetResult proof, String table) {
    if (proof != null && proof.recoveryRows.get(table) != null)
      return proof.recoveryRows.get(table);
    return tp.before.get(table).rows;
  }

  public List<String> inverse(SyncRecord r, TargetPlan tp, Change x) {
    return inverse(
        r, tp, x, r.results.stream().filter(t -> t.ref.equals(tp.ref)).findFirst().orElse(null));
  }

  public List<String> inverse(SyncRecord r, TargetPlan tp, Change x, TargetResult proof) {
    var result = new ArrayList<String>(x.rollbackSql);
    if (needsValueRestore(x)) {
      var old = tp.before.get(x.table);
      if (!r.recoveryFormat.equals("LOCAL_V1")
          && proof != null
          && proof.backups.containsKey(x.table)) {
        String b = proof.backups.get(x.table);
        result.add(valueRestoreJoinSql(tp, old, x, b));
      } else if (valueRestoreAvailable(r, tp, proof, x.table)) {
        var pk = old.primaryKey();
        if (!pk.isEmpty())
          for (var row : valueRestoreRows(r, tp, proof, x.table))
            result.add(valueRestoreRowSql(tp, x, row, pk));
      }
    }
    return result;
  }

  private String valueRestoreJoinSql(TargetPlan tp, Table old, Change x, String backup) {
    var pk = old.primaryKey();
    return "UPDATE "
        + Sql.qualified(tp.ref, x.table)
        + " AS t JOIN "
        + Sql.qualified(tp.ref, backup)
        + " AS b ON "
        + pk.stream()
            .map(k -> "t." + Sql.id(k) + " <=> b." + Sql.id(k))
            .collect(java.util.stream.Collectors.joining(" AND "))
        + " SET t."
        + Sql.id(x.label)
        + "=b."
        + Sql.id(x.label);
  }

  static String valueRestoreRowSql(
      TargetPlan tp, Change x, Map<String, Object> row, List<String> pk) {
    Object value = row.get(x.label);
    return "UPDATE "
        + Sql.qualified(tp.ref, x.table)
        + " SET "
        + Sql.id(x.label)
        + "="
        + Sql.value(value)
        + " WHERE "
        + Sql.where(row, pk);
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
      var apply = new StringBuilder(Sql.header());
      var rollback = new StringBuilder(Sql.header());
      var full = new StringBuilder(Sql.header());
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
      var reversed = new ArrayList<>(selected);
      Collections.reverse(reversed);
      rollback.append("-- 请先在 Data Sync 核验恢复资料和后续变更；发生冲突时不要执行。\n");
      for (var x : reversed) {
        var proof = r.results.stream().filter(t -> t.ref.equals(tp.ref)).findFirst().orElse(null);
        boolean manualRestore =
            needsValueRestore(x) && !valueRestoreAvailable(r, tp, proof, x.table);
        if (manualRestore) {
          rollback
              .append("-- 警告：")
              .append(Sql.comment(x.table))
              .append(" / ")
              .append(x.label.replace('\n', ' '))
              .append(" 缺少字段原值恢复资料，只能恢复字段定义，原值需人工恢复。\n");
        }
        for (String sql : inverse(r, tp, x)) rollback.append(sql).append(";\n");
      }
      for (var x : tp.changes)
        full.append(
            x.blocked ? "-- BLOCKED: " + x.reason.replace('\n', ' ') + "\n" : x.sql + ";\n");
      write(td.resolve("00_full_diff.sql"), full.toString());
      write(td.resolve("02_sync.sql"), apply.toString());
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
            + "外部执行顺序：02_sync.sql。必须配置数据库工具遇到错误停止。任何步骤失败都应停止后续步骤。\n"
            + "02 中含 DDL 时不具备整个文件的事务原子性。请在维护窗口执行，避免同时写入相关表。\n"
            + "脚本不会在目标库创建备份表或凭据表；回滚依赖记录内保存的字段原值与行数据（每表上限 20,000 行）。执行前采集后追加 recovery.json 与"
            + " 05_rollback_local.sql；有 05 时优先使用，04 保留原始计划。请保留全部文件。\n"
            + "执行后回到客户端登记执行范围并校验。04_rollback.sql 仅在恢复资料完整、且后续变更校验通过时使用；缺少原值资料的表需按 00_full_diff.sql"
            + " 人工恢复。\n"
            + "导出文件不会自动执行，原始记录与执行结果分别归档。\n");
    return folder;
  }

  /** 在目标锁内完成采集后追加不可变资料，写入失败必须在业务变更前停止。 */
  public void prepareLocalRecovery(SyncRecord r, TargetPlan tp, TargetResult proof)
      throws Exception {
    Path folder =
        Path.of(r.archivePath)
            .resolve(Json.hash(tp.ref.key()).substring(0, 12) + "-" + sanitize(tp.ref.database()));
    write(
        folder.resolve("recovery.json"),
        Json.write(
            Map.of(
                "target",
                tp.ref,
                "format",
                r.recoveryFormat,
                "rows",
                proof.recoveryRows,
                "digests",
                proof.recoveryDigests)));
    var rollback = new StringBuilder(Sql.header());
    rollback
        .append("-- 包含已选计划的逆向 SQL，不证明所有步骤已执行。\n")
        .append("-- 请先在 Data Sync 核验实际完成范围、恢复资料和后续修改，仅恢复实际完成项。\n");
    var reversed = new ArrayList<>(chosen(r, tp));
    Collections.reverse(reversed);
    for (var x : reversed) {
      rollback.append("-- ").append(Sql.comment(x.table)).append(" / ").append(x.id).append('\n');
      if (needsValueRestore(x) && !valueRestoreAvailable(r, tp, proof, x.table)) {
        rollback.append("-- 缺少完整字段原值恢复资料，需人工恢复；以下定义恢复 SQL 不可自动执行。\n");
        for (String sql : x.rollbackSql)
          rollback.append("-- ").append(sql.replace("\n", "\n-- ")).append(";\n");
      } else for (String sql : inverse(r, tp, x, proof)) rollback.append(sql).append(";\n");
    }
    write(folder.resolve("05_rollback_local.sql"), rollback.toString());
  }

  public void finalizeRecord(SyncRecord r) throws Exception {
    Path f = Path.of(r.archivePath);
    Path record = f.resolve("record.json");
    if (!Files.exists(record)) write(record, Json.write(r));
    Path logs = f.resolve("execution-events.json");
    if (!Files.exists(logs)) write(logs, Json.write(store.events(r.id)));
  }

  private void write(Path path, String text) throws IOException {
    try (var channel =
        java.nio.channels.FileChannel.open(
            path, StandardOpenOption.WRITE, StandardOpenOption.CREATE_NEW)) {
      var bytes = java.nio.ByteBuffer.wrap(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
      while (bytes.hasRemaining()) channel.write(bytes);
      channel.force(true);
    }
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
