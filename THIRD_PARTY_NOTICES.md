# Third-party notices

DBAligner source code is licensed under Apache-2.0. Third-party components retain their own licenses. The installed application includes this notice, `licenses/`, Java's `runtime/legal/`, and unmodified JAR files under `engine/lib/`. Electron's Chromium notices are included in the application directory.

| Component                                  | License                                              | Upstream                                                   |
| ------------------------------------------ | ---------------------------------------------------- | ---------------------------------------------------------- |
| Electron                                   | MIT; Chromium third-party notices apply              | https://github.com/electron/electron                       |
| electron-updater                           | MIT                                                  | https://github.com/electron-userland/electron-builder      |
| React / React DOM                          | MIT                                                  | https://github.com/facebook/react                          |
| Ant Design and icons                       | MIT                                                  | https://github.com/ant-design/ant-design                   |
| Spring Boot / Spring Framework             | Apache-2.0                                           | https://github.com/spring-projects/spring-boot             |
| Jackson                                    | Apache-2.0                                           | https://github.com/FasterXML/jackson                       |
| SLF4J                                      | MIT                                                  | https://github.com/qos-ch/slf4j                            |
| Logback 1.5.38                             | EPL-2.0 or LGPL-2.1-only                             | https://github.com/qos-ch/logback                          |
| SQLite JDBC                                | Apache-2.0; SQLite is public domain                  | https://github.com/xerial/sqlite-jdbc                      |
| PostgreSQL JDBC 42.7.8 (optional download) | BSD-2-Clause                                         | https://github.com/pgjdbc/pgjdbc                           |
| MariaDB Connector/J                        | LGPL-2.1-or-later                                    | https://github.com/mariadb-corporation/mariadb-connector-j |
| Eclipse Temurin / OpenJDK runtime          | GPL-2.0 with Classpath Exception and bundled notices | https://adoptium.net/                                      |
| JSpecify                                   | Apache-2.0                                           | https://github.com/jspecify/jspecify                       |
| SnakeYAML                                  | Apache-2.0                                           | https://bitbucket.org/snakeyaml/snakeyaml                  |
| Micrometer                                 | Apache-2.0                                           | https://github.com/micrometer-metrics/micrometer           |
| Apache Commons Logging / Log4j             | Apache-2.0                                           | https://logging.apache.org/                                |
| Jakarta Annotations                        | EPL-2.0 or GPL-2.0 with Classpath Exception          | https://github.com/jakartaee/common-annotations-api        |

MariaDB Connector/J is distributed as a separate, unmodified `mariadb-java-client-3.5.10.jar` and loaded from the external Java class path. You may replace it with a compatible modified driver JAR. The distribution includes the matching source JAR and LGPL license text in `licenses/mariadb/`. DBAligner does not prohibit reverse engineering for debugging modifications to this LGPL component. Neither MariaDB nor MySQL server software is shipped with DBAligner; the optional integration test script downloads server software solely into the ignored developer `.tools` directory.

PostgreSQL JDBC 42.7.8 is an optional, unmodified driver downloaded only when requested. Its pinned artifact SHA-256 and source URL are recorded in the bundled driver catalogue; its license is included in `licenses/postgresql/LICENSE`. PostgreSQL server binaries are not distributed with the application. Isolated integration-test binaries remain in the ignored `.tools/postgresql-test` directory.

OpenJDK corresponding source for the exact bundled Temurin build is linked in `licenses/runtime-source.json`; the runtime's original legal notices are retained. Generated dependency inventory and upstream license texts are in `licenses/`. Build tooling such as TypeScript, Vite, Maven, JUnit and NSIS has separate licenses and is not part of the DBAligner source license.

No upstream authors endorse DBAligner. Preserve the notices when redistributing releases and regenerate the dependency inventory when upgrading dependencies.
