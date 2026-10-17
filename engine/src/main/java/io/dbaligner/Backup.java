package io.dbaligner;

import java.nio.file.*;
import java.sql.*;
import java.util.*;
import java.util.zip.*;

public final class Backup {
  public static void exportAll(Store store, Path destination) throws Exception {
    Path temp = store.root.resolve("backup-" + UUID.randomUUID() + ".sqlite");
    store.backup(temp);
    try (var z =
        new ZipOutputStream(Files.newOutputStream(destination, StandardOpenOption.CREATE_NEW))) {
      z.putNextEntry(new ZipEntry("state.sqlite"));
      Files.copy(temp, z);
      z.closeEntry();
      for (var r : store.list("record")) {
        if (r.path("archivePath").asText().isBlank()) continue;
        Path f = Path.of(r.path("archivePath").asText());
        if (!Files.isDirectory(f)) continue;
        Path real = f.toRealPath();
        try (var paths = Files.walk(f)) {
          for (Path p : paths.filter(Files::isRegularFile).toList()) {
            if (Files.isSymbolicLink(p) || !p.toRealPath().startsWith(real))
              throw new IllegalArgumentException("非法备份路径");
            z.putNextEntry(
                new ZipEntry(
                    "records/"
                        + r.path("id").asText()
                        + "/"
                        + f.relativize(p).toString().replace('\\', '/')));
            Files.copy(p, z);
            z.closeEntry();
          }
        }
      }
    } finally {
      Files.deleteIfExists(temp);
    }
  }

  public static Object prepareRestore(Store store, Path source) throws Exception {
    Path target = store.root.resolve("restored").resolve(UUID.randomUUID().toString());
    Files.createDirectories(target);
    long total = 0;
    try (var z = new ZipInputStream(Files.newInputStream(source))) {
      ZipEntry e;
      while ((e = z.getNextEntry()) != null) {
        if (e.isDirectory()) continue;
        Path p = target.resolve(e.getName()).normalize();
        if (!p.startsWith(target)
            || !(e.getName().equals("state.sqlite") || e.getName().startsWith("records/")))
          throw new IllegalArgumentException("非法备份文件路径");
        Files.createDirectories(p.getParent());
        try (var out = Files.newOutputStream(p, StandardOpenOption.CREATE_NEW)) {
          byte[] buf = new byte[65536];
          int n;
          while ((n = z.read(buf)) >= 0) {
            total += n;
            if (total > 2_000_000_000L) throw new IllegalArgumentException("备份展开超过 2 GB");
            out.write(buf, 0, n);
          }
        }
      }
    }
    Path sqlite = target.resolve("state.sqlite");
    try (var c = DriverManager.getConnection("jdbc:sqlite:" + sqlite);
        var s = c.createStatement();
        var r = s.executeQuery("PRAGMA integrity_check")) {
      if (!r.next() || !r.getString(1).equals("ok")) throw new IllegalArgumentException("备份数据库损坏");
      try (var tables = c.createStatement();
          var rs = tables.executeQuery("SELECT COUNT(*) FROM entities")) {
        rs.next();
      }
      try (var pending = c.createStatement();
          var rows =
              pending.executeQuery("SELECT COUNT(*) FROM entities WHERE kind='recordDeletion'")) {
        if (rows.next() && rows.getInt(1) > 0)
          throw new IllegalArgumentException("备份含未完成的档案删除日志，拒绝恢复");
      }
      try (var records = c.createStatement();
          var rs = records.executeQuery("SELECT id,json FROM entities WHERE kind='record'")) {
        while (rs.next()) {
          String id = rs.getString(1);
          var value = Json.read(rs.getString(2), com.fasterxml.jackson.databind.JsonNode.class);
          if (!id.matches("(?:SYNC|ROLL)-[a-zA-Z0-9-]+") || !id.equals(value.path("id").asText()))
            throw new IllegalArgumentException("备份包含非法记录标识");
        }
      }
    }
    return Map.of("folder", target.toString(), "sqlite", sqlite.toString());
  }
}
