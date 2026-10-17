package io.dbaligner;

import static io.dbaligner.Model.*;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.nio.file.*;
import java.util.*;
import java.util.function.Consumer;

public final class Service implements AutoCloseable {
  public final Store store;
  private final Database db;
  private final Planner planner;
  private final Archives archives;
  private final Jobs jobs;
  private final External external;
  private final Comparisons comparisons;
  private final ConnectionGroups connectionGroups;
  private final RecordManagement recordManagement;
  private final java.util.concurrent.locks.ReentrantReadWriteLock resourceGate =
      new java.util.concurrent.locks.ReentrantReadWriteLock(true);
  private final UpdateGate updateGate = new UpdateGate();
  private final Map<String, SyncPlan> plans = new java.util.concurrent.ConcurrentHashMap<>();

  public Service(Path root, Consumer<Object> emit) throws Exception {
    store = new Store(root);
    recordManagement = new RecordManagement(store);
    connectionGroups = new ConnectionGroups(store);
    connectionGroups.migrate();
    db = new Database(store);
    planner = new Planner(db);
    archives = new Archives(store);
    jobs = new Jobs(store, db, archives, emit);
    external = new External(store, db, archives);
    comparisons = new Comparisons(emit, plan -> plans.put(plan.id, plan));
  }

  public Object handle(String method, JsonNode p) throws Exception {
    if (method.equals("engine.prepareUpdate"))
      return updateGate.prepare(() -> jobs.busy() || comparisons.busy());
    if (method.equals("engine.resumeUpdate")) return updateGate.resume();
    if (List.of("sync.compare", "sync.compare.get", "sync.compare.cancel", "record.cancel")
        .contains(method)) return updateGate.request(() -> dispatch(method, p));
    return updateGate.request(
        () -> {
          boolean mutation =
              List.of(
                      "entity.save",
                      "entity.delete",
                      "connectionGroups.save",
                      "connectionGroups.delete",
                      "connectionGroups.move",
                      "connections.move",
                      "record.updateRemark",
                      "record.delete",
                      "version.delete",
                      "version.save",
                      "archives.clear",
                      "backup.export",
                      "backup.prepareRestore",
                      "backup.finishRestore",
                      "config.import")
                  .contains(method);
          var lock = mutation ? resourceGate.writeLock() : resourceGate.readLock();
          lock.lock();
          try {
            return dispatch(method, p);
          } finally {
            lock.unlock();
          }
        });
  }

