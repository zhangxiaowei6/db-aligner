package io.datasync;

import static io.datasync.Model.*;
import static org.junit.jupiter.api.Assertions.*;

import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.Test;

class ComparisonTest {
  static Column column(String name, String type, String comment, int ordinal) {
    return new Column(
        name,
        type,
        true,
        "COMMENT literal",
        "",
        comment,
        ordinal,
        Sql.id(name) + " " + type + " DEFAULT 'COMMENT literal' COMMENT " + Sql.quote(comment),
        "",
        null);
  }

  static Table table(Column... columns) {
    var t = new Table();
    t.name = "dict";
    t.engine = "InnoDB";
    t.charset = "utf8mb4";
    t.collation = "utf8mb4_general_ci";
    t.comment = "";
    t.createSql = "CREATE TABLE `dict` (id int) ENGINE=InnoDB";
    t.columns.addAll(List.of(columns));
    return t;
  }

  static TargetPlan target() {
    var t = new TargetPlan();
    t.ref = new DbRef("test", "target");
    t.serverVersion = "8.4.8";
    return t;
  }

  static StructureOptions onlyComments() {
    return new StructureOptions(false, false, false, true, false, false, false);
  }

  @Test
  void commentsPreserveTargetTypeDefaultOrderAndWorkWithoutPrimaryKey() throws Exception {
    var source = table(column("value", "varchar(100)", "源'\\ COMMENT", 1));
    var old = column("value", "varchar(20)", "旧", 2);
    var before = table(column("id", "int", "", 1), old);
    var target = target();
    new Planner(new Database(null)).structure(target, source, before, onlyComments());
    var change = target.changes.getFirst();
    assertTrue(change.commentOnly());
    assertTrue(change.selected);
    assertFalse(change.blocked);
    assertFalse(change.risk);
    assertTrue(change.sql.contains("varchar(20)"));
    assertTrue(change.sql.contains("DEFAULT 'COMMENT literal'"));
    assertFalse(change.sql.contains(" FIRST"));
    assertFalse(change.sql.contains(" AFTER"));
    var planned = Json.MAPPER.treeToValue(Json.node(change.after.get("column")), Column.class);
    assertEquals(old.type(), planned.type());
    assertEquals(old.ordinal(), planned.ordinal());
    assertEquals(source.columns.getFirst().comment(), planned.comment());
    assertTrue(External.matchesColumn(change, table(planned), source));
    assertFalse(External.matchesColumn(change, source, source));
    assertEquals(1, new Archives(null).inverse(new SyncRecord(), target, change).size());
  }

  @Test
  void commentParserHandlesQuotedKeywordEscapesAndSuffixes() {
    String def =
        "`COMMENT` varchar(30) DEFAULT 'a COMMENT ''b' COMMENT 'old\\\' text' COLUMN_FORMAT FIXED";
    String changed = Sql.withColumnComment(def, "new'\\value");
    assertEquals(
        "`COMMENT` varchar(30) DEFAULT 'a COMMENT ''b' COLUMN_FORMAT FIXED COMMENT"
            + " 'new''\\\\value'",
        changed);
    assertEquals(
        "`x` varchar(20) DEFAULT 'COMMENT \\\'xx'",
        Sql.withColumnComment("`x` varchar(20) DEFAULT 'COMMENT \\\'xx' COMMENT ''", ""));
  }

  @Test
  void columnDefinitionsKeepUnselectedCommentsAndAppendNewColumns() throws Exception {
    var source = table(column("value", "varchar(100)", "源", 1), column("new", "int", "新增注释", 2));
    var before = table(column("id", "int", "", 1), column("value", "varchar(20)", "旧", 2));
    var target = target();
    new Planner(new Database(null))
        .structure(
            target,
            source,
            before,
            new StructureOptions(true, false, false, false, false, false, false));
    var modify =
        target.changes.stream()
            .filter(c -> c.kind.equals("MODIFY_COLUMN"))
            .findFirst()
            .orElseThrow();
    assertTrue(modify.sql.contains("varchar(100)"));
    assertTrue(modify.sql.contains("COMMENT '旧'"));
    assertFalse(modify.sql.contains("FIRST"));
    var add =
        target.changes.stream().filter(c -> c.kind.equals("ADD_COLUMN")).findFirst().orElseThrow();
    assertFalse(add.sql.contains("新增注释"));
    assertFalse(add.sql.contains(" AFTER"));
    assertNotNull(add.after.get("column"));
  }

