# 本地协议 v1

## 客户端更新

`updates.get`、`updates.check`、`updates.download`、`updates.install` 由 Rust 宿主处理，参数必须为空对象；沿用可信发送方验证，不接收更新 URL、文件路径、Token 或命令。前端使用限定命令／事件桥接，Java 不负责下载软件。

返回 `UpdateState`：`version` 为客户端实际版本，`enabled` 表示当前运行方式支持更新，`revision` 单调递增，`status` 为 `disabled | idle | checking | current | available | downloading | downloaded | installing | error`，另有 `message`、可选 `nextVersion` 和 `percent`。主进程通过 `{event: 'update-state', state}` 广播状态，前端忽略旧 revision 并在卸载时取消订阅。重复检查和下载复用同一 Promise。

只检查更高的正式版本；下载与安装均需用户操作，普通退出不安装。网络／下载／校验失败返回可重试状态，不泄露底层 URL、请求头或凭据。安装准备拒绝时保留已下载状态；安装器错误恢复引擎后重新检查。浏览器预览仅模拟版本和下载状态，安装入口明确拒绝。

内部 `engine.prepareUpdate` 原子尝试取得请求独占锁，处理中请求、异步比较／取消和同步／排队任务存在时拒绝；通过后返回 `{prepared: true}` 并拒绝后续业务请求。`engine.resumeUpdate` 返回 `{prepared: false}` 并恢复请求。这两个接口只由宿主内部调用，不能经渲染进程 invoke 转发。同步回滚、核验、备份等请求持有共享请求锁直至结束，不能与更新准备同时通过。

宿主先冻结业务请求并拒绝有未完成或超时结果不明的请求，再调用内部准备接口。确认通过后关闭引擎 stdin，等待正常退出，不使用强杀回退；失败则恢复引擎和请求入口，恢复失败保持冻结并提示重启。协议仍为 v1；`ping.version` 改为 Maven 生成的构建版本。

DBAligner 渲染进程通过 `desktop/src/tauri-bridge.ts` 使用受限桥接，宿主命令为 `dbaligner_invoke`、`dbaligner_window`，事件为 `dbaligner:event`。引擎启动入口为 `io.dbaligner.EngineMain`，资料目录由 `DB_ALIGNER_HOME` 指定。配置导出标识为 `dbaligner-config-v1`，脚本包标识为 `dbaligner-script-package-v1`；改名前的配置格式标识不再作为导入入口，请在本版本重新配置或导出。

所有消息为 UTF-8 单行 JSON，以换行分隔。不能在 stdout 输出日志。Java 启动发出 ready 事件；标准请求响应按 `id` 关联，长任务通过事件与记录详情追踪。

```json
{"id":"request-1","method":"tables.list","params":{"ref":{"connectionId":"connection-id","database":"shop_test"}}}
{"id":"request-1","result":[{"name":"sys_dict","comment":"系统字典"}]}
```

失败响应含 `error:{code,message}`，成功响应含 `result`。事件含 `event`，任务事件关联 recordId / target / changeId。具体字段以 `EngineMain.java` 与 `Model.java` 为准。协议输入仅来自受限 Rust 宿主；内部 `$secrets` 不能通过渲染查询取回。

面向界面的输出将超过 JavaScript 安全整数范围的 BIGINT 和浮点 / DECIMAL 数值转换为精确文本，小整数、端口、批次等仍为 JSON 数字。此转换仅用于通信展示，不改写原始计划、归档数值、比较摘要或实际 SQL。

