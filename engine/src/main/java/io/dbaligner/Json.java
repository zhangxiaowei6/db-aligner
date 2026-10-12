package io.dbaligner;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.*;
import java.math.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

public final class Json {
  public static final ObjectMapper MAPPER =
      new ObjectMapper()
          .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
          .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);

  public static String write(Object o) {
    try {
      return MAPPER.writeValueAsString(o);
    } catch (Exception e) {
      throw new IllegalArgumentException("Cannot serialize data", e);
    }
  }

  public static <T> T read(String s, Class<T> t) {
    try {
      return MAPPER.readValue(s, t);
    } catch (Exception e) {
      throw new IllegalArgumentException("Invalid JSON", e);
    }
  }

  public static JsonNode node(Object o) {
    return MAPPER.valueToTree(o);
  }

  /** Presentation only: retain exact database values across JavaScript's number boundary. */
  public static JsonNode presentation(Object value) {
    return present(node(value));
  }

  private static JsonNode present(JsonNode n) {
    if (n.isObject()) {
      var out = MAPPER.createObjectNode();
      n.fields().forEachRemaining(e -> out.set(e.getKey(), present(e.getValue())));
      return out;
    }
    if (n.isArray()) {
      var out = MAPPER.createArrayNode();
      n.forEach(value -> out.add(present(value)));
      return out;
    }
    if (n.isFloatingPointNumber())
      return MAPPER.getNodeFactory().textNode(n.decimalValue().toPlainString());
    if (n.isIntegralNumber()
        && n.bigIntegerValue().abs().compareTo(new BigInteger("9007199254740991")) > 0)
      return MAPPER.getNodeFactory().textNode(n.asText());
    return n;
  }

  public static String text(JsonNode n, String k, String d) {
    return n.path(k).asText(d);
  }

  public static String hash(Object o) {
    try {
      return HexFormat.of()
          .formatHex(
              MessageDigest.getInstance("SHA-256")
                  .digest(write(canonical(o)).getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private static Object canonical(Object o) {
    if (o instanceof JsonNode n) return canonical(MAPPER.convertValue(n, Object.class));
    if (o instanceof Map<?, ?> m) {
      var r = new TreeMap<String, Object>();
      m.forEach((k, v) -> r.put(k.toString(), canonical(v)));
      return r;
    }
    if (o instanceof List<?> l) return l.stream().map(Json::canonical).toList();
    if (o instanceof Number n)
      return new BigDecimal(n.toString()).stripTrailingZeros().toPlainString();
    return o;
  }

  public static List<String> strings(JsonNode n) {
    var r = new ArrayList<String>();
    if (n.isArray()) n.forEach(x -> r.add(x.asText()));
    return r;
  }

  public static Map<String, Object> map(JsonNode n) {
    return MAPPER.convertValue(n, new TypeReference<LinkedHashMap<String, Object>>() {});
  }
}
