package io.datasync;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;

/** Global connection organization, independent of credentials and workspace membership. */
final class ConnectionGroups {
  private final Store store;

  ConnectionGroups(Store store) { this.store = store; }

  List<JsonNode> groups() throws Exception {
    return sorted(store.list("connectionGroup"));
  }

  private List<JsonNode> sorted(List<JsonNode> values) {
    var result = new ArrayList<>(values);
    result.sort(Comparator.comparingInt(value -> value.path("sortOrder").asInt(Integer.MAX_VALUE)));
    return result;
  }

  private String name(JsonNode connection) {
    String name = connection.path("group").asText().trim();
    return name.isEmpty() ? "数据库连接" : name;
  }

  private JsonNode ensure(String name) throws Exception {
    for (var group : groups()) if (group.path("name").asText().equals(name)) return group;
    return save("", name);
  }

  void migrate() throws Exception {
    store.transaction(() -> {
      for (var connection : store.list("connection")) ensure(name(connection));
      for (var group : groups()) {
        var members = members(group.path("name").asText());
        for (int i = 0; i < members.size(); i++) {
          var copy = (ObjectNode) members.get(i).deepCopy();
          if (!copy.path("sortOrder").isIntegralNumber() || !copy.path("group").asText().equals(name(copy))) {
            copy.put("group", name(copy));
            copy.put("sortOrder", i);
            store.put("connection", copy.path("id").asText(), copy);
          }
        }
      }
      return null;
    });
  }

  JsonNode save(String id, String input) throws Exception {
    String name = input.trim();
    if (name.isEmpty()) throw new IllegalArgumentException("分组名称不能为空");
    return store.transaction(() -> {
      var old = id.isBlank() ? null : store.get("connectionGroup", id);
      if (!id.isBlank() && old == null) throw new IllegalArgumentException("分组不存在");
      for (var group : groups())
        if (group.path("name").asText().equals(name) && !group.path("id").asText().equals(id))
          throw new IllegalArgumentException("分组名称已存在");
      String key = id.isBlank() ? UUID.randomUUID().toString() : id;
      int order = old == null ? groups().stream().mapToInt(g -> g.path("sortOrder").asInt()).max().orElse(-1) + 1 : old.path("sortOrder").asInt();
      if (old != null && !old.path("name").asText().equals(name)) {
        for (var connection : members(old.path("name").asText())) {
          var copy = (ObjectNode) connection.deepCopy();
          copy.put("group", name);
          store.put("connection", copy.path("id").asText(), copy);
        }
      }
      return store.put("connectionGroup", key, Map.of("id", key, "name", name, "sortOrder", order));
    });
  }

  private List<JsonNode> members(String group) throws Exception {
    return sorted(store.list("connection").stream().filter(c -> name(c).equals(group)).toList());
  }

  JsonNode saveConnection(ObjectNode connection) throws Exception {
    return store.transaction(() -> {
      String id = connection.path("id").asText();
      var old = store.get("connection", id);
      String group = name(connection);
      ensure(group);
      connection.put("group", group);
      int order;
      if (old != null && name(old).equals(group)) order = old.path("sortOrder").asInt();
      else if (old == null && connection.path("sortOrder").isIntegralNumber() && connection.path("sortOrder").asInt() >= 0)
        order = connection.path("sortOrder").asInt();
      else order = members(group).stream().mapToInt(c -> c.path("sortOrder").asInt()).max().orElse(-1) + 1;
      connection.put("sortOrder", order);
      return store.put("connection", id, connection);
    });
  }

  Object move(JsonNode request) throws Exception {
    return store.transaction(() -> {
      String id = request.path("connectionId").asText();
      var connection = store.get("connection", id);
      var group = store.get("connectionGroup", request.path("groupId").asText());
      if (connection == null || group == null) throw new IllegalArgumentException("连接或分组不存在");
      String placement = request.path("placement").asText();
      if (!List.of("before", "after", "last").contains(placement)) throw new IllegalArgumentException("无效投放位置");
      String destination = group.path("name").asText();
      var list = new ArrayList<>(members(destination).stream().filter(c -> !c.path("id").asText().equals(id)).toList());
      int index = list.size();
      if (!placement.equals("last")) {
        String anchor = request.path("anchorConnectionId").asText();
        index = -1;
        for (int i = 0; i < list.size(); i++) if (list.get(i).path("id").asText().equals(anchor)) index = i;
        if (index < 0) throw new IllegalArgumentException("目标连接不存在于该分组");
        if (placement.equals("after")) index++;
      }
      var copy = (ObjectNode) connection.deepCopy();
      copy.put("group", destination);
      list.add(index, copy);
      if (!name(connection).equals(destination))
        writeOrder(members(name(connection)).stream().filter(c -> !c.path("id").asText().equals(id)).toList());
      writeOrder(list);
      return Map.of("ok", true);
    });
  }

  private void writeOrder(List<JsonNode> connections) throws Exception {
    for (int i = 0; i < connections.size(); i++) {
      var copy = (ObjectNode) connections.get(i).deepCopy();
      copy.put("sortOrder", i);
      store.put("connection", copy.path("id").asText(), copy);
    }
  }

  void importGroups(JsonNode values) throws Exception {
    // Names are the existing connection wire identity; foreign IDs must not overwrite local groups.
    for (var group : sorted(nodeList(values)))
      ensure(group.path("name").asText().trim());
  }

  private List<JsonNode> nodeList(JsonNode values) {
    var result = new ArrayList<JsonNode>();
    if (values.isArray()) values.forEach(result::add);
    return result;
  }
}
