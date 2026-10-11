# 设计 QA 记录

## 2026-10-12：新建连接原页弹窗与已删分组排除

在浅色／深色浏览器预览中，从差异预览、新建同步、同步历史和设置打开“新建连接”，
表单均停留在当前页面；取消和保存后仍保持原页面。删除“数据库连接”后重新打开表单，
下拉选项不再出现该分组；空分组选择要求通过下拉框的“新增”显式创建。

截图：[差异预览浅色](docs/screenshots/react-ant-design/connection-new-in-place-差异预览-light.png)、
[设置深色](docs/screenshots/react-ant-design/connection-new-in-place-设置-dark.png)。
完整检查见[验证记录](docs/validation.md)。

## 2026-10-12：回滚确认与全目标记录脚本

回滚确认复用同步确认布局，展示原同步来源、实际回滚目标、连接名、地址和端口、
每库及总变更数量与完整已选 SQL。来源明确作为历史背景展示，实际写入目标单独列出。
脚本可按目标切换、滚动并完整复制；最小窗口内容区滚动，底部确认／取消按钮可操作。
浅色／深色均跟随现有主题。

记录详情的执行与回滚脚本按目标数据库、连接名称分段，全部目标在同一页依次展示，
没有目标库下拉框；各段保留独立 SQL 查看和复制。页面纵向滚动，底部操作不被内容覆盖。
本条取代下述 2026-10-11 性能条目中历史脚本使用目标选择器的交互，执行确认仍按目标切换。

已查看本轮最终截图：
[执行脚本浅色](docs/screenshots/react-ant-design/record-execution-all-targets-light.png)、
[回滚脚本深色](docs/screenshots/react-ant-design/record-rollback-all-targets-dark.png)、
[回滚确认浅色](docs/screenshots/react-ant-design/rollback-execution-confirmation-light.png)、
[最小窗口回滚确认深色](docs/screenshots/react-ant-design/rollback-execution-confirmation-minimum-dark.png)。
其余浅／深色及最小窗口截图使用同目录的 `record-*-all-targets*` 与
`rollback-execution-confirmation*` 文件名。

专项浅／深色 10 项检查通过，控制台错误为 0；完整 UI 套件在其他连接组织场景超时，
不能记为完整通过。环境、实际命令与证明范围见[验证记录](docs/validation.md)。
本轮使用虚构档案和恢复项，不连接数据库，也不证明原生客户端、安装包或真实回滚已验证。

## 2026-10-12：连接填写提示与空分组删除

新建与编辑共用表单补齐全部输入和选择提示，SSL 证书项同样覆盖；已有默认值保留。
已查看浅色／深色新建连接、1180 × 760 SSL 表单及删除确认截图，底部保存和取消可达。
应用关闭拼写检查，表单必填校验继续显示。分组右键新增危险色“删除分组”，空分组确认后删除，
取消保留；其他工作区有连接时阻止，失败允许重试。真实桌面使用隔离资料验证删除 IPC 和重启持久性。

截图：[连接提示浅色](docs/screenshots/react-ant-design/connection-placeholders-light.png)、
[连接提示深色](docs/screenshots/react-ant-design/connection-placeholders-dark.png)、
[SSL 最小窗口浅色](docs/screenshots/react-ant-design/connection-ssl-minimum-light.png)、
[SSL 最小窗口深色](docs/screenshots/react-ant-design/connection-ssl-minimum-dark.png)、
[删除确认浅色](docs/screenshots/react-ant-design/group-delete-confirmation-light.png)、
[删除确认深色](docs/screenshots/react-ant-design/group-delete-confirmation-dark.png)。
实际命令与验证边界见[验证记录](docs/validation.md)。

## 2026-10-11：SQL 大脚本与虚拟列表性能

本次使用最终生产前端资源和虚构压力数据完成浅色／深色验收。
`npm run qa:ui -w desktop` 的 97 项检查通过；专项压力报告见
[性能 UI](docs/performance-ui-qa.json)，实际环境与证明范围见[验证记录](docs/validation.md)。

- SQL 工具栏明确“复制完整 SQL”；大脚本当前页、总页数、跳转和跨页语句提示保持可达。
  SQL 和表清单各自滚动，最小窗口底部导出按钮不被覆盖。