  private Object dispatch(String method, JsonNode p) throws Exception {
    db.secrets(p.path("$secrets"));
    return switch (method) {
      case "ping" ->
          Map.of(
              "version", BuildVersion.get(), "protocol", 1, "java", Runtime.version().toString());
      case "state.load" ->
          Map.of(
              "workspaces",
              store.list("workspace"),
              "connections",
              store.list("connection"),
              "connectionGroups",
              connectionGroups.groups(),
              "templates",
              store.list("template"),
              "records",
              store.recordSummaries(),
              "versions",
              store.list("version"),
              "versionLinks",
              store.versionLinks(),
              "settings",
              store.get("settings", "global"),
              "external",
              store.list("external"),
              "pendingDeletions",
              recordManagement.pending());
      case "entity.save" ->
          store.transaction(
              () ->
                  saveEntity(
                      p.path("kind").asText(),
                      p.path("value"),
                      p.has("groupId") ? p.path("groupId").asText() : null));
      case "connectionGroups.save" ->
          connectionGroups.save(p.path("id").asText(), p.path("name").asText());
      case "connections.move" -> connectionGroups.move(p);
      case "connectionGroups.move" -> connectionGroups.moveGroup(p);
      case "connectionGroups.delete" -> connectionGroups.delete(p.path("groupId").asText());
      case "entity.delete" -> {
        String kind = p.path("kind").asText();
        if (!List.of("workspace", "connection", "template").contains(kind))
          throw new IllegalArgumentException("不允许删除该类型");
        if (jobs.busy()) throw new IllegalArgumentException("执行中暂不可删除配置");
        if (comparisons.busy() && !kind.equals("template"))
          throw new IllegalArgumentException("比较中暂不可删除工作区或连接");
        store.transaction(
            () -> {
              String id = p.path("id").asText();
              if (store.get(kind, id) == null) throw new IllegalArgumentException("配置不存在");
              if (kind.equals("workspace")) {
                if (store.list("workspace").size() <= 1)
                  throw new IllegalArgumentException("至少保留一个工作区");
                if (comparisons.busy()) throw new IllegalArgumentException("比较中暂不可删除工作区");
                if (store.list("connection").stream()
                    .anyMatch(c -> Json.strings(c.path("workspaceIds")).contains(id)))
                  throw new IllegalArgumentException("工作区仍有关联连接，请先移除关联");
                for (String child : List.of("template", "record", "version"))
                  if (store.list(child).stream()
                      .anyMatch(v -> v.path("workspaceId").asText().equals(id)))
                    throw new IllegalArgumentException("工作区仍有模板、同步记录或版本，请先处理关联内容");
                plans.values().removeIf(plan -> plan.workspaceId.equals(id));
              }
              store.delete(kind, id);
              if (kind.equals("connection")) syncWorkspaceConnections();
              return null;
            });
        yield Map.of("ok", true);
      }
      case "connections.test" -> {
        var ref =
            new DbRef(
                p.path("config").isObject()
                    ? p.path("config").path("id").asText()
                    : p.path("id").asText(),
                "");
        try (var c =
            p.path("config").isObject()
                ? db.openConfig(
                    ref, p.path("config"), p.path("$secrets").path(ref.connectionId()).asText())
                : db.open(ref)) {
          yield Map.of("ok", true, "serverVersion", db.version(c));
        }
      }
      case "databases.list" ->
          p.path("config").isObject()
              ? db.databases(p.path("config"))
              : db.databases(p.path("connectionId").asText());
      case "schemas.list" -> db.schemas(ref(p.path("ref")));
      case "database.capabilities" -> db.capabilities(ref(p.path("ref")));
      case "tables.list" -> db.tables(ref(p.path("ref")));
      case "table.get" -> db.snapshot(ref(p.path("ref")), p.path("table").asText(), false);
      case "imports.parse" -> Imports.parse(p.path("format").asText(), p.path("content").asText());
      case "sync.compare.start" -> startComparison(p);
      case "sync.compare.get" -> comparisons.get(p.path("compareId").asText());
      case "sync.compare.cancel" -> comparisons.cancel(p.path("compareId").asText());
      case "sync.compare" -> {
        String id = ((Map<?, ?>) handle("sync.compare.start", p)).get("compareId").toString();
        Map<String, Object> result;
        do {
          Thread.sleep(25);
          result = comparisons.get(id);
        } while (List.of("RUNNING", "CANCELLING").contains(result.get("status")));
        if (result.get("status").equals("CANCELLED"))
          throw new java.util.concurrent.CancellationException("比较已停止");
        if (result.get("status").equals("FAILED"))
          throw new IllegalArgumentException(result.get("error").toString());
        yield result.get("plan");
      }
      case "sync.save" -> {
        var plan = plans.get(p.path("planId").asText());
        if (plan == null || store.get("workspace", plan.workspaceId) == null)
          throw new IllegalArgumentException("比较计划已过期，请重新比较");
        yield jobs.save(
            plan,
            Json.strings(p.path("selectedIds")),
            p.path("mode").asText(),
            p.path("remark").asText());
      }
      case "record.updateRemark" -> {
        if (jobs.busy(text(p, "id"))) throw new IllegalArgumentException("请等待本记录执行结束后编辑备注");
        yield recordManagement.remark(text(p, "id"), text(p, "remark"));
      }
      case "record.delete" -> {
        if (jobs.busy(text(p, "id"))) throw new IllegalArgumentException("请等待本记录执行结束后删除记录");
        yield recordManagement.deleteRecord(text(p, "id"), text(p, "confirmation"));
      }
      case "version.delete" ->
          recordManagement.deleteVersion(text(p, "id"), text(p, "confirmation"));
      case "record.get" -> {
        String id = p.path("id").asText();
        var r = store.get("record", id);
        if (r == null) throw new IllegalArgumentException("记录不存在");
        yield Map.of(
            "record",
            r,
            "events",
            store.events(id),
            "external",
            Optional.ofNullable(store.get("external", id)).orElse(Json.MAPPER.createObjectNode()),
            "verification",
            Optional.ofNullable(store.get("verification", id))
                .orElse(Json.MAPPER.createObjectNode()),
            "files",
            recordFiles(r));
      }
      case "record.file" -> {
        var r = store.get("record", p.path("id").asText());
        if (r == null) throw new IllegalArgumentException("记录不存在");
        Path root = Path.of(r.path("archivePath").asText()).toRealPath();
        Path file = root.resolve(p.path("file").asText()).normalize();
        if (!file.startsWith(root) || !file.toRealPath().startsWith(root))
          throw new IllegalArgumentException("非法档案路径");
        if (Files.size(file) > 4_000_000) throw new IllegalArgumentException("文件较大，请导出后查看");
        yield Files.readString(file);
      }
      case "record.cancel" -> {
        jobs.cancel(p.path("id").asText());
        yield Map.of("ok", true);
      }
      case "record.export" -> {
        archives.zip(Json.strings(p.path("ids")), Path.of(p.path("destination").asText()));
        yield Map.of("ok", true);
      }
      case "version.save" -> saveVersion(p);
      case "rollback.preview" -> jobs.preview(p.path("id").asText());
      case "rollback.execute" ->
          jobs.rollback(
              p.path("id").asText(),
              Json.strings(p.path("selectedIds")),
              p.path("remark").asText());
      case "external.declare" ->
          external.declare(
              p.path("id").asText(),
              Json.strings(p.path("confirmedIds")),
              p.path("backupCompleted").asBoolean(),
              p.path("remark").asText());
      case "external.verify" -> external.verify(p.path("id").asText());
      case "record.verify" -> external.audit(p.path("id").asText());
      case "schema.export" -> schemaExport(Json.MAPPER.treeToValue(p, SchemaExportOptions.class));
      case "backup.export" -> {
        if (!recordManagement.pending().isEmpty())
          throw new IllegalArgumentException("请先完成待处理的档案清理再备份");
        if (jobs.busy()) throw new IllegalArgumentException("请等待执行任务结束后备份");
        Backup.exportAll(store, Path.of(p.path("destination").asText()));
        yield Map.of("ok", true);
      }
      case "backup.prepareRestore" -> {
        if (jobs.busy()) throw new IllegalArgumentException("请等待执行任务结束后恢复");
        yield Backup.prepareRestore(store, Path.of(p.path("source").asText()));
      }
      case "backup.finishRestore" -> {
        String folder = p.path("folder").asText();
        Path root = store.root.resolve("restored").toRealPath();
        Path f = Path.of(folder).toRealPath();
        if (!f.startsWith(root)) throw new IllegalArgumentException("恢复目录非法");
        var settings = (ObjectNode) store.get("settings", "global");
        settings.put("archivePath", store.root.resolve("archives").toString());
        store.put("settings", "global", settings);
        for (var n : store.list("record")) {
          var copy = (ObjectNode) n.deepCopy();
          copy.put("archivePath", f.resolve("records").resolve(n.path("id").asText()).toString());
          store.put("record", n.path("id").asText(), copy);
        }
        yield Map.of("ok", true);
      }
      case "config.export" ->
          Map.of(
              "format",
              "dbaligner-config-v1",
              "connectionGroups",
              connectionGroups.groups(),
              "workspaces",
              store.list("workspace"),
              "connections",
              store.list("connection").stream()
                  .map(
                      c -> {
                        var n = (ObjectNode) c.deepCopy();
                        n.put("hasPassword", false);
                        n.put("ca", "");
                        n.put("clientCert", "");
                        return n;
                      })
                  .toList(),
              "templates",
              store.list("template"));
      case "config.import" -> {
        JsonNode config = Json.read(p.path("content").asText(), JsonNode.class);
        if (!config.path("format").asText().equals("dbaligner-config-v1"))
          throw new IllegalArgumentException("配置格式不正确");
        connectionGroups.importGroups(config.path("connectionGroups"));
        for (String kind : List.of("workspace", "connection", "template"))
          for (JsonNode item : config.path(kind.equals("workspace") ? "workspaces" : kind + "s")) {
            var value = (ObjectNode) item.deepCopy();
            if (kind.equals("workspace")) value.remove("connectionIds");
            saveEntity(kind, value);
          }
        syncWorkspaceConnections();
        yield Map.of("ok", true);
      }
      case "archives.clear" -> {
        if (jobs.busy()) throw new IllegalArgumentException("执行中不能清理档案");
        String id = p.path("id").asText();
        if (!p.path("confirm").asBoolean()) throw new IllegalArgumentException("请确认永久删除恢复资料");
        var n = store.get("record", id);
        if (n == null) throw new IllegalArgumentException("记录不存在");
        Path f = Path.of(n.path("archivePath").asText()).toAbsolutePath().normalize();
        if (!f.getFileName().toString().equals(id) || !id.matches("(?:SYNC|ROLL)-[a-zA-Z0-9-]+"))
          throw new IllegalArgumentException("档案路径验证失败");
        if (Files.exists(f)) {
          try (var paths = Files.walk(f)) {
            var entries = paths.sorted(Comparator.reverseOrder()).toList();
            for (Path path : entries)
              if (Files.isSymbolicLink(path) || !path.toRealPath().startsWith(f.toRealPath()))
                throw new IllegalArgumentException("档案包含不安全路径");
            for (Path path : entries) Files.delete(path);
          }
        }
        store.event(id, Map.of("type", "archive-cleared", "rollbackUnavailable", true));
        yield Map.of("ok", true);
      }
      default -> throw new IllegalArgumentException("未知引擎接口：" + method);
    };
  }

