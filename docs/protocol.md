# 本地协议 v1

所有消息为 UTF-8 单行 JSON，以换行分隔。不能在 stdout 输出日志。Java 启动发出 ready 事件；标准请求响应按 `id` 关联，长任务通过事件与记录详情追踪。

```json
{"id":"request-1","method":"tables.list","params":{"ref":{"connectionId":"connection-id","database":"shop_test"}}}
{"id":"request-1","result":[{"name":"sys_dict","comment":"系统字典"}]}
```

失败响应含 `error:{code,message}`，成功响应含 `result`。事件含 `event`，任务事件关联 recordId / target / changeId。具体字段以 `EngineMain.java` 与 `Model.java` 为准。协议输入仅来自受限 Electron 主进程；内部 `$secrets` 不能通过渲染查询取回。

面向界面的输出将超过 JavaScript 安全整数范围的 BIGINT 和浮点 / DECIMAL 数值转换为精确文本，小整数、端口、批次等仍为 JSON 数字。此转换仅用于通信展示，不改写原始计划、归档数值、比较摘要或实际 SQL。

| 接口                                                                           | 用途                                                      |
| ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `ping`, `state.load`                                                           | 协议版本、实体及记录摘要                                  |
| `entity.save`, `entity.delete`                                                 | 工作区、连接、模板、设置                                  |
| `connections.test`, `databases.list`, `tables.list`, `table.get`               | 真实 JDBC 与元数据                                        |
| `imports.parse`                                                                | 三种会话格式；主进程截留密码后返回解析结果                |
| `sync.compare`                                                                 | `workspaceId`, `source`, `targets`, `tables` → `SyncPlan` |
| `sync.save`                                                                    | `planId`, `selectedIds`, `mode`, `remark` → `SyncRecord`  |
| `record.get`, `record.file`, `record.export`, `record.cancel`, `record.verify` | 详情、脚本、归档、取消与追加核验                          |
| `version.save`                                                                 | 新建 / 追加版本，显式移动记录                             |
| `external.declare`, `external.verify`                                          | 用户声明和独立恢复核验                                    |
| `rollback.preview`, `rollback.execute`                                         | 可信执行项、冲突原因与关联恢复记录                        |
| `schema.export`                                                                | `source`, `tables`, `includeDrop` → SQL                   |
| `backup.export`, `backup.prepareRestore`, `backup.finishRestore`               | 备份与暂存恢复                                            |
| `config.export`, `config.import`, `archives.clear`                             | 无凭据配置及资料清理                                      |

`SyncPlan` 保存源快照、目标原状态、目标连接绑定 `connectionIdentity`（不含密码）、变更 SQL / 逆向 SQL、匹配列、风险和阻止原因。`SyncRecord.mode` 为 `SAVE_ONLY`、`EXECUTE_AND_SAVE` 或关联 `ROLLBACK`；执行状态单独保存，不由版本号推断。`RollbackPlan` 每项保存 eligible 和 reason；执行仍重新校验，不能只依赖预览。

Electron 另外提供原生选文件、选目录、导出路径、打开资料目录、复制和窗口操作。文件导入使用短期 token 保持内容在主进程；桥接只允许已定义的方法。所有界面参数在发送前转换为普通 JSON 对象，编辑草稿与已保存模型分别持有独立副本。

外观接口由 Electron 主进程处理，不进入 Java 引擎：`appearance.get` 返回 `{themeMode,resolvedTheme}`；`appearance.set` 接受 `themeMode: light | dark | system`，原子保存本机偏好并返回生效外观。系统外观变化发送 `{event: appearance-changed, appearance}`。窗口关闭发送 `window-close-request`；渲染进程检查任务并响应 `close-confirmed` 或 `close-cancelled`，重复请求只显示一次确认。`renderer-ready` 在关闭监听订阅后发送；渲染进程未就绪时使用原生关闭确认。
