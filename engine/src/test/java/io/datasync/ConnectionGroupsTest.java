package io.datasync;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.JsonNode;
import java.nio.file.Path;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ConnectionGroupsTest {
  @TempDir Path root;

  private Map<String, Object> connection(String id, String group) {
    return new LinkedHashMap<>(
        Map.of(
            "id",
            id,
            "name",
            id,
            "host",
            "localhost",
            "port",
            3306,
            "user",
            "tester",
            "group",
            group,
            "workspaceIds",
            List.of("default", "second"),
            "hasPassword",
            true));
  }

  private List<String> order(Store store, String group) throws Exception {
    return store.list("connection").stream()
        .filter(c -> c.path("group").asText().equals(group))
        .sorted(Comparator.comparingInt(c -> c.path("sortOrder").asInt()))
        .map(c -> c.path("id").asText())
        .toList();
  }

  @Test
  void migratesLegacyOrderAndPersistsEmptyGroupsAndMoves() throws Exception {
    String emptyId;
    try (var store = new Store(root)) {
      store.put("connection", "a", connection("a", "旧分组"));
      store.put("connection", "b", connection("b", "旧分组"));
      store.put("connection", "c", connection("c", "旧分组"));
      var groups = new ConnectionGroups(store);
      groups.migrate();
      assertEquals(List.of("c", "b", "a"), order(store, "旧分组"));
      emptyId = groups.save("", "空分组").path("id").asText();
      String oldId =
          groups.groups().stream()
              .filter(g -> g.path("name").asText().equals("旧分组"))
              .findFirst()
              .orElseThrow()
              .path("id")
              .asText();
      groups.move(
          Json.node(
              Map.of(
                  "connectionId",
                  "a",
                  "groupId",
                  oldId,
                  "anchorConnectionId",
                  "c",
                  "placement",
                  "before")));
      assertEquals(List.of("a", "c", "b"), order(store, "旧分组"));
      groups.move(Json.node(Map.of("connectionId", "c", "groupId", emptyId, "placement", "last")));
      groups.save(oldId, "重命名");
      assertEquals(List.of("a", "b"), order(store, "重命名"));
      assertEquals(
          List.of("default", "second"),
          Json.strings(store.get("connection", "a").path("workspaceIds")));
      assertTrue(store.get("connection", "a").path("hasPassword").asBoolean());
      groups.migrate();
      assertEquals(List.of("a", "b"), order(store, "重命名"));
      assertThrows(IllegalArgumentException.class, () -> groups.save(oldId, "空分组"));
      assertThrows(IllegalArgumentException.class, () -> groups.save("", "  "));
      var before = Json.write(store.list("connection"));
      assertThrows(
          IllegalArgumentException.class,
          () ->
              groups.move(
                  Json.node(
                      Map.of(
                          "connectionId",
                          "a",
                          "groupId",
                          emptyId,
                          "anchorConnectionId",
                          "missing",
                          "placement",
                          "after"))));
      assertEquals(before, Json.write(store.list("connection")));
      assertThrows(
          Exception.class,
          () ->
              store.transaction(
                  () -> {
                    groups.save(oldId, "回滚名称");
                    throw new Exception("rollback");
                  }));
      assertEquals("重命名", store.get("connection", "a").path("group").asText());
    }
    try (var store = new Store(root)) {
      assertEquals(List.of("a", "b"), order(store, "重命名"));
      assertEquals(List.of("c"), order(store, "空分组"));
      assertNotNull(store.get("connectionGroup", emptyId));
    }
  }

  @Test
  void serviceExportsImportsOrganizationAndRejectsFractionalPorts() throws Exception {
    JsonNode exported;
    try (var service = new Service(root.resolve("source"), ignored -> {})) {
      for (String id : List.of("a", "b"))
        service.handle(
            "entity.save", Json.node(Map.of("kind", "connection", "value", connection(id, "分组"))));
      service.handle("connectionGroups.save", Json.node(Map.of("name", "空分组")));
      var state = Json.node(service.handle("state.load", Json.node(Map.of())));
      String groupId = state.path("connectionGroups").get(0).path("id").asText();
      String emptyId = state.path("connectionGroups").get(1).path("id").asText();
      service.handle(
          "connectionGroups.move",
          Json.node(Map.of("groupId", emptyId, "anchorGroupId", groupId, "placement", "before")));
      service.handle(
          "connections.move",
          Json.node(
              Map.of(
                  "connectionId",
                  "b",
                  "groupId",
                  groupId,
                  "anchorConnectionId",
                  "a",
                  "placement",
                  "before")));
      var invalid = connection("bad", "分组");
      invalid.put("port", 3306.5);
      assertThrows(
          IllegalArgumentException.class,
          () ->
              service.handle(
                  "entity.save", Json.node(Map.of("kind", "connection", "value", invalid))));
      exported = Json.node(service.handle("config.export", Json.node(Map.of())));
    }
    try (var service = new Service(root.resolve("destination"), ignored -> {})) {
      service.handle("config.import", Json.node(Map.of("content", Json.write(exported))));
      assertEquals(List.of("b", "a"), order(service.store, "分组"));
      assertEquals(2, service.store.list("connectionGroup").size());
      assertEquals(
          "空分组", new ConnectionGroups(service.store).groups().get(0).path("name").asText());
      service.handle("config.import", Json.node(Map.of("content", Json.write(exported))));
      assertEquals(2, service.store.list("connectionGroup").size());
      var legacy = connection("legacy", "旧配置");
      legacy.remove("hasPassword");
      service.handle(
          "config.import",
          Json.node(
              Map.of(
                  "content",
                  Json.write(
                      Map.of("format", "datasync-config-v1", "connections", List.of(legacy))))));
      assertTrue(service.store.get("connection", "legacy").has("sortOrder"));
    }
  }

  @Test
  void groupOrderPersistsAndRejectsInvalidMovesWithoutChangingConnections() throws Exception {
    try (var store = new Store(root)) {
      var groups = new ConnectionGroups(store);
      String a = groups.save("", "A").path("id").asText();
      String b = groups.save("", "B").path("id").asText();
      String c = groups.save("", "C").path("id").asText();
      store.put("connection", "member", connection("member", "B"));
      String members = Json.write(store.list("connection"));
      groups.moveGroup(Json.node(Map.of("groupId", c, "anchorGroupId", a, "placement", "before")));
      assertEquals(
          List.of("C", "A", "B"),
          groups.groups().stream().map(g -> g.path("name").asText()).toList());
      groups.moveGroup(Json.node(Map.of("groupId", c, "anchorGroupId", b, "placement", "after")));
      assertEquals(
          List.of("A", "B", "C"),
          groups.groups().stream().map(g -> g.path("name").asText()).toList());
      groups.moveGroup(Json.node(Map.of("groupId", b, "anchorGroupId", a, "placement", "before")));
      for (var params :
          List.of(
              Map.of("groupId", a, "anchorGroupId", a, "placement", "before"),
              Map.of("groupId", "missing", "anchorGroupId", a, "placement", "after"),
              Map.of("groupId", a, "anchorGroupId", "missing", "placement", "before"),
              Map.of("groupId", a, "anchorGroupId", b, "placement", "last"))) {
        assertThrows(IllegalArgumentException.class, () -> groups.moveGroup(Json.node(params)));
        assertEquals(
            List.of("B", "A", "C"),
            groups.groups().stream().map(g -> g.path("name").asText()).toList());
      }
      assertEquals(members, Json.write(store.list("connection")));
    }
    try (var store = new Store(root)) {
      var groups = new ConnectionGroups(store);
      groups.migrate();
      assertEquals(
          List.of("B", "A", "C"),
          groups.groups().stream().map(g -> g.path("name").asText()).toList());
    }
  }
}