  private DbRef ref(JsonNode n) throws Exception {
    return Json.MAPPER.treeToValue(n, DbRef.class);
  }

  private Object saveEntity(String kind, JsonNode value) throws Exception {
    return store.transaction(() -> saveEntity(kind, value, null));
  }

  private Object saveEntity(String kind, JsonNode value, String groupId) throws Exception {
    if (!List.of("workspace", "connection", "template", "settings").contains(kind)
        || !value.isObject()) throw new IllegalArgumentException("无效配置类型");
    var v = (ObjectNode) value.deepCopy();
    v.remove(List.of("password", "certificatePassword", "$secrets"));
    if (kind.equals("connection"))
      v.retain(
          "id",
          "name",
          "host",
          "port",
          "user",
          "group",
          "sortOrder",
          "databases",
          "workspaceIds",
          "ssl",
          "ca",
          "clientCert",
          "hasPassword",
          "databaseType",
          "driverId",
          "driverVersion",
          "initialDatabase");
    String id = v.path("id").asText();
    if (id.isBlank()) id = UUID.randomUUID().toString();
    if (!id.matches("[a-zA-Z0-9-]{1,100}")) throw new IllegalArgumentException("配置标识无效");
    v.put("id", id);
    if (kind.equals("settings")) {
      if (jobs.busy()) throw new IllegalArgumentException("请等待任务结束后修改执行设置");
      id = "global";
      v.put("id", id);
      if (v.path("concurrency").asInt() < 1
          || v.path("concurrency").asInt() > 16
          || v.path("perHost").asInt() < 1
          || v.path("perHost").asInt() > 8
          || v.path("batchSize").asInt() < 1
          || v.path("batchSize").asInt() > 5000) throw new IllegalArgumentException("执行参数超出范围");
      Path archive = Path.of(v.path("archivePath").asText());
      if (!archive.isAbsolute()) throw new IllegalArgumentException("档案目录必须是绝对路径");
      Files.createDirectories(archive);
    } else if (v.path("name").asText().isBlank()) throw new IllegalArgumentException("名称不能为空");
    if (kind.equals("connection")) {
      var driver = new DriverRegistry(store.root).entry(v);
      if (v.has("databaseType")) {
        v.put("driverId", driver.path("id").asText());
        v.put("driverVersion", driver.path("version").asText());
      }
      if (DriverRegistry.type(v).equals("postgresql")
          && v.path("initialDatabase").asText().isBlank())
        throw new IllegalArgumentException("请输入初始连接数据库");
      if (!v.path("host").asText().matches("[a-zA-Z0-9.\\-:\\[\\]]+")
          || v.path("user").asText().isBlank()
          || !v.path("port").isIntegralNumber()
          || !v.path("port").canConvertToInt()
          || v.path("port").asInt() < 1
          || v.path("port").asInt() > 65535) throw new IllegalArgumentException("请填写有效的服务器、端口和用户");
    }
    if (kind.equals("connection")) {
      if (groupId != null) {
        var group = store.get("connectionGroup", groupId);
        if (group == null) throw new IllegalArgumentException("分组已删除，请重新选择");
        v.put("group", group.path("name").asText());
      }
      for (String workspaceId : Json.strings(v.path("workspaceIds")))
        if (store.get("workspace", workspaceId) == null)
          throw new IllegalArgumentException("关联工作区已删除，请重新选择");
      var saved = connectionGroups.saveConnection(v);
      syncWorkspaceConnections();
      return saved;
    }
    if (kind.equals("template") && store.get("workspace", v.path("workspaceId").asText()) == null)
      throw new IllegalArgumentException("工作区已删除，请重新选择");
    if (kind.equals("workspace") && v.has("connectionIds")) {
      var ids = Json.strings(v.path("connectionIds"));
      for (String connectionId : ids)
        if (store.get("connection", connectionId) == null)
          throw new IllegalArgumentException("关联连接已删除，请重新选择");
      for (var connection : store.list("connection")) {
        var copy = (ObjectNode) connection.deepCopy();
        var workspaces = new ArrayList<>(Json.strings(copy.path("workspaceIds")));
        workspaces.remove(id);
        if (ids.contains(copy.path("id").asText())) workspaces.add(id);
        copy.set("workspaceIds", Json.node(workspaces));
        store.put("connection", copy.path("id").asText(), copy);
      }
    }
    return store.put(kind, id, v);
  }

