package io.datasync;

import static io.datasync.Model.*;

import java.math.BigDecimal;
import java.util.*;

public final class Sql {
  public static String comment(String text) {
    return text.replace('\r', ' ').replace('\n', ' ');
  }

  public static String quote(String s) {
    return "'" + s.replace("\\", "\\\\").replace("'", "''") + "'";
  }

  public static String header() {
    return "SET NAMES utf8mb4;\n"
        + "SET SESSION sql_mode = TRIM(BOTH ',' FROM REPLACE(CONCAT(',',@@sql_mode,','),"
        + " ',NO_BACKSLASH_ESCAPES,', ','));\n";
  }

  public static String id(String s) {
    if (s == null || s.isBlank() || s.indexOf('\0') >= 0)
      throw new IllegalArgumentException("对象名不能为空或包含空字符");
    return "`" + s.replace("`", "``") + "`";
  }

  public static String qualified(DbRef r, String table) {
    return id(r.database()) + "." + id(table);
  }

  // Hex UTF-8 literals remain correct with either NO_BACKSLASH_ESCAPES setting.
  public static String value(Object v) {
    if (v == null) return "NULL";
    if (v instanceof Map<?, ?> m && m.containsKey("$binary")) return "X'" + m.get("$binary") + "'";
    if (v instanceof Number n) return new BigDecimal(n.toString()).toPlainString();
    if (v instanceof Boolean b) return b ? "1" : "0";
    return "CONVERT(X'"
        + HexFormat.of().formatHex(v.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8))
        + "' USING utf8mb4) COLLATE utf8mb4_bin";
  }

  public static String where(Map<String, Object> row, List<String> fields) {
    return fields.stream()
        .map(k -> id(k) + " <=> " + value(row.get(k)))
        .collect(java.util.stream.Collectors.joining(" AND "));
  }

  public static List<String> splitDefinitions(String ddl) {
    int start = ddl.indexOf('('), depth = 0;
    char quote = 0;
    boolean escaped = false;
    var out = new ArrayList<String>();
    int mark = start + 1;
    for (int i = start + 1; i < ddl.length(); i++) {
      char c = ddl.charAt(i);
      if (quote != 0) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (c == '\\' && quote != '`') {
          escaped = true;
          continue;
        }
        if (c == quote) {
          if (i + 1 < ddl.length() && ddl.charAt(i + 1) == quote) {
            i++;
            continue;
          }
          quote = 0;
        }
        continue;
      }
      if (c == '\'' || c == '"' || c == '`') {
        quote = c;
        continue;
      }
      if (c == '(') depth++;
      if (c == ')') {
        if (depth == 0) {
          out.add(ddl.substring(mark, i).trim());
          break;
        }
        depth--;
      }
      if (c == ',' && depth == 0) {
        out.add(ddl.substring(mark, i).trim());
        mark = i + 1;
      }
    }
    return out;
  }

  public static String createFor(Table t, DbRef r, String name) {
    return t.createSql.replaceFirst(
        "(?i)^CREATE TABLE\\s+`(?:``|[^`])+`",
        java.util.regex.Matcher.quoteReplacement("CREATE TABLE " + qualified(r, name)));
  }

  public static String withoutForeignKeys(String ddl) {
    var definitions = splitDefinitions(ddl);
    String all =
        String.join(",\n  ", definitions.stream().filter(s -> !s.contains("FOREIGN KEY")).toList());
    int start = ddl.indexOf('(');
    int end = ddl.lastIndexOf(") ENGINE=");
    if (end < 0) throw new IllegalArgumentException("无法解析建表语句");
    return ddl.substring(0, start + 1) + "\n  " + all + "\n" + ddl.substring(end);
  }

  public static String normalized(String ddl) {
    return ddl.replaceAll("(?i)AUTO_INCREMENT=\\d+\\s*", "")
        .replaceAll("(?i)\\b(tinyint|smallint|mediumint|int|bigint)\\(\\d+\\)", "$1")
        .strip();
  }

  public static String columnSignature(Column c) {
    return Json.hash(
        Arrays.asList(
            c.name(),
            normalized(c.type()),
            c.nullable(),
            c.defaultValue(),
            c.extra().replace("DEFAULT_GENERATED", "").strip(),
            c.comment(),
            c.generation(),
            c.collation()));
  }

  /** Locate COMMENT outside quoted identifiers, literals and type/default expressions. */
  public static String withColumnComment(String definition, String comment) {
    char quote = 0;
    int depth = 0, start = -1, end = -1;
    for (int i = 0; i < definition.length(); i++) {
      char ch = definition.charAt(i);
      if (quote != 0) {
        if (ch == '\\' && quote != '`') {
          i++;
          continue;
        }
        if (ch == quote) {
          if (i + 1 < definition.length() && definition.charAt(i + 1) == quote) i++;
          else quote = 0;
        }
        continue;
      }
      if (ch == '\'' || ch == '"' || ch == '`') {
        quote = ch;
        continue;
      }
      if (ch == '(') depth++;
      if (ch == ')') depth--;
      if (depth == 0
          && definition.regionMatches(true, i, "COMMENT", 0, 7)
          && (i == 0 || Character.isWhitespace(definition.charAt(i - 1)))
          && i + 7 < definition.length()
          && Character.isWhitespace(definition.charAt(i + 7))) {
        start = i;
        int j = i + 7;
        while (j < definition.length() && Character.isWhitespace(definition.charAt(j))) j++;
        if (j == definition.length()
            || (definition.charAt(j) != '\'' && definition.charAt(j) != '"'))
          throw new IllegalArgumentException("无法解析字段注释");
        char literal = definition.charAt(j++);
        boolean closed = false;
        while (j < definition.length()) {
          char c = definition.charAt(j++);
          if (c == '\\') {
            j++;
            continue;
          }
          if (c == literal) {
            if (j < definition.length() && definition.charAt(j) == literal) {
              j++;
              continue;
            }
            closed = true;
            break;
          }
        }
        if (!closed) throw new IllegalArgumentException("无法解析字段注释");
        end = j;
        break;
      }
    }
    String base =
        start < 0
            ? definition
            : definition.substring(0, start).stripTrailing()
                + " "
                + definition.substring(end).stripLeading();
    return base.strip()
        + (comment == null || comment.isEmpty() ? "" : " COMMENT " + quote(comment));
  }

  public static Column columnWithComment(Column base, String comment, int ordinal) {
    return new Column(
        base.name(),
        base.type(),
        base.nullable(),
        base.defaultValue(),
        base.extra(),
        comment,
        ordinal,
        withColumnComment(base.definition(), comment),
        base.generation(),
        base.collation());
  }

  public static String schemaHash(Table t) {
    return t.exists
        ? Json.hash(
            Arrays.asList(
                t.name,
                t.engine,
                t.collation,
                t.comment,
                t.columns.stream().map(Sql::columnSignature).toList(),
                t.indexes,
                t.foreignKeys,
                normalized(t.createSql.substring(t.createSql.lastIndexOf(") ENGINE=")))))
        : "MISSING";
  }
}
