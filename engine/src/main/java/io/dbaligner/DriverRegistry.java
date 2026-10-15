package io.dbaligner;

import com.fasterxml.jackson.databind.JsonNode;
import java.net.URLClassLoader;
import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;

/** 仅加载应用目录中声明并校验过的 JDBC 驱动，不扫描用户 JAR。 */
public final class DriverRegistry implements AutoCloseable {
  private final Path root;
  private final JsonNode catalogue;
  private final Map<String, Driver> drivers = new HashMap<>();
  private final List<URLClassLoader> loaders = new ArrayList<>();

  public DriverRegistry(Path root) {
    this.root = root.toAbsolutePath().normalize();
    try (var stream = DriverRegistry.class.getResourceAsStream("/drivers.json")) {
      catalogue = Json.MAPPER.readTree(stream);
    } catch (Exception e) {
      throw new IllegalStateException("驱动目录读取失败", e);
    }
  }

  public static String type(JsonNode cfg) {
    String type = cfg.path("databaseType").asText("mysql");
    if (!List.of("mysql", "postgresql").contains(type))
      throw new IllegalArgumentException("不支持的数据库类型");
    return type;
  }

  public JsonNode entry(JsonNode cfg) {
    String type = type(cfg);
    String id = cfg.path("driverId").asText(type.equals("mysql") ? "mariadb" : "postgresql");
    for (var entry : catalogue)
      if (entry.path("id").asText().equals(id)
          && entry.path("databaseType").asText().equals(type)) {
        if (!cfg.path("driverVersion")
            .asText(entry.path("version").asText())
            .equals(entry.path("version").asText()))
          throw new IllegalArgumentException("驱动版本不在当前支持目录内");
        return entry;
      }
    throw new IllegalArgumentException("驱动与数据库类型不匹配");
  }

  public Connection open(JsonNode cfg, String url, Properties properties) throws Exception {
    Driver driver = load(cfg);
    Connection connection = driver.connect(url, properties);
    if (connection == null) throw new IllegalArgumentException("驱动不接受该连接类型");
    return connection;
  }

  private synchronized Driver load(JsonNode cfg) throws Exception {
    var entry = entry(cfg);
    String key = entry.path("id").asText() + "/" + entry.path("version").asText();
    Driver driver = drivers.get(key);
    if (driver == null) {
      ClassLoader loader = DriverRegistry.class.getClassLoader();
      if (!entry.path("builtin").asBoolean()) {
        Path base = root.resolve("drivers");
        Path directory = base.resolve(key).normalize();
        var urls = new ArrayList<java.net.URL>();
        for (var file : entry.path("files")) {
          Path jar = directory.resolve(file.path("name").asText()).normalize();
          if (!Files.isRegularFile(jar)) throw new IllegalArgumentException("请先安装 PostgreSQL 驱动");
          for (Path part = jar; part != null && !part.equals(root); part = part.getParent())
            if (Files.isSymbolicLink(part)) throw new IllegalArgumentException("驱动路径不安全");
          if (!jar.toRealPath().startsWith(base.toRealPath()) || Files.size(jar) > 20_000_000)
            throw new IllegalArgumentException("驱动文件不在允许范围");
          String hash =
              HexFormat.of()
                  .formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(jar)));
          if (!hash.equals(file.path("sha256").asText()))
            throw new IllegalArgumentException("驱动文件摘要不匹配，请重新安装");
          urls.add(jar.toUri().toURL());
        }
        var dynamic = new URLClassLoader(urls.toArray(java.net.URL[]::new), loader);
        loaders.add(dynamic);
        loader = dynamic;
      }
      driver =
          (Driver)
              Class.forName(entry.path("driverClass").asText(), true, loader)
                  .getConstructor()
                  .newInstance();
      drivers.put(key, driver);
    }
    return driver;
  }

  public synchronized void close() throws Exception {
    drivers.clear();
    for (var loader : loaders) loader.close();
    loaders.clear();
  }
}