  private String text(JsonNode parameters, String field) {
    if (!parameters.path(field).isTextual()) throw new IllegalArgumentException("参数必须为文本：" + field);
    return parameters.path(field).asText();
  }

  private void syncWorkspaceConnections() throws Exception {
    var connections = store.list("connection");
    for (var workspace : store.list("workspace")) {
      if (!workspace.has("connectionIds")) continue;
      String id = workspace.path("id").asText();
      var copy = (ObjectNode) workspace.deepCopy();
      copy.set(
          "connectionIds",
          Json.node(
              connections.stream()
                  .filter(c -> Json.strings(c.path("workspaceIds")).contains(id))
                  .map(c -> c.path("id").asText())
                  .toList()));
      store.put("workspace", id, copy);
    }
  }

  private Object saveVersion(JsonNode p) throws Exception {
    String workspace = p.path("workspaceId").asText(), id = p.path("id").asText();
    if (store.get("workspace", workspace) == null)
      throw new IllegalArgumentException("工作区已删除，请重新选择");
    if (id.isBlank()) id = UUID.randomUUID().toString();
    String number = p.path("number").asText().trim();
    if (number.isBlank()) throw new IllegalArgumentException("版本号不能为空");
    for (var v : store.list("version"))
      if (v.path("workspaceId").asText().equals(workspace)
          && v.path("number").asText().equals(number)
          && !v.path("id").asText().equals(id)) throw new IllegalArgumentException("工作区内版本号已存在");
    var version =
        Map.of(
            "id",
            id,
            "workspaceId",
            workspace,
            "number",
            number,
            "description",
            p.path("description").asText(),
            "createdAt",
            store.get("version", id) == null
                ? java.time.Instant.now().toString()
                : store.get("version", id).path("createdAt").asText());
    store.saveVersion(id, version, Json.strings(p.path("recordIds")), p.path("move").asBoolean());
    return version;
  }

