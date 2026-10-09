# Data Sync 设计实现 QA

**final result: passed**

日期：2026-10-08。依据为本会话已确认的白 / 灰 / 蓝桌面设计稿与后续产品约束，复核实际 Vue 页面截图、DOM、关键操作和真实客户端验证。

## 参照与采集

设计源图为本会话生成并选定的 `exec-*.png`，原始尺寸 1487 × 1058。实现截图通过 CUA 浏览器采集，视口 1488 × 1056；对照图将原图缩放这 1–2 像素的差异，左右并排展示，不改变实际 UI 截图。原图 ID 和生成对照的方法见 `scripts/design-comparison.py`。每个对照 JPG 左侧是确认稿，右侧是运行页面。

截图使用明确标注的浏览器设计预览、文档示例 IP 地址和虚构数据。它证明页面布局与交互状态，不作为数据库执行证据；真实数据库与打包进程证据见 `docs/validation.md` 和 `docs/native-smoke-result.json`。

## 页面核对

| 页面 / 状态                              | 结果 | 截图对照                                                 |
| ---------------------------------------- | ---- | -------------------------------------------------------- |
| 结构差异，remark 字段详情、表层级        | 通过 | [对照](docs/screenshots/structure-diff-comparison.jpg)   |
| 数据差异，ORDER_STATUS 字段值和 SQL      | 通过 | [对照](docs/screenshots/data-diff-comparison.jpg)        |
| 表结构字段、摘要、标签与右键菜单         | 通过 | [对照](docs/screenshots/table-view-comparison.jpg)       |
| 工作区关联连接编辑                       | 通过 | [对照](docs/screenshots/workspaces-comparison.jpg)       |
| 已有连接编辑与启用 SSL 表单              | 通过 | [对照](docs/screenshots/connections-comparison.jpg)      |
| 会话格式、解析结果、缺失凭据与重复项处理 | 通过 | [对照](docs/screenshots/import-comparison.jpg)           |
| 源 / 多目标 / 多表 / 匹配键范围          | 通过 | [对照](docs/screenshots/scope-comparison.jpg)            |
| 模板详情与复用范围                       | 通过 | [对照](docs/screenshots/templates-comparison.jpg)        |
| 历史多选标记版本抽屉                     | 通过 | [对照](docs/screenshots/version-drawer-comparison.jpg)   |
| 版本包含记录，原执行状态独立             | 通过 | [对照](docs/screenshots/versions-comparison.jpg)         |
| 保存记录脚本及外部执行入口               | 通过 | [对照](docs/screenshots/record-save-only-comparison.jpg) |
| 每目标执行进度与步骤展开                 | 通过 | [对照](docs/screenshots/execution-result-comparison.jpg) |
| 回滚层级、禁用冲突项、SQL                | 通过 | [对照](docs/screenshots/rollback-comparison.jpg)         |
| 结构导出，默认 DROP 关闭                 | 通过 | [对照](docs/screenshots/export-default-comparison.jpg)   |
| 设置、保留资料与备份入口                 | 通过 | [对照](docs/screenshots/settings-comparison.jpg)         |

另保存 [历史多选](docs/screenshots/history.png) 和 [启用 DROP](docs/screenshots/export-drop.png)。

## 已修正的问题

- **P1 / 交互**：Vue 响应式对象直接结构化克隆导致编辑 / IPC 失败。发送参数和草稿采用普通 JSON 深复制；类型检查、前端回归和真实打包 IPC 已通过。
- **P1 / 详情**：切到数据页时右侧可能保留上一条结构变更。详情跟随当前差异节点更新，截图重新采集，数据字段值与 SQL 对应 ORDER_STATUS。
- **P1 / 证据**：早期部分截图在异步页面切换完成前采集，画面与文件名不符。重新等待对应标题与状态可见后采集，重新生成对照。
- **P2 / 凭据**：会话导入解析结果不能暴露文件明文密码，主进程保留临时凭据，页面只显示状态；最终原生测试检查解析返回值没有密码。
- **P2 / 操作语义**：预览保存脚本也只显示勾选项，且始终注明虚构预览。真实客户端归档由引擎生成，不采用示例 SQL。

未发现尚待修复的 P0 / P1 / P2 设计或已覆盖交互问题。界面不提供浏览器真实执行；禁用行为有明确原因。

## 与静态稿的内容及流程差异

- 示例从 12 个目标库缩减为 3 个，表 / 字段 / 记录数量来自虚构预览；真实客户端按实际连接和计划展示。
- 所有删除及风险结构变化默认关闭，优先遵守已确认安全语义；没有照搬稿中选中的风险项。
- 连接显示“凭据已保存”，不在未运行连接测试前虚构“可连接”；密码不回填明文。
- 工作区连接关联在工作区页管理，数据库范围和分组在连接页管理。既有结构标签按用户要求保留。
- 执行监控统一放在记录详情的执行结果页，源图展示进行中 / 失败示例，对照展示完成状态；真实引擎提供 RUNNING、部分失败、取消和中断记录。版本脚本按记录跳转查看，版本可整体导出。
- 导入截图处于解析结果展示阶段，但使用明确标记的虚构布局样本，不读取外部工具密码；实际三格式解析由原生主进程 / 引擎验证。

## 交互与布局检查

完成表树逐层展开、双击独立结构页、右键入口、同步草稿保留、结构 / 数据切换、模板复用、历史两条记录选择并标记版本、查看版本原状态、脚本文件切换、回滚禁用冲突、DROP 开关与新任务复位。1488 × 1056 无页面整体横向溢出，长 SQL 允许在代码区域滚动；页面长表单允许纵向滚动。

页面重新加载后本轮没有新的 console error。先前开发热更新失败记录属于格式化过程中临时更新，修正后构建、类型检查和重新加载通过。

## P3 后续打磨

- 某些表单比静态稿紧凑，可继续统一辅助说明字号与灰度、较长证书路径和导入说明的视觉密度。
- 版本列表 / 执行详情可增加更多就地脚本预览、耗时显示，减少详情跳转。
- 字段“无默认值”与“默认 NULL”的显示可进一步区分，底层定义与执行 SQL 已保留原始语义。

本报告通过仅指设计实现和列出的验证；干净机器安装、双向 SSL 等未验收范围保持在验证记录中，不以界面截图替代。
