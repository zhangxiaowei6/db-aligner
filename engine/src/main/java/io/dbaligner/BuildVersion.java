package io.dbaligner;

import java.util.Properties;

final class BuildVersion {
  static String get() {
    var properties = new Properties();
    try (var input = BuildVersion.class.getResourceAsStream("/build-version.properties")) {
      if (input == null) throw new IllegalStateException("缺少引擎构建版本");
      properties.load(input);
      return properties.getProperty("version");
    } catch (java.io.IOException e) {
      throw new IllegalStateException("无法读取引擎构建版本", e);
    }
  }
}