  @Test
  void partialStructureBlocksMissingTableAndIndexDependencies() {
    var source = table(column("missing", "int", "", 1));
    source.indexes.add(new Index("ix", false, "BTREE", List.of("missing"), "KEY `ix` (`missing`)"));
    var before = table();
    before.exists = false;
    var target = target();
    var planner = new Planner(new Database(null));
    planner.structure(target, source, before, onlyComments());
    assertTrue(target.changes.stream().allMatch(c -> c.blocked));
    before.exists = true;
    target.changes.clear();
    planner.structure(
        target,
        source,
        before,
        new StructureOptions(false, false, false, false, true, false, false));
    assertEquals("ADD_INDEX", target.changes.getFirst().kind);
    assertTrue(target.changes.getFirst().blocked);
  }

  @Test
  void eachIndependentFacetAndLegacyDefaults() throws Exception {
    assertTrue(new TableChoice("dict", true, false, List.of()).options().full());
    var source = table(column("a", "int", "new", 1), column("b", "int", "", 2));
    var before = table(column("b", "int", "", 1), column("a", "int", "old", 2));
    source.comment = "new table";
    source.collation = "utf8mb4_bin";
    source.indexes.add(new Index("ix", false, "BTREE", List.of("a"), "KEY `ix` (`a`)"));
    source.foreignKeys.add(
        new ForeignKey(
            "fk", "CONSTRAINT `fk` FOREIGN KEY (`a`) REFERENCES `parent` (`id`)", "parent"));
    var planner = new Planner(new Database(null));
    for (int i = 0; i < 7; i++) {
      var options = new StructureOptions(i == 0, i == 1, i == 2, i == 3, i == 4, i == 5, i == 6);
      var target = target();
      planner.structure(target, source, before, options);
      Set<String> kinds = new HashSet<>(target.changes.stream().map(c -> c.kind).toList());
      assertEquals(
          i == 0
              ? Set.of()
              : Set.of(
                  i == 1 || i == 3
                      ? "MODIFY_COLUMN"
                      : i == 2
                          ? "TABLE_COMMENT"
                          : i == 4 ? "ADD_INDEX" : i == 5 ? "ADD_FK" : "TABLE_COLLATION"),
          kinds);
    }
  }

  @Test
  void acceptedCancellationDiscardsResultsAndPreventsConcurrentStart() throws Exception {
    var entered = new CountDownLatch(1);
    var release = new CountDownLatch(1);
    var saves = new AtomicInteger();
    try (var tasks = new Comparisons(e -> {}, p -> saves.incrementAndGet())) {
      String id =
          tasks
              .start(
                  () -> {
                    entered.countDown();
                    release.await();
                    return new SyncPlan();
                  })
              .get("compareId")
              .toString();
      assertTrue(entered.await(2, TimeUnit.SECONDS));
      assertThrows(IllegalArgumentException.class, () -> tasks.start(SyncPlan::new));
      assertEquals("CANCELLING", tasks.cancel(id).get("status"));
      tasks.cancel(id);
      release.countDown();
      awaitTerminal(tasks, id);
      assertEquals("CANCELLED", tasks.get(id).get("status"));
      assertFalse(tasks.get(id).containsKey("plan"));
      assertEquals(0, saves.get());
      String next = tasks.start(SyncPlan::new).get("compareId").toString();
      awaitTerminal(tasks, next);
      assertEquals("COMPLETED", tasks.cancel(next).get("status"));
      assertEquals(1, saves.get());
    } finally {
      release.countDown();
    }
  }

  @Test
  void failureAndProgressAreReportedWithoutSaving() throws Exception {
    var events = new CopyOnWriteArrayList<Object>();
    try (var tasks = new Comparisons(events::add, p -> fail("Failed plans cannot be saved"))) {
      String id =
          tasks
              .start(
                  () -> {
                    var ctx = ComparisonContext.CURRENT.get();
                    ctx.total(1);
                    ctx.stage(new DbRef("c", "db"), "t", "读取数据");
                    ComparisonContext.rows(5);
                    throw new IllegalArgumentException("expected");
                  })
              .get("compareId")
              .toString();
      awaitTerminal(tasks, id);
      assertEquals("FAILED", tasks.get(id).get("status"));
      assertEquals("expected", tasks.get(id).get("error"));
      assertFalse(events.isEmpty());
    }
  }

  static void awaitTerminal(Comparisons tasks, String id) throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
    while (List.of("RUNNING", "CANCELLING").contains(tasks.get(id).get("status"))
        && System.nanoTime() < deadline) Thread.sleep(10);
    assertFalse(List.of("RUNNING", "CANCELLING").contains(tasks.get(id).get("status")));
  }
}
