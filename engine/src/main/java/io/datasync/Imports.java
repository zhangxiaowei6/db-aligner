package io.datasync;

import com.fasterxml.jackson.databind.JsonNode;
import java.io.StringReader;
import java.util.*;
import javax.xml.parsers.*;
import org.w3c.dom.*;
import org.xml.sax.InputSource;

public final class Imports {
  public static List<Map<String, Object>> parse(String format, String content) throws Exception {
    if (content.length() > 5_000_000) throw new IllegalArgumentException("导入文件超过 5 MB");
    var out = new ArrayList<Map<String, Object>>();
    if (format.equals("dbeaver")) {
      JsonNode root = Json.read(content, JsonNode.class);
      var entries = root.path("connections");
      if (!entries.isObject()) throw new IllegalArgumentException("缺少 DBeaver connections 节点");
      entries
          .fields()
          .forEachRemaining(
              e -> {
                var n = e.getValue();
                var cfg = n.path("configuration");
                String driver = n.path("driver").asText() + " " + n.path("provider").asText();
                if (!driver.toLowerCase().contains("mysql")
                    && !driver.toLowerCase().contains("maria")) return;
                out.add(
                    connection(
                        n.path("name").asText(e.getKey()),
                        cfg.path("host").asText("localhost"),
                        cfg.path("port").asInt(3306),
                        cfg.path("user").asText(),
                        cfg.path("database").asText(),
                        cfg.path("password").asText(),
                        n.path("folder").asText("导入连接")));
              });
    } else {
      var f = DocumentBuilderFactory.newInstance();
      f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      f.setFeature("http://xml.org/sax/features/external-general-entities", false);
      f.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
      f.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_DTD, "");
      f.setAttribute(javax.xml.XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
      var builder = f.newDocumentBuilder();
      builder.setErrorHandler(
          new org.xml.sax.helpers.DefaultHandler() {
            @Override
            public void fatalError(org.xml.sax.SAXParseException e)
                throws org.xml.sax.SAXException {
              throw e;
            }
          });
      var doc = builder.parse(new InputSource(new StringReader(content)));
      if (format.equals("navicat")) {
        var list = doc.getElementsByTagName("Connection");
        if (list.getLength() == 0) list = doc.getElementsByTagName("connection");
        for (int i = 0; i < list.getLength(); i++) {
          var e = (Element) list.item(i);
          String type = attr(e, "ConnType", "type");
          if (!type.isBlank()
              && !type.equals("0")
              && !type.toLowerCase().contains("mysql")
              && !type.toLowerCase().contains("maria")) continue;
          var c =
              connection(
                  attr(e, "ConnectionName", "name"),
                  attr(e, "Host", "host"),
                  port(attr(e, "Port", "port")),
                  attr(e, "UserName", "user"),
                  attr(e, "Database", "database"),
                  "",
                  attr(e, "Group", "group"));
          c.put("credentialStatus", "Navicat 密码需重新填写");
          if (List.of("1", "true").contains(attr(e, "UseSSH", "SSH").toLowerCase()))
            c.put("warning", "SSH 隧道暂不支持，请改为直连");
          out.add(c);
        }
      } else if (format.equals("datagrip")) {
        var list = doc.getElementsByTagName("data-source");
        for (int i = 0; i < list.getLength(); i++) {
          var e = (Element) list.item(i);
          String url = child(e, "jdbc-url");
          var m =
              java.util.regex.Pattern.compile(
                      "jdbc:(?:mysql|mariadb)://(\\[[^]]+]|[^:/?]+)(?::(\\d+))?/([^?;]*).*")
                  .matcher(url);
          if (!m.matches()) continue;
          out.add(
              connection(
                  e.getAttribute("name"),
                  m.group(1),
                  port(m.group(2)),
                  child(e, "user-name"),
                  m.group(3),
                  "",
                  "导入连接"));
        }
      } else throw new IllegalArgumentException("不支持的会话格式");
    }
    if (out.isEmpty()) throw new IllegalArgumentException("未找到可导入的 MySQL 连接，请检查格式与数据库类型");
    return out;
  }

  private static Map<String, Object> connection(
      String name,
      String host,
      int port,
      String user,
      String database,
      String password,
      String group) {
    var m = new LinkedHashMap<String, Object>();
    m.put("id", UUID.randomUUID().toString());
    m.put("name", name.isBlank() ? host : name);
    m.put("host", host.isBlank() ? "localhost" : host);
    m.put("port", port);
    m.put("user", user);
    m.put("databases", database.isBlank() ? List.of() : List.of(database));
    m.put("group", group.isBlank() ? "导入连接" : group);
    m.put("workspaceIds", List.of());
    m.put("ssl", false);
    m.put("ca", "");
    m.put("clientCert", "");
    m.put("password", password);
    m.put("credentialStatus", password.isBlank() ? "需填写密码" : "可导入密码");
    return m;
  }

  private static String attr(Element e, String... names) {
    for (String n : names) if (e.hasAttribute(n)) return e.getAttribute(n);
    return "";
  }

  private static String child(Element e, String name) {
    var a = e.getElementsByTagName(name);
    return a.getLength() == 0 ? "" : a.item(0).getTextContent();
  }

  private static int port(String s) {
    try {
      return s == null || s.isBlank() ? 3306 : Integer.parseInt(s);
    } catch (Exception e) {
      throw new IllegalArgumentException("会话中包含无效端口");
    }
  }
}
