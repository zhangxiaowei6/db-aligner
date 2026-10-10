# 导航栏与手动结构导出验收（2026-10-09）

final result: passed

## 2026-10-10：侧栏拖拽、缺表和分组交互

生产浏览器浅色 / 深色共 39 项检查通过，[浏览器报告](docs/react-ui-qa.json) 的 `errors` 为空。保留比较确认、跨页面进度与取消、结构细项和仅保存确认覆盖；导航返回当前范围草稿，比较中可从设置返回查看和停止。原生窗口与主题验收 6 项通过，见 [原生报告](docs/react-desktop-qa.json)。

新增原生 HTML5 鼠标拖拽验收：连接行单击唯一选中、再次点击及树内空白取消；拖拽开始取消选中；跨组移动、同组排序、首连接上方插入、空分组、Esc 取消、无效区域释放及分组自身拖动均检查结束状态。落点通过持久化后的分组和顺序确认，拖拽结束后没有来源、指示器或选中残留。浅深色截图见 [拖拽浅色](docs/screenshots/react-ant-design/tree-drag-light.png)、[拖拽深色](docs/screenshots/react-ant-design/tree-drag-dark.png)。拖动来源的单一边框与目标指示器分别表达来源和落点，不作为多个选中状态。

分组入口统一为带编辑图标的“编辑分组”，分组列表中可编辑名称或切换新增。侧栏及连接表单旁不再显示独立新增分组按钮。连接编辑下拉底部的名称输入和带加号新增操作创建后自动选中；失败重试和草稿隔离由前端交互测试覆盖。已查看 [编辑分组](docs/screenshots/react-ant-design/group-edit-light.png)、[下拉新增浅色](docs/screenshots/react-ant-design/group-select-create-light.png)、[下拉新增深色](docs/screenshots/react-ant-design/group-select-create-dark.png)，输入、操作和主题对比清晰，弹窗底部按钮可操作。

范围页以来源表清单展示缺表标识，提示包含目标库和连接名称；勾选缺表数据后补齐结构，比较确认说明“创建表并复制全部数据”。已有手动取消保留，失败清单显示原因和重试，不使用旧缓存推断缺表。截图见 [范围浅色](docs/screenshots/react-ant-design/scope-options-light.png)、[比较确认深色](docs/screenshots/react-ant-design/compare-confirmation-dark.png)。浏览器数据为虚构预览；本地恢复与目标库对象清单的真实证据见 [本轮验证记录](docs/validation.md)。

## 2026-10-09：比较进度、停止与结构细项补充验收

在当前布局和已有交互基础上加入全局比较进度、比较二次确认和复用的七项结构编辑器。生产浏览器浅色 / 深色流程验证逐表调整、确认摘要中的例外、数据风险默认未勾选且禁止开始、跨页面保留停止入口、停止后保留匹配键和结构细项、重新比较，以及仅保存的原有确认。完整结果见 [浏览器验收报告](docs/react-ui-qa.json)，33 项检查通过，`errors` 为空；[原生窗口验收](docs/react-desktop-qa.json) 6 项通过。

已查看 [比较确认浅色](docs/screenshots/react-ant-design/compare-confirmation-light.png)、[范围深色](docs/screenshots/react-ant-design/scope-options-dark.png)；七项编辑和逐表例外清晰可读，长确认内容在弹窗中滚动，底部确认与取消保持可操作。另保存 [逐表编辑](docs/screenshots/react-ant-design/table-options-light.png)、[运行进度](docs/screenshots/react-ant-design/compare-running-light.png)、[跨页面停止](docs/screenshots/react-ant-design/compare-stopped-dark.png)。截图使用虚构预览数据，JDBC 取消和执行 / 核验 / 回滚结果见 [本轮验证记录](docs/validation.md)。

仅修改注释等细项时，差异详情左栏标为“本次计划定义”，显示保留目标属性后的实际结果。范围、工作区在任务运行和停止清理期间锁定；停止无需额外确认。全表数据的判定、旧事件、重复点击、范围变化、启动期间停止和通信异常由前端测试补充验证。原生关闭测试使用隔离资料目录中的状态样本；本轮未把该检查描述为真实数据库比较的桌面端验收。

## 本轮设计依据与证据

- 用户选定本会话第三张概念图的导航样式：窄功能栏与数据库资源栏并列。设计源图：[selected-reference.png](docs/screenshots/navigation-export/selected-reference.png)，1487 × 1058 px。
- 同尺寸实现：[settings-light.png](docs/screenshots/navigation-export/settings-light.png)，浏览器视口 1488 × 1056 CSS px、截图密度 1。源图仅缩放 1–2 px 差异后，与实现并排放入 [settings-comparison.png](docs/screenshots/navigation-export/settings-comparison.png)；已实际查看该对照。
- 本轮范围为导航结构和表结构导出。保留现有原生标题栏、真实设置字段与设置页布局；导航栏宽 80 px，资源栏默认 280 px（小窗口 256 px），并可拖拽。概念图中右侧表单的排列不是本轮重构目标。
- 稳定构建预览：[preview-final.png](docs/screenshots/navigation-export/preview-final.png)，1280 × 720 px。资源树展开、设置菜单选中，控制台错误为 0；本地预览使用虚构连接。