  private List<String> recordFiles(JsonNode r) throws Exception {
    Path root = Path.of(r.path("archivePath").asText());
    if (!Files.exists(root)) return List.of();
    try (var paths = Files.walk(root)) {
      return paths
          .filter(Files::isRegularFile)
          .map(p -> root.relativize(p).toString().replace('\\', '/'))
          .sorted()
          .toList();
    }
  }

  private Object schemaExport(SchemaExportOptions opts) throws Exception {
    if (opts.tables().isEmpty()) throw new IllegalArgumentException("请选择导出表");
    var tables = new ArrayList<Table>();
    try (var c = db.open(opts.source())) {
      for (String name : opts.tables()) {
        var t = db.snapshot(c, opts.source(), name, false);
        if (!t.exists) throw new IllegalArgumentException("表不存在：" + name);
        tables.add(t);
      }
    }
    if (db.type(opts.source()).equals("postgresql")) return postgresExport(opts, tables);
    var b =
        new StringBuilder(
            "-- DBAligner / 仅表结构 / "
                + (opts.includeDrop() ? "包含 DROP（会删除已有表及数据）" : "不含 DROP")
                + "\n"
                + Sql.header());
    if (opts.includeDrop()) {
      b.append("SET @ds_previous_fk_checks = @@FOREIGN_KEY_CHECKS;\nSET FOREIGN_KEY_CHECKS=0;\n");
      for (var t : tables) b.append("DROP TABLE IF EXISTS ").append(Sql.id(t.name)).append(";\n");
    }
    for (var t : tables)
      b.append("\n-- ")
          .append(t.name.replace('\n', ' '))
          .append('\n')
          .append(Sql.withoutForeignKeys(t.createSql))
          .append(";\n");
    for (var t : tables)
      for (var fk : t.foreignKeys)
        b.append("ALTER TABLE ")
            .append(Sql.id(t.name))
            .append(" ADD ")
            .append(fk.definition())
            .append(";\n");
    if (opts.includeDrop()) b.append("SET FOREIGN_KEY_CHECKS=@ds_previous_fk_checks;\n");
    return Map.of("sql", b.toString(), "tables", opts.tables(), "includeDrop", opts.includeDrop());
  }

