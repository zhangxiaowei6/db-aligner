package io.dbaligner;

import static io.dbaligner.Model.*;

import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;

public final class PostgresSql {
  public static String id(String value) {
    if (value == null || value.isBlank() || value.indexOf('\0') >= 0)
      throw new IllegalArgumentException("对象名无效");
    return "\"" + value.replace("\"", "\"\"") + "\"";
  }

  public static String literal(String value) {
    if (value.indexOf('\0') >= 0) throw new IllegalArgumentException("PostgreSQL 文本不能包含空字符");
    return "'" + value.replace("'", "''") + "'";
  }

  public static String value(Object value) {
    if (value == null) return "NULL";
    if (value instanceof Map<?, ?> map && map.containsKey("$binary"))
      return "decode('" + map.get("$binary") + "','hex')";
    if (value instanceof Map<?, ?> map && map.containsKey("$pgType"))
      return literal(map.get("value").toString()) + "::" + map.get("$pgType");
    if (value instanceof Boolean flag) return flag ? "TRUE" : "FALSE";
    if (value instanceof Number number) return new BigDecimal(number.toString()).toPlainString();
    return literal(value.toString());
  }

  public static String where(Map<String, Object> row, List<String> fields) {
    return fields.stream()
        .map(field -> id(field) + " IS NOT DISTINCT FROM " + value(row.get(field)))
        .collect(Collectors.joining(" AND "));
  }

  public static String definition(Column column) {
    return id(column.name())
        + " "
        + column.type()
        + (column.collation() == null
                || column.collation().isEmpty()
                || column.collation().equals("default")
            ? ""
            : " COLLATE pg_catalog." + id(column.collation()))
        + (column.defaultValue() == null ? "" : " DEFAULT " + column.defaultValue())
        + (column.nullable() ? "" : " NOT NULL");
  }

  public static List<String> comment(DbRef ref, String table, Column column) {
    return List.of(
        "COMMENT ON COLUMN "
            + Sql.qualified(ref, table)
            + "."
            + id(column.name())
            + " IS "
            + literal(column.comment()));
  }

  private static String action(String code) {
    return switch (code) {
      case "a" -> "NO ACTION";
      case "r" -> "RESTRICT";
      case "c" -> "CASCADE";
      case "n" -> "SET NULL";
      case "d" -> "SET DEFAULT";
      default -> throw new IllegalArgumentException("不支持的外键规则");
    };
  }

  public static String foreignKey(
      String name, com.fasterxml.jackson.databind.JsonNode spec, String schema) {
    String match =
        switch (spec.path("match").asText()) {
          case "s" -> "SIMPLE";
          case "f" -> "FULL";
          default -> throw new IllegalArgumentException("不支持的外键匹配规则");
        };
    return "CONSTRAINT "
        + id(name)
        + " FOREIGN KEY ("
        + Json.strings(spec.path("columns")).stream()
            .map(PostgresSql::id)
            .collect(Collectors.joining(","))
        + ") REFERENCES "
        + id(schema)
        + "."
        + id(spec.path("referencedTable").asText())
        + " ("
        + Json.strings(spec.path("referencedColumns")).stream()
            .map(PostgresSql::id)
            .collect(Collectors.joining(","))
        + ") MATCH "
        + match
        + " ON UPDATE "
        + action(spec.path("update").asText())
        + " ON DELETE "
        + action(spec.path("delete").asText())
        + (spec.path("deferrable").asBoolean()
            ? " DEFERRABLE INITIALLY "
                + (spec.path("deferred").asBoolean() ? "DEFERRED" : "IMMEDIATE")
            : " NOT DEFERRABLE");
  }

  public static String create(Table table, DbRef ref) {
    var definitions = new ArrayList<>(table.columns.stream().map(PostgresSql::definition).toList());
    if (!table.primaryKey().isEmpty())
      definitions.add(
          "PRIMARY KEY ("
              + table.primaryKey().stream().map(PostgresSql::id).collect(Collectors.joining(","))
              + ")");
    return "CREATE TABLE "
        + Sql.qualified(ref, table.name)
        + " (\n  "
        + String.join(",\n  ", definitions)
        + "\n)";
  }
}
