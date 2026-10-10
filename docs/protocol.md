# 本地协议 v1

所有消息为 UTF-8 单行 JSON，以换行分隔。不能在 stdout 输出日志。Java 启动发出 ready 事件；标准请求响应按 `id` 关联，长任务通过事件与记录详情追踪。

```json
{"id":"request-1","method":"tables.list","params":{"ref":{"connectionId":"connection-id","database":"shop_test"}}}
{"id":"request-1","result":[{"name":"sys_dict","comment":"系统字典"}]}
```

失败响应含 `error:{code,message}`，成功响应含 `result`。事件含 `event`，任务事件关联 recordId / target / changeId。具体字段以 `EngineMain.java` 与 `Model.java` 为准。协议输入仅来自受限 Electron 主进程；内部 `$secrets` 不能通过渲染查询取回。

面向界面的输出将超过 JavaScript 安全整数范围的 BIGINT 和浮点 / DECIMAL 数值转换为精确文本，小整数、端口、批次等仍为 JSON 数字。此转换仅用于通信展示，不改写原始计划、归档数值、比较摘要或实际 SQL。

| 接口                                                                           | 用途                                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `ping`, `state.load`                                                           | 协议版本、实体及记录摘要                                                             |
| `entity.save`, `entity.delete`                                                 | 工作区、连接、模板、设置                                                             |
| `connections.test`, `databases.list`, `tables.list`, `table.get`               | 真实 JDBC 与元数据                                                                   |
| `imports.parse`                                                                | 三种会话格式；主进程截留密码后返回解析结果                                           |
| `sync.compare`                                                                 | `workspaceId`, `source`, `targets`, `tables` → `SyncPlan`                            |
| `sync.compare.start`                                                           | 同样的比较范围，可选客户端 UUID `compareId` → `{compareId}`；注册后后台执行          |
| `sync.compare.get`                                                             | `compareId` → `{compareId,status,progress,error,plan?}`；仅完成时提供计划            |
| `sync.compare.cancel`                                                          | `compareId` → `{compareId,status}`；重复取消幂等，停止当前查询与后续读取             |
| `sync.save`                                                                    | `planId`, `selectedIds`, `mode`, `remark` → `SyncRecord`                             |
| `record.get`, `record.file`, `record.export`, `record.cancel`, `record.verify` | 详情、脚本、归档、取消与追加核验                                                     |
| `version.save`                                                                 | 新建 / 追加版本，显式移动记录                                                        |
| `external.declare`, `external.verify`                                          | 用户声明执行范围与独立恢复核验；新记录不使用 `backupCompleted`，旧记录继续校验该参数 |
| `rollback.preview`, `rollback.execute`                                         | 可信执行项、冲突原因与关联恢复记录                                                   |
| `schema.export`                                                                | `source`, `tables`, `includeDrop` → SQL                                              |
| `backup.export`, `backup.prepareRestore`, `backup.finishRestore`               | 备份与暂存恢复                                                                       |
| `config.export`, `config.import`, `archives.clear`                             | 无凭据配置及资料清理                                                                 |

`SyncPlan` 保存源快照、目标原状态、目标连接绑定 `connectionIdentity`（不含密码）、变更 SQL / 逆向 SQL、匹配列、风险和阻止原因。`SyncRecord.mode` 为 `SAVE_ONLY`、`EXECUTE_AND_SAVE` 或关联 `ROLLBACK`；执行状态单独保存，不由版本号推断。新同步记录的可选 `recoveryFormat` 为 `LOCAL_V1`；旧记录缺省为空。`TargetResult.recoveryRows` 按表保存字段原值行，`recoveryDigests` 保存绑定原结构与行内容的摘要；存在表键且值为 `[]` 表示完整空表快照，缺键表示未采集。记录摘要排除大型 `recoveryRows`，详情按需返回。`RollbackPlan` 每项保存 eligible 和 reason；执行仍在锁内重新校验，不能只依赖预览。