  private Object postgresExport(SchemaExportOptions opts, List<Table> tables) throws Exception {
    for (var t : tables)
      if (!t.supported) throw new IllegalArgumentException(String.join("；", t.issues));
    var sql = new StringBuilder(Sql.header(opts.source()));
    if (opts.includeDrop()) {
      var selected = new HashSet<>(opts.tables());
      for (var t : tables)
        for (var fk : t.foreignKeys)
          if (!selected.contains(fk.referencedTable()))
            throw new IllegalArgumentException("DROP 范围包含未选外键依赖");
      if (!tables.isEmpty())
        sql.append("DROP TABLE IF EXISTS ")
            .append(
                String.join(
                    ",", tables.stream().map(t -> Sql.qualified(opts.source(), t.name)).toList()))
            .append(";\n");
    }
    for (var t : tables) {
      sql.append(PostgresSql.create(t, opts.source())).append(";\n");
      sql.append("COMMENT ON TABLE ")
          .append(Sql.qualified(opts.source(), t.name))
          .append(" IS ")
          .append(PostgresSql.literal(t.comment))
          .append(";\n");
      for (var col : t.columns)
        for (String line : PostgresSql.comment(opts.source(), t.name, col))
          sql.append(line).append(";\n");
      for (var idx : t.indexes)
        sql.append(PostgresPlanner.indexSql(opts.source(), t.name, idx)).append(";\n");
    }
    for (var t : tables)
      for (var fk : t.foreignKeys)
        sql.append("ALTER TABLE ")
            .append(Sql.qualified(opts.source(), t.name))
            .append(" ADD ")
            .append(fk.definition())
            .append(";\n");
    return Map.of("sql", sql.toString());
  }

  private Map<String, Object> startComparison(JsonNode p) throws Exception {
    var params = p.deepCopy();
    var credentials = Json.node(db.secretSnapshot());
    for (var choice : params.path("tables")) {
      var options = choice.get("structureOptions");
      if (options != null && !options.isNull()) {
        for (String key :
            List.of(
                "columns",
                "columnOrder",
                "tableComment",
                "columnComments",
                "indexes",
                "foreignKeys",
                "tableCollation"))
          if (!options.path(key).isBoolean())
            throw new IllegalArgumentException("结构细项缺少布尔值：" + key);
      }
    }
    var source = ref(params.path("source"));
    var targets = Arrays.asList(Json.MAPPER.treeToValue(params.path("targets"), DbRef[].class));
    var tables = Arrays.asList(Json.MAPPER.treeToValue(params.path("tables"), TableChoice[].class));
    String id = params.path("compareId").asText();
    if (id.isBlank()) id = "COMPARE-" + UUID.randomUUID();
    else UUID.fromString(id);
    return comparisons.start(
        id,
        () -> {
          db.secrets(credentials);
          return planner.compare(params.path("workspaceId").asText(), source, targets, tables);
        });
  }

  public void close() throws Exception {
    comparisons.close();
    jobs.close();
    db.close();
    store.close();
  }
}