| 接口                                                                                            | 用途                                                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `ping`, `state.load`                                                                            | 协议版本、实体及记录摘要                                                             |
| `entity.save`, `entity.delete`                                                                  | 工作区、连接、模板、设置                                                             |
| `connectionGroups.save`, `connectionGroups.delete`, `connectionGroups.move`, `connections.move` | 分组命名、删除空分组、同级分组排序和连接移动；本地配置事务保存                       |
| `connections.test`, `databases.list`, `tables.list`, `table.get`                                | 真实 JDBC 与元数据                                                                   |
| `imports.parse`                                                                                 | 三种会话格式；宿主截留密码后返回解析结果                                             |
| `sync.compare`                                                                                  | `workspaceId`, `source`, `targets`, `tables` → `SyncPlan`                            |
| `sync.compare.start`                                                                            | 同样的比较范围，可选客户端 UUID `compareId` → `{compareId}`；注册后后台执行          |
| `sync.compare.get`                                                                              | `compareId` → `{compareId,status,progress,error,plan?}`；仅完成时提供计划            |
| `sync.compare.cancel`                                                                           | `compareId` → `{compareId,status}`；重复取消幂等，停止当前查询与后续读取             |
| `sync.save`                                                                                     | `planId`, `selectedIds`, `mode`, `remark` → `SyncRecord`                             |
| `record.get`, `record.file`, `record.export`, `record.cancel`, `record.verify`                  | 详情、脚本、归档、取消与追加核验                                                     |
| `version.save`                                                                                  | 新建 / 追加版本，显式移动记录                                                        |
| `external.declare`, `external.verify`                                                           | 用户声明执行范围与独立恢复核验；新记录不使用 `backupCompleted`，旧记录继续校验该参数 |
| `rollback.preview`, `rollback.execute`                                                          | 可信执行项、冲突原因与关联恢复记录                                                   |
| `schema.export`                                                                                 | `source`, `tables`, `includeDrop` → SQL                                              |
| `backup.export`, `backup.prepareRestore`, `backup.finishRestore`                                | 备份与暂存恢复                                                                       |
| `config.export`, `config.import`, `archives.clear`                                              | 无凭据配置及资料清理                                                                 |

`SyncPlan` 保存源快照、目标原状态、目标连接绑定 `connectionIdentity`（不含密码）、变更 SQL / 逆向 SQL、匹配列、风险和阻止原因。`SyncRecord.mode` 为 `SAVE_ONLY`、`EXECUTE_AND_SAVE` 或关联 `ROLLBACK`；执行状态单独保存，不由版本号推断。新同步记录的可选 `recoveryFormat` 为 `LOCAL_V1`；旧记录缺省为空。`TargetResult.recoveryRows` 按表保存字段原值行，`recoveryDigests` 保存绑定原结构与行内容的摘要；存在表键且值为 `[]` 表示完整空表快照，缺键表示未采集。记录摘要排除大型 `recoveryRows`，详情按需返回。`RollbackPlan` 每项保存 eligible 和 reason；执行仍在锁内重新校验，不能只依赖预览。

新执行不在目标数据库创建备份、收据或快照对象。恢复资料先写入 SQLite 与按目标追加的 `recovery.json`，再执行有损变更，并生成 `05_rollback_local.sql`。`record.get` 和 `record.file` 沿用现有接口返回这些资料；前端按目标优先展示 05，回退到原始 `04_rollback.sql`。旧记录的 `backups`、`backupDigests` 保留兼容，旧外部记录仍要求 `backupCompleted` 并读取原收据与快照；新外部记录兼容接收该参数但不使用。外部核验的表级检查增加 `declaredIds` 与 `recoveryAvailable`，分别表达声明范围和恢复可用性，`valid` 只表示该声明范围的当前状态核验结果。

比较任务状态为 `RUNNING`、`CANCELLING`、`CANCELLED`、`COMPLETED`、`FAILED`。同一引擎只允许一个活动比较，清理完成后才释放活动名额；终态任务保留 10 分钟，成功计划沿用现有内存计划存储。`sync.compare` 保留原返回契约并复用后台比较流程。后台线程使用启动请求的凭据快照。取消一旦被接受，不再发布本次计划；完成先于取消发布时返回完成状态。