新执行不在目标数据库创建备份、收据或快照对象。恢复资料先写入 SQLite 与按目标追加的 `recovery.json`，再执行有损变更，并生成 `05_rollback_local.sql`。`record.get` 和 `record.file` 沿用现有接口返回这些资料；前端按目标优先展示 05，回退到原始 `04_rollback.sql`。旧记录的 `backups`、`backupDigests` 保留兼容，旧外部记录仍要求 `backupCompleted` 并读取原收据与快照；新外部记录兼容接收该参数但不使用。外部核验的表级检查增加 `declaredIds` 与 `recoveryAvailable`，分别表达声明范围和恢复可用性，`valid` 只表示该声明范围的当前状态核验结果。

比较任务状态为 `RUNNING`、`CANCELLING`、`CANCELLED`、`COMPLETED`、`FAILED`。同一引擎只允许一个活动比较，清理完成后才释放活动名额；终态任务保留 10 分钟，成功计划沿用现有内存计划存储。`sync.compare` 保留原返回契约并复用后台比较流程。后台线程使用启动请求的凭据快照。取消一旦被接受，不再发布本次计划；完成先于取消发布时返回完成状态。

取消设置任务标志后异步调用本任务语句的 `cancel()` 和连接的 `abort()`，不终止整个引擎。跨线程语句取消依据 [JDBC Statement.cancel 说明](<https://docs.oracle.com/en/java/javase/21/docs/api/java.sql/java/sql/Statement.html#cancel()>)；当前 MariaDB Connector/J 3.5.10 的连接终止委托给驱动客户端，见 [Connection.abort 实现](https://raw.githubusercontent.com/mariadb-corporation/mariadb-connector-j/3.5.10/src/main/java/org/mariadb/jdbc/Connection.java)。当前驱动的实际效果由三个版本 MySQL 隔离取消测试验证。

`compare-progress` 事件带 `compareId` 和 `progress:{ref,table,phase,completed,total,rows}`，阶段和终态立即发送，行数更新最多每 200ms 一次；终态事件增加 `status,error`，不携带完整计划。`total` 为已选表数 ×（1 + 目标库数），表示源表读取和各目标表比较的处理单元，不代表行数或耗时比例。前端每秒查询状态兜底，只接收当前任务事件；控制接口通信超时为 15 秒，超时后请求取消并继续核验。取消确认前不会解锁范围。

`TableChoice.structureOptions` 可选，包含全部七个布尔值：`columns`、`columnOrder`、`tableComment`、`columnComments`、`indexes`、`foreignKeys`、`tableCollation`。缺省或 null 兼容为全选；提供对象时缺少布尔项拒绝请求；开启结构但细项全空拒绝比较。`columns` 包含字段增删和定义，`tableCollation` 只控制表默认字符集/排序规则，普通/唯一索引不自动同步主键变更。部分结构不能创建缺失表，也不会自动补入未选字段依赖。

字段变更 `after.column` 保存实际计划定义，`MODIFY_COLUMN.changedParts` 标记所改的 `columns`、`columnOrder`、`columnComments`。只改注释保留目标其他属性，默认选中；字段定义或顺序仍受风险限制。新增字段在未选顺序时追加，未选字段注释时不带源注释。核验、界面与回滚依据实际计划定义，旧记录没有该字段时兼容使用源定义。

Electron 另外提供原生选文件、选目录、导出路径、打开资料目录、复制和窗口操作。文件导入使用短期 token 保持内容在主进程；桥接只允许已定义的方法。所有界面参数在发送前转换为普通 JSON 对象，编辑草稿与已保存模型分别持有独立副本。

外观接口由 Electron 主进程处理，不进入 Java 引擎：`appearance.get` 返回 `{themeMode,resolvedTheme}`；`appearance.set` 接受 `themeMode: light | dark | system`，原子保存本机偏好并返回生效外观。系统外观变化发送 `{event: appearance-changed, appearance}`。窗口关闭发送 `window-close-request`；渲染进程检查任务并响应 `close-confirmed` 或 `close-cancelled`，重复请求只显示一次确认。`renderer-ready` 在关闭监听订阅后发送；渲染进程未就绪时使用原生关闭确认。