- 执行确认和历史脚本使用目标选择器，一次显示一个目标；完整目标摘要仍保留。
- 差异／回滚 20,000 项列表使用虚拟滚动，长列表末尾可选择与键盘查看；
  勾选仍覆盖分组完整范围，阻止项禁用。窄窗口上下排列，底部操作保持可达。
- 已查看浅色／深色 10 MiB SQL、20,000 项差异和回滚，以及 960 px 窄回滚截图；
  颜色跟随主题，内容区独立滚动，无底部遮挡。当前截图的 SQL 内容为虚构单行压力输入。

本次专项截图：
[大 SQL 浅色](docs/screenshots/react-ant-design/performance-sql-10mb-light.png)、
[大 SQL 深色](docs/screenshots/react-ant-design/performance-sql-10mb-dark.png)、
[大差异浅色](docs/screenshots/react-ant-design/performance-diff-20000-light.png)、
[大差异深色](docs/screenshots/react-ant-design/performance-diff-20000-dark.png)、
[回滚深色](docs/screenshots/react-ant-design/performance-rollback-20000-dark.png)、
[窄回滚浅色](docs/screenshots/react-ant-design/performance-rollback-960-light.png)。

界面验收不证明生产数据库、旧安装包或干净 Windows 安装已验证。

## 2026-10-11：树加载 icon 与长列表差异明细

连接／数据库展开时以旋转加载 icon 替换节点原图标，至少展示 300 ms，慢请求持续至结束，页面不追加“加载中”文字。已查看[连接浅色](docs/screenshots/react-ant-design/tree-loading-connection-light.png)、[连接深色](docs/screenshots/react-ant-design/tree-loading-connection-dark.png)、[数据库浅色](docs/screenshots/react-ant-design/tree-loading-database-light.png)及[数据库深色](docs/screenshots/react-ant-design/tree-loading-database-dark.png)截图，图标位于原资源图标位置，文字与缩进保持原样。

差异列表滚到底部后选择字段，右侧明细始终在当前视口内；两区分别滚动，查看明细或 SQL 不移动列表。切换字段及键盘 Enter 查看时，明细回到顶部。摘要限制高度，保留底部操作可达；960px 窄窗口上下排列列表和明细。已查看[长列表浅色](docs/screenshots/react-ant-design/diff-long-list-1488-light.png)、[长列表深色](docs/screenshots/react-ant-design/diff-long-list-1488-dark.png)、[最小窗口](docs/screenshots/react-ant-design/diff-long-list-1180-dark.png)及[窄窗口](docs/screenshots/react-ant-design/diff-long-list-960-light.png)截图。