取消设置任务标志后异步调用本任务语句的 `cancel()` 和连接的 `abort()`，不终止整个引擎。跨线程语句取消依据 [JDBC Statement.cancel 说明](<https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/Statement.html#cancel()>)；当前 MariaDB Connector/J 3.5.10 的连接终止委托给驱动客户端，见 [Connection.abort 实现](https://raw.githubusercontent.com/mariadb-corporation/mariadb-connector-j/3.5.10/src/main/java/org/mariadb/jdbc/Connection.java)。当前驱动的实际效果由三个版本 MySQL 隔离取消测试验证。

`compare-progress` 事件带 `compareId` 和 `progress:{ref,table,phase,completed,total,rows}`，阶段和终态立即发送，行数更新最多每 200ms 一次；终态事件增加 `status,error`，不携带完整计划。`total` 为已选表数 ×（1 + 目标库数），表示源表读取和各目标表比较的处理单元，不代表行数或耗时比例。前端每秒查询状态兜底，只接收当前任务事件；控制接口通信超时为 15 秒，超时后请求取消并继续核验。取消确认前不会解锁范围。

`sync.compare` 与 `sync.compare.start` 沿用 `TableChoice.structure` / `data` 布尔字段，但新比较中所有已选表只能启用同一种类型：任一表同时启用两种或不同表混合两种都会拒绝比较。数据模式下目标缺表自动跳过，`TargetPlan.skippedTables` 保存该目标跳过的表名，不产生 `BLOCKED`、DDL 或 DML 变更；旧计划缺省该字段按空数组展示，原有执行、核验和恢复证据仍兼容读取。宿主允许方法与前端桥接保持同一契约，新增字段为响应资料。旧混合模板仍可读取，应用时用户选择单一类型再重新比较。

`TableChoice.structureOptions` 可选，包含全部七个布尔值：`columns`、`columnOrder`、`tableComment`、`columnComments`、`indexes`、`foreignKeys`、`tableCollation`。缺省或 null 兼容为全选；提供对象时缺少布尔项拒绝请求；开启结构但细项全空拒绝比较。`columns` 包含字段增删和定义，`tableCollation` 只控制表默认字符集/排序规则，普通/唯一索引不自动同步主键变更。部分结构不能创建缺失表，也不会自动补入未选字段依赖。

字段变更 `after.column` 保存实际计划定义，`MODIFY_COLUMN.changedParts` 标记所改的 `columns`、`columnOrder`、`columnComments`。只改注释保留目标其他属性，默认选中；字段定义或顺序仍受风险限制。新增字段在未选顺序时追加，未选字段注释时不带源注释。核验、界面与回滚依据实际计划定义，旧记录没有该字段时兼容使用源定义。

Rust 宿主另外提供原生选文件、选目录、导出路径、打开资料目录、复制和窗口操作。文件导入使用短期 token 保持内容在主进程；桥接只允许已定义的方法。所有界面参数在发送前转换为普通 JSON 对象，编辑草稿与已保存模型分别持有独立副本。

外观接口由 Rust 宿主处理，不进入 Java 引擎：`appearance.get` 返回 `{themeMode,resolvedTheme}`；`appearance.set` 接受 `themeMode: light | dark | system`，原子保存本机偏好并返回生效外观。系统外观变化发送 `{event: appearance-changed, appearance}`。窗口关闭发送 `window-close-request`；渲染进程检查任务并响应 `close-confirmed` 或 `close-cancelled`，重复请求只显示一次确认。`renderer-ready` 在关闭监听订阅后发送；渲染进程未就绪时使用原生关闭确认。

`connectionGroups.save` 接受可选 `id` 和必填 `name`，去除首尾空格并校验非空及重名；编辑时按原名称关联更新连接，新建追加到末尾，返回 `{id,name,sortOrder}`。`connectionGroups.move` 接受 `groupId`、`anchorGroupId`、`placement: before | after`，校验两个已存在且不同的同级分组，在一个 SQLite 事务中重排并保存连续 `sortOrder`，返回 `{ok:true}`；不改动连接、凭据或工作区关联。`connections.move` 接受 `connectionId`、目标 `groupId`、`placement: before | after | last`；前后插入还需 `anchorConnectionId`，锚点必须位于目标分组且不能是自身。分组内连接顺序及跨组移动均在事务中保存。`state.load` 的 `connectionGroups` 按 `sortOrder` 返回；客户端数据库选项复用分组和组内连接顺序。配置导出／导入继续兼容缺少排序字段的旧配置。

`connectionGroups.delete` 接受 `{groupId:string}`，成功返回 `{ok:true}`。空 ID、不存在的分组和非空分组拒绝删除。
引擎在同一 SQLite 事务中按现有名称归属规则检查所有工作区的连接、删除空分组并连续重排剩余 `sortOrder`。
不会删除或移动连接，不修改凭据、工作区关联与历史记录。默认名称“数据库连接”也遵循空分组规则；
后续保存连接仍按既有逻辑自动创建缺失分组。前端沿用 `invoke` 语义，Rust 宿主将该方法列入允许清单。

## 多数据库与按需驱动

连接配置新增可选 `databaseType: mysql | postgresql`、`driverId`、`driverVersion` 与
`initialDatabase`。历史连接缺省为 MySQL；PostgreSQL 的初始数据库用于枚举数据库及连接测试。
PostgreSQL SSL 使用明确的 `verify-full` 或 `disable`；启用 SSL 需要 CA PEM，客户端证书使用
PKCS#12（别名 user），证书密码仍由宿主内部注入。配置导出清除证书路径与凭据。

`DbRef` 新增可选 `schema`；MySQL 不接受独立 schema。PostgreSQL 比较、表读取、执行及恢复要求
明确的数据库和非系统 schema，SQL 使用 schema 限定名。命名空间标识保留旧 MySQL 的
`connectionId/database`，PostgreSQL 使用 `pg:` 加 `[connectionId,database,schema]` 的紧凑 JSON。
前端标识只用于关联，不作为 SQL。跨数据库类型的同步请求在打开数据库前拒绝。

| 接口                    | 归属与参数                  | 返回                                                     |
| ----------------------- | --------------------------- | -------------------------------------------------------- |
| `drivers.list`          | Rust 宿主，空对象           | 驱动状态数组                                             |
| `drivers.get`           | Rust 宿主，`{driverId}`     | 当前驱动状态                                             |
| `drivers.install`       | Rust 宿主，`{driverId}`     | 安装终态；重复安装复用 Promise                           |
| `drivers.cancel`        | Rust 宿主，`{driverId}`     | 当前状态；取消结果由事件或 get 核验                      |
| `schemas.list`          | Java，`{ref}`（数据库层级） | 可访问的非系统 schema 名称                               |
| `database.capabilities` | Java，`{ref}`               | 类型、服务版本、适配器版本、结构／数据／恢复能力及受限项 |

驱动状态包含 `id,databaseType,name,version,builtin,license,licenseUrl,status,revision,bytes,message`。
`status` 为 `missing | downloading | installed | error | cancelled`；宿主广播
`{event:'driver-state',state}`，界面拒绝旧 revision 和旧编辑会话响应。
下载地址、类名、依赖文件及 SHA-256 只读取应用随附目录；渲染进程不能传入 URL、路径或类名。

新计划 `formatVersion=2`，保存数据库类型、适配器版本、来源驱动版本及每目标驱动和连接绑定。
`Change.statements` 保存一个 PostgreSQL 操作编译出的完整语句列表，`sql` 用于完整预览；执行
仍只接收引擎保存的计划 ID 和勾选项。PostgreSQL 主键由 `Table.primaryKeyColumns` 表达，
原生属性和结构化外键资料保存在 `attributes`；`columnDefaults` 保存默认值的
`NONE | LITERAL | EXPRESSION` 类别和原生表示，SQL 编译保留原生表达式。UUID、日期和时间值内部使用带类型文本，
二进制继续使用 `$binary`；展示转换不改写计划、归档或摘要。
旧 MySQL 连接身份仍按原字段验证，历史 SQL 和摘要不重新生成。

浏览器预览的驱动安装、同步、外部声明及恢复只修改内存虚构资料，不连接数据库、下载 JAR 或
持久化。模拟执行确认和记录明确标识“虚构”，刷新页面重置。预览额外的网络失败参数只由内存
桥接处理，真实原生驱动接口拒绝该参数。