## 五项视觉核对

- 字体与排版：沿用 Segoe UI / Microsoft YaHei 与 Ant Design 字号；导航文字 13 px、图标 22 px，入口同时显示图标与文字。表名保持单行、省略与完整标题。
- 间距与层级：功能栏独立，设置固定在底部；工作区、连接操作和树组成连续资源栏。移除旧白色树卡片、底部白色导航块与“功能导航”标题；资源树和主内容独立滚动。
- 配色与状态：背景、边框和选中态使用现有主题变量；浅色与深色均检查。拖拽区域背景透明，键盘聚焦只保留中性细线，未出现蓝色粗线。
- 图片与图标：保留现有应用 logo，使用现有 Ant Design 图标，未使用新绘制的图标或图片替代控件。
- 文案与内容：保留四个功能入口及原有真实表单内容；SQL 提示明确要求点击“生成预览 SQL”，不会暗示全选即生成。

## 布局与行为验收

- 浅色、深色各检查 1488 × 1056、1180 × 760、1920 × 1080、900 × 760。截图与 [高度测量记录](docs/screenshots/navigation-export/layout-results.json) 均已保存。
- 双栏页面没有整体纵向溢出，SQL 预览底部与导出布局底部对齐；代码内部滚动，操作栏在视口内。最小桌面尺寸预览高度 167 px；窄屏单栏允许页面滚动，预览保留独立高度。
- 检查全选仅改变选择、按钮生成完整 SQL、DROP 变化立即清空旧 SQL 并禁用导出，以及数据库右键导出入口。最小窗口 DROP 警示状态见 [export-drop-minimum.png](docs/screenshots/navigation-export/export-drop-minimum.png)。
- 检查四个功能导航入口、资源树展开与键盘调整宽度：右方向键使资源栏从 280 px 变为 296 px，左方向键恢复；命中区透明。鼠标拖拽逻辑与原有指针捕获机制保留。
- 前端类型检查与最终构建通过。现有前端套件 63 项通过（串行运行并使用 15 秒测试超时）；追加的 32 张表跨页全选／取消一行／完整生成范围测试单独通过，导出页共覆盖 8 个用例。

## 检查与修正记录

1. 初次全高布局检查发现 Ant Design 当前包装为 `.ant-spin`，原选择器未覆盖，长 SQL 仍撑高页面。补齐包装层的弹性高度后再次检查，页面溢出为 0，预览填满剩余空间。
2. 最小窗口下 DROP 警示占据过多高度。为选项区设置最大高度与独立滚动后重新截图，SQL、生成按钮和底部操作栏仍可达。
3. 按用户反馈将上下分块的侧栏改为选定的窄功能栏加资源树结构，去掉拖拽蓝色高亮；并排对照与浅／深色窗口检查没有剩余 P0/P1/P2 问题。
4. 开发服务在并行热更新时曾产生 Provider 上下文错误；最终另启构建产物预览复核四个导航入口，控制台错误为 0。交付预览使用该稳定构建。

剩余验证边界：界面截图使用浏览器虚构数据；未在本轮连接真实数据库或运行 Electron 安装包验收。现有后端 SQL 接口未修改。

---

# Data Sync 设计实现 QA（既有记录保留）

2026-10-09 已完成 React + Ant Design 迁移。最新结果见 [验证记录](docs/validation.md)、[界面自动验收](docs/react-ui-qa.json)、[原生窗口验收](docs/react-desktop-qa.json)。最新截图使用 Ant Design 默认控件与主题，位于 [截图目录](docs/screenshots/react-ant-design)。

本轮修正长表格穿过底部操作栏的问题：主内容独立滚动，操作栏保留布局空间；不依靠透明遮罩或不断增加 z-index。检查浅色和深色导入长表、最小窗口、模拟显示缩放及弹层命中。组件内部样式交给 Ant Design，仅用 Token 和应用布局 CSS。历史截图和下面的验收记录来自迁移前，不作为最新界面的截图证明。

日期：2026-10-08。依据为本会话已确认的白 / 灰 / 蓝桌面设计稿与后续产品约束，复核迁移前页面截图、DOM、关键操作和真实客户端验证。

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

- **P1 / 交互**：原实现的响应式对象直接结构化克隆导致编辑 / IPC 失败。发送参数和草稿采用普通 JSON 深复制；类型检查、前端回归和真实打包 IPC 已通过。
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