完整浏览器 97 项、长列表六组、树四组验收通过，控制台错误为 0；截图使用 80 张虚构差异表和人工延迟响应。SQL 导出行为按用户最终要求保留原实现。环境、命令、报告与未覆盖范围见[本轮验证记录](docs/validation.md#2026-10-11树展开图标与长差异列表明细)。本轮没有进行真实数据库、原生客户端或安装包验收。

本文件保留按日期采集的视觉复核、截图与对照，历史样本不作为当前界面或本次执行的证明。现行要求见[交互规范](docs/interaction-guidelines.md)，命令、环境和测试结果集中在[验证记录](docs/validation.md)；后续维护遵循[文档规范](CONTRIBUTING.md#文档规范)。

## 右键菜单反馈、原地编辑与模块隔离（2026-10-11）

三项菜单操作“测试连接”“刷新数据库”“刷新数据表”统一为加载转圈、成功绿色文字与右侧勾、失败红色文字与右侧叉，浅色／深色均使用主题变量。请求期间及完成后保持菜单打开，整行悬停和键盘聚焦可查看完整结果；未操作及重开菜单清空结果后无提示。每次实际右键都会重置展示，旧请求继续执行，完成结果不能填回新菜单。此规则取代历史样本中数据库菜单“刷新表结构”名称及重新打开菜单保留终态的行为，单表详情仍使用“刷新表结构”。

已查看 [测试成功浅色](docs/screenshots/react-ant-design/context-test-success-light.png)、[刷新数据库成功深色](docs/screenshots/react-ant-design/context-refresh-success-dark.png)、[测试失败浅色](docs/screenshots/react-ant-design/context-test-failure-light.png)、[刷新数据库失败深色](docs/screenshots/react-ant-design/context-refresh-failure-dark.png)、[刷新数据表浅色](docs/screenshots/react-ant-design/context-table-refresh-light.png) 与 [深色](docs/screenshots/react-ant-design/context-table-refresh-dark.png)。菜单文字、右侧状态图标及完整提示对应操作结果，主题对比和菜单保持打开正常。

右键“编辑连接”直接在当前页面显示统一弹窗；已查看 [差异页深色](docs/screenshots/react-ant-design/connection-edit-in-place-diff-dark.png) 和 [范围页浅色](docs/screenshots/react-ant-design/connection-edit-in-place-scope-light.png)，底层页面和同步草稿保持，密码显示已保存占位而不回填。取消和保存后的页标题均保持原页。模板与同步的反馈独立，见 [浅色](docs/screenshots/react-ant-design/refresh-module-isolation-light.png)／[深色](docs/screenshots/react-ant-design/refresh-module-isolation-dark.png)；树中测试或刷新也不改变管理列表和同步按钮的终态。

最终生产构建的完整界面回归、菜单专项浅色／深色及千表／五千表树刷新场景均通过，报告及完整命令、环境和证明范围见 [本次验证记录](docs/validation.md#2026-10-11右键菜单反馈与模块状态隔离)。截图使用浏览器虚构数据，不作为真实连接、执行或数据库性能证据。历史条目的日期、原名称和结果继续保留；可被覆盖的最新报告对应本次运行。

## 连接树展开重查与刷新表结构验收（2026-10-11）

按最新交互要求，折叠上级清除全部子级展开状态，每次展开连接／数据库分别重新查询数据库／表清单。数据库右键菜单名为“刷新表结构”，刷新更新表清单和当前打开的结构，保持展开状态；失败保留最后成功的数据并支持重试。每次打开表结构也重新读取，不复用旧模型。此规则取代下节历史验收中的展开缓存规则，虚拟滚动继续保留。

生产浏览器浅色／深色、1,000 / 5,000 张虚构表共 4 组全部通过，控制台错误为 0，详见 [最新报告](docs/tree-qa.json)。每组 6 次数据库展开对应 6 次表清单请求；随后刷新成功、失败、重试、折叠时刷新和再次展开累计 11 次请求。父节点重开后子级保持折叠，新增表出现、删除表移除，当前结构版本随刷新更新。末尾行选择／右键／双击、滚轮、End 导航、缩小窗口及连接组织／拖拽 [8 项专项检查](docs/tree-organization-qa.json) 全部通过。

5,000 表浅色样本实际挂载 28 个节点，三次重新展开 46.5–57.5 毫秒、折叠 262.5–271.8 毫秒。表清单由本地虚构接口立即返回，这些数据不包含真实数据库查询耗时。已查看 [刷新后浅色](docs/screenshots/react-ant-design/tree-refresh-light.png) 与 [深色](docs/screenshots/react-ant-design/tree-refresh-dark.png)，新增表、当前结构和主题显示正常。

本轮 `npm run typecheck`、`npm test`、`npm run build` 均通过；前端 143 项全部通过，默认引擎 22 项通过、2 项按配置跳过。浏览器验收使用生产构建，未重新生成安装包，环境和验证范围见 [验证记录](docs/validation.md)。

---

## 大表连接树性能验收（2026-10-11，历史缓存策略）

连接树使用资源栏实际可用高度启用 Ant Design 虚拟滚动，展开／折叠只创建视口附近的节点；保留原有展开动画、按需加载、选择、右键和原生拖拽。资源栏上下留白 16px、左右 8px，树内列表负责滚动。虚拟视口首尾投放指示线与圆形端点向节点内部对齐，避免裁剪。

本机 Chrome 154.0.8037.98、生产构建、1488 × 1056 视口的浅色对照（每项三次重复，计时包含展开／折叠动画及下一帧）：

| 虚构表数 | 优化前展开    | 优化后展开   | 优化前折叠   | 优化后折叠   | 实际挂载节点前／后 |
| -------- | ------------- | ------------ | ------------ | ------------ | ------------------ |
| 1,000    | 2.23–2.62 秒  | 0.26–0.27 秒 | 1.63–2.20 秒 | 0.26–0.28 秒 | 1,005 / 28         |
| 5,000    | 8.87–12.53 秒 | 0.25–0.28 秒 | 5.32–7.95 秒 | 0.25–0.30 秒 | 5,005 / 28         |

以上为初次优化时缓存清单的历史样本；当时反复展开表清单请求仅一次，现已按最新要求改为每次重新查询。当前样本、浏览器版本、父节点计时及挂载数量见 [大表树报告](docs/tree-qa.json)，以本页上节为准。历史验收覆盖浅色／深色各 1,000 和 5,000 张表，数据库、连接、分组展开折叠，末尾表选择、右键、双击、End 导航、鼠标滚轮和 1180 × 760 窗口边界，控制台错误为 0。

连接分组／拖拽专项浅色和深色共 8 项通过，见 [专项报告](docs/tree-organization-qa.json)：单击取消选择、长按、跨组移动、组内排序、分组排序、首节点前插入、空组、Esc 和无效区域取消，以及保存后的顺序。已查看 [5,000 表浅色](docs/screenshots/react-ant-design/tree-large-light.png) 与 [深色](docs/screenshots/react-ant-design/tree-large-dark.png)，末尾行可达、选中态和主题一致；查看表结构后的主内容横向滚动沿用原布局。

执行命令为 `npm run build`、`npm run qa:tree -w desktop` 和 `npm run qa:ui -w desktop -- --tree-organization`。测试使用虚构表清单，不测真实数据库查询时间，也不作为 Electron 安装包或真库同步验收。最终前端单工作进程完整复测 135 项全部通过，默认引擎回归 22 项通过、2 项真库测试按默认配置跳过；具体命令和重试情况见 [验证记录](docs/validation.md)。当前运行环境为 Node.js 22.22.2 / npm 10.9.7，与项目推荐的 Node.js 24 / npm 11 不同。

---

## 同步范围与编辑入口验收（2026-10-11）

- 同步类型使用“同步结构／同步数据”页签。来源与目标数据库共用，两种类型的选表、搜索、编辑内容和刷新结果反馈分别保留；切回页签恢复自己的范围，更换来源或工作区后重置草稿。
- 同步表格统一在最左列勾选，结构页仅显示选择、表名、表说明和结构细项，数据页仅显示选择、表名、表说明和匹配键。已实际查看 [结构页浅色](docs/screenshots/react-ant-design/scope-structure-mode-light.png) 和 [数据页深色](docs/screenshots/react-ant-design/scope-data-mode-dark.png)，没有对侧模式的无效列。
- “搜索表”紧贴表格上方，带明确标签、清空入口、筛选数／总数和已选数量。“全选所有表／取消全选”随状态切换；有搜索时显示“全选搜索结果／取消选择搜索结果”。表头同时提供全选和半选状态，范围包含所有分页；空列表禁用。
- 表格下方只显示当前类型的说明。差异页仅显示有差异的结构／数据页签，搜索不会隐藏页签；只有一种差异时直接展示该类型，无差异时不显示页签，被阻止项按所选范围归类。浅色／深色的单类型差异截图分别为 [结构](docs/screenshots/react-ant-design/diff-structure-mode-light.png) 和 [数据](docs/screenshots/react-ant-design/diff-data-skip-dark.png)。
- 工作区、连接和模板表格仅通过操作列“编辑”按钮打开弹窗，单击或双击普通行都不进入编辑。取消仍丢弃草稿，新建仍使用既有弹窗。
- 最终生产浏览器验收 83 项通过，控制台 `errors` 为空，见 [本轮报告](docs/react-ui-qa.json)。浅色、深色及底部操作栏检查通过；使用虚构预览数据，不作为真实数据库执行或安装包验收证据。源码测试与环境边界见 [验证记录](docs/validation.md)。

以下保留既有验收记录；其中旧的同步类型选择及行编辑交互以本节为准。

---

## 导航栏与手动结构导出验收（2026-10-09）

final result: passed

### 2026-10-10：侧栏拖拽、缺表和分组交互

生产浏览器浅色 / 深色共 39 项检查通过，[浏览器报告](docs/react-ui-qa.json) 的 `errors` 为空。保留比较确认、跨页面进度与取消、结构细项和仅保存确认覆盖；导航返回当前范围草稿，比较中可从设置返回查看和停止。原生窗口与主题验收 6 项通过，见 [原生报告](docs/react-desktop-qa.json)。

新增原生 HTML5 鼠标拖拽验收：连接行单击唯一选中、再次点击及树内空白取消；拖拽开始取消选中；跨组移动、同组排序、首连接上方插入、空分组、Esc 取消、无效区域释放及分组自身拖动均检查结束状态。落点通过持久化后的分组和顺序确认，拖拽结束后没有来源、指示器或选中残留。浅深色截图见 [拖拽浅色](docs/screenshots/react-ant-design/tree-drag-light.png)、[拖拽深色](docs/screenshots/react-ant-design/tree-drag-dark.png)。拖动来源的单一边框与目标指示器分别表达来源和落点，不作为多个选中状态。

分组入口统一为带编辑图标的“编辑分组”，分组列表中可编辑名称或切换新增。侧栏及连接表单旁不再显示独立新增分组按钮。连接编辑下拉底部的名称输入和带加号新增操作创建后自动选中；失败重试和草稿隔离由前端交互测试覆盖。已查看 [编辑分组](docs/screenshots/react-ant-design/group-edit-light.png)、[下拉新增浅色](docs/screenshots/react-ant-design/group-select-create-light.png)、[下拉新增深色](docs/screenshots/react-ant-design/group-select-create-dark.png)，输入、操作和主题对比清晰，弹窗底部按钮可操作。

范围页以来源表清单展示缺表标识，提示包含目标库和连接名称；勾选缺表数据后补齐结构，比较确认说明“创建表并复制全部数据”。已有手动取消保留，失败清单显示原因和重试，不使用旧缓存推断缺表。截图见 [范围浅色](docs/screenshots/react-ant-design/scope-options-light.png)、[比较确认深色](docs/screenshots/react-ant-design/compare-confirmation-dark.png)。浏览器数据为虚构预览；本地恢复与目标库对象清单的真实证据见 [本轮验证记录](docs/validation.md)。

### 2026-10-09：比较进度、停止与结构细项补充验收

在当前布局和已有交互基础上加入全局比较进度、比较二次确认和复用的七项结构编辑器。生产浏览器浅色 / 深色流程验证逐表调整、确认摘要中的例外、数据风险默认未勾选且禁止开始、跨页面保留停止入口、停止后保留匹配键和结构细项、重新比较，以及仅保存的原有确认。完整结果见 [浏览器验收报告](docs/react-ui-qa.json)，33 项检查通过，`errors` 为空；[原生窗口验收](docs/react-desktop-qa.json) 6 项通过。

已查看 [比较确认浅色](docs/screenshots/react-ant-design/compare-confirmation-light.png)、[范围深色](docs/screenshots/react-ant-design/scope-options-dark.png)；七项编辑和逐表例外清晰可读，长确认内容在弹窗中滚动，底部确认与取消保持可操作。另保存 [逐表编辑](docs/screenshots/react-ant-design/table-options-light.png)、[运行进度](docs/screenshots/react-ant-design/compare-running-light.png)、[跨页面停止](docs/screenshots/react-ant-design/compare-stopped-dark.png)。截图使用虚构预览数据，JDBC 取消和执行 / 核验 / 回滚结果见 [本轮验证记录](docs/validation.md)。

仅修改注释等细项时，差异详情左栏标为“本次计划定义”，显示保留目标属性后的实际结果。范围、工作区在任务运行和停止清理期间锁定；停止无需额外确认。全表数据的判定、旧事件、重复点击、范围变化、启动期间停止和通信异常由前端测试补充验证。原生关闭测试使用隔离资料目录中的状态样本；本轮未把该检查描述为真实数据库比较的桌面端验收。

### 本轮设计依据与证据

- 用户选定本会话第三张概念图的导航样式：窄功能栏与数据库资源栏并列。设计源图：[selected-reference.png](docs/screenshots/navigation-export/selected-reference.png)，1487 × 1058 px。
- 同尺寸实现：[settings-light.png](docs/screenshots/navigation-export/settings-light.png)，浏览器视口 1488 × 1056 CSS px、截图密度 1。源图仅缩放 1–2 px 差异后，与实现并排放入 [settings-comparison.png](docs/screenshots/navigation-export/settings-comparison.png)；已实际查看该对照。
- 本轮范围为导航结构和表结构导出。保留现有原生标题栏、真实设置字段与设置页布局；导航栏宽 80 px，资源栏默认 280 px（小窗口 256 px），并可拖拽。概念图中右侧表单的排列不是本轮重构目标。
- 稳定构建预览：[preview-final.png](docs/screenshots/navigation-export/preview-final.png)，1280 × 720 px。资源树展开、设置菜单选中，控制台错误为 0；本地预览使用虚构连接。

### 五项视觉核对

- 字体与排版：沿用 Segoe UI / Microsoft YaHei 与 Ant Design 字号；导航文字 13 px、图标 22 px，入口同时显示图标与文字。表名保持单行、省略与完整标题。
- 间距与层级：功能栏独立，设置固定在底部；工作区、连接操作和树组成连续资源栏。移除旧白色树卡片、底部白色导航块与“功能导航”标题；资源树和主内容独立滚动。
- 配色与状态：背景、边框和选中态使用现有主题变量；浅色与深色均检查。拖拽区域背景透明，键盘聚焦只保留中性细线，未出现蓝色粗线。
- 图片与图标：保留现有应用 logo，使用现有 Ant Design 图标，未使用新绘制的图标或图片替代控件。
- 文案与内容：保留四个功能入口及原有真实表单内容；SQL 提示明确要求点击“生成预览 SQL”，不会暗示全选即生成。

### 布局与行为验收

- 浅色、深色各检查 1488 × 1056、1180 × 760、1920 × 1080、900 × 760。截图与 [高度测量记录](docs/screenshots/navigation-export/layout-results.json) 均已保存。
- 双栏页面没有整体纵向溢出，SQL 预览底部与导出布局底部对齐；代码内部滚动，操作栏在视口内。最小桌面尺寸预览高度 167 px；窄屏单栏允许页面滚动，预览保留独立高度。
- 检查全选仅改变选择、按钮生成完整 SQL、DROP 变化立即清空旧 SQL 并禁用导出，以及数据库右键导出入口。最小窗口 DROP 警示状态见 [export-drop-minimum.png](docs/screenshots/navigation-export/export-drop-minimum.png)。
- 检查四个功能导航入口、资源树展开与键盘调整宽度：右方向键使资源栏从 280 px 变为 296 px，左方向键恢复；命中区透明。鼠标拖拽逻辑与原有指针捕获机制保留。
- 前端类型检查与最终构建通过。现有前端套件 63 项通过（串行运行并使用 15 秒测试超时）；追加的 32 张表跨页全选／取消一行／完整生成范围测试单独通过，导出页共覆盖 8 个用例。

### 检查与修正记录

1. 初次全高布局检查发现 Ant Design 当前包装为 `.ant-spin`，原选择器未覆盖，长 SQL 仍撑高页面。补齐包装层的弹性高度后再次检查，页面溢出为 0，预览填满剩余空间。
2. 最小窗口下 DROP 警示占据过多高度。为选项区设置最大高度与独立滚动后重新截图，SQL、生成按钮和底部操作栏仍可达。
3. 按用户反馈将上下分块的侧栏改为选定的窄功能栏加资源树结构，去掉拖拽蓝色高亮；并排对照与浅／深色窗口检查没有剩余 P0/P1/P2 问题。
4. 开发服务在并行热更新时曾产生 Provider 上下文错误；最终另启构建产物预览复核四个导航入口，控制台错误为 0。交付预览使用该稳定构建。

剩余验证边界：界面截图使用浏览器虚构数据；未在本轮连接真实数据库或运行 Electron 安装包验收。现有后端 SQL 接口未修改。

---

## Data Sync 设计实现 QA（既有记录保留）

2026-10-09 已完成 React + Ant Design 迁移。最新结果见 [验证记录](docs/validation.md)、[界面自动验收](docs/react-ui-qa.json)、[原生窗口验收](docs/react-desktop-qa.json)。最新截图使用 Ant Design 默认控件与主题，位于 [截图目录](docs/screenshots/react-ant-design)。

本轮修正长表格穿过底部操作栏的问题：主内容独立滚动，操作栏保留布局空间；不依靠透明遮罩或不断增加 z-index。检查浅色和深色导入长表、最小窗口、模拟显示缩放及弹层命中。组件内部样式交给 Ant Design，仅用 Token 和应用布局 CSS。历史截图和下面的验收记录来自迁移前，不作为最新界面的截图证明。

日期：2026-10-08。依据为本会话已确认的白 / 灰 / 蓝桌面设计稿与后续产品约束，复核迁移前页面截图、DOM、关键操作和真实客户端验证。

### 参照与采集

设计源图为本会话生成并选定的 `exec-*.png`，原始尺寸 1487 × 1058。实现截图通过 CUA 浏览器采集，视口 1488 × 1056；对照图将原图缩放这 1–2 像素的差异，左右并排展示，不改变实际 UI 截图。原图 ID 和生成对照的方法见 `scripts/design-comparison.py`。每个对照 JPG 左侧是确认稿，右侧是运行页面。

截图使用明确标注的浏览器设计预览、文档示例 IP 地址和虚构数据。它证明页面布局与交互状态，不作为数据库执行证据；真实数据库与打包进程证据见 `docs/validation.md` 和 `docs/native-smoke-result.json`。

### 页面核对

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

### 已修正的问题

- **P1 / 交互**：原实现的响应式对象直接结构化克隆导致编辑 / IPC 失败。发送参数和草稿采用普通 JSON 深复制；类型检查、前端回归和真实打包 IPC 已通过。
- **P1 / 详情**：切到数据页时右侧可能保留上一条结构变更。详情跟随当前差异节点更新，截图重新采集，数据字段值与 SQL 对应 ORDER_STATUS。
- **P1 / 证据**：早期部分截图在异步页面切换完成前采集，画面与文件名不符。重新等待对应标题与状态可见后采集，重新生成对照。
- **P2 / 凭据**：会话导入解析结果不能暴露文件明文密码，主进程保留临时凭据，页面只显示状态；最终原生测试检查解析返回值没有密码。
- **P2 / 操作语义**：预览保存脚本也只显示勾选项，且始终注明虚构预览。真实客户端归档由引擎生成，不采用示例 SQL。

未发现尚待修复的 P0 / P1 / P2 设计或已覆盖交互问题。界面不提供浏览器真实执行；禁用行为有明确原因。

### 与静态稿的内容及流程差异

- 示例从 12 个目标库缩减为 3 个，表 / 字段 / 记录数量来自虚构预览；真实客户端按实际连接和计划展示。
- 所有删除及风险结构变化默认关闭，优先遵守已确认安全语义；没有照搬稿中选中的风险项。
- 连接显示“凭据已保存”，不在未运行连接测试前虚构“可连接”；密码不回填明文。
- 工作区连接关联在工作区页管理，数据库范围和分组在连接页管理。既有结构标签按用户要求保留。
- 执行监控统一放在记录详情的执行结果页，源图展示进行中 / 失败示例，对照展示完成状态；真实引擎提供 RUNNING、部分失败、取消和中断记录。版本脚本按记录跳转查看，版本可整体导出。
- 导入截图处于解析结果展示阶段，但使用明确标记的虚构布局样本，不读取外部工具密码；实际三格式解析由原生主进程 / 引擎验证。

### 交互与布局检查

完成表树逐层展开、双击独立结构页、右键入口、同步草稿保留、结构 / 数据切换、模板复用、历史两条记录选择并标记版本、查看版本原状态、脚本文件切换、回滚禁用冲突、DROP 开关与新任务复位。1488 × 1056 无页面整体横向溢出，长 SQL 允许在代码区域滚动；页面长表单允许纵向滚动。

页面重新加载后本轮没有新的 console error。先前开发热更新失败记录属于格式化过程中临时更新，修正后构建、类型检查和重新加载通过。

### P3 后续打磨

- 某些表单比静态稿紧凑，可继续统一辅助说明字号与灰度、较长证书路径和导入说明的视觉密度。
- 版本列表 / 执行详情可增加更多就地脚本预览、耗时显示，减少详情跳转。
- 字段“无默认值”与“默认 NULL”的显示可进一步区分，底层定义与执行 SQL 已保留原始语义。

本报告通过仅指设计实现和列出的验证；干净机器安装、双向 SSL 等未验收范围保持在验证记录中，不以界面截图替代。
