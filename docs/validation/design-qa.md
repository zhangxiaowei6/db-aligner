# 设计 QA 记录

保存当前 Tauri 客户端按日期采集的视觉复核。当前交互要求见[交互规范](../reference/interaction-guidelines.md)，命令、环境和实际结果见[验证记录](README.md)；早期设计样本及迁移对照见[历史设计归档](../archive/legacy-client/design-qa.md)。

## 证据索引

| 复核目的                   | 入口                         |
| -------------------------- | ---------------------------- |
| 导航、必填、动效与历史管理 | 下方 2026-10-17 各条目       |
| 完整便携包原生外观         | 下方完整便携包原生复核       |
| 原生标题栏及弹窗恢复       | 下方 2026-10-16 条目         |
| 历史参照与截图             | 历史设计归档，保持原证明范围 |

同名截图和报告可被后续验收覆盖，不代表不可变历史快照。此次文档整理没有重新截图或执行界面验收。

## 2026-10-18：0.1.1 发布前界面复核

使用本次生产前端重跑完整浏览器 132 项、导航浅深 2 组、关联交互 12 项、动效浅深 2 组及
1,000／5,000 表四组树验收，控制台错误均为 0。交互专项修正中文按钮自动空格的定位，
保留备注编辑、完整标识确认、取消和版本删除保留记录的原始断言。对应 JSON 与截图已由本次脚本更新。

已查看[浅色最小窗口长项目名](../screenshots/react-ant-design/navigation-long-project-minimum-light.png)、
[深色 PostgreSQL 必填表单](../screenshots/react-ant-design/navigation-required-postgresql-dark.png)、
[浅色删除确认](../screenshots/react-ant-design/record-delete-confirmation-minimum-light.png)、
[深色删除确认](../screenshots/react-ant-design/record-delete-confirmation-minimum-dark.png)和
[深色版本表格提示](../screenshots/react-ant-design/motion-version-table-dark.png)：长名称按可用宽度截断，
必填标记可辨识，1180 × 760 下风险、备注、完整标识及底部按钮可达，长版本说明能显示完整提示。

本次完整 `0.1.1` ZIP 解压后的原生 UI 13 项通过。已查看
[原生浅色](../package-native/screenshots/react-ant-design/native-client-light.png)截图：空工作区布局、
新建同步入口和侧栏完整；深色、密码复验、桥接、记录管理和重启状态由
[原生报告](../package-native/native-client-ui-qa.json)记录。浏览器为虚构资料；真库、包摘要、
维护者验收确认和独立安装／升级证据的边界见[本次验证记录](README.md#2026-10-18011-发布前完整回归)。

## 2026-10-17：页面路径、文字面包屑与必填标记

面包屑专项使用生产前端和内存虚构资料，浅色／深色两组均通过，控制台错误 0，见[面包屑与表单报告](../navigation-ui-qa.json)。覆盖祖先与末级页面点击、Enter／Space、同页重新进入、记录列表与版本来源分支、回滚再次校验、导入重进清空、设置恢复已保存配置、减少动态效果及长项目名截断。[完整浏览器回归](../react-ui-qa.json)另外通过 132 项检查，错误 0；默认测试与真库结果见[验证记录](README.md)。

已查看[浅色文字悬浮](../screenshots/react-ant-design/navigation-text-hover-light.png)和[深色文字悬浮](../screenshots/react-ant-design/navigation-text-hover-dark.png)：项目后的页面项采用可交互文本，保持原字号、颜色和分隔间距，无按钮或链接外观；实测 padding、margin 均为 0，文字高度 22px，悬浮前后宽高一致。悬浮有淡色背景与手型，键盘聚焦使用清晰轮廓。

已查看[版本进入记录](../screenshots/react-ant-design/navigation-version-record-light.png)和[深色最小窗口回滚](../screenshots/react-ant-design/navigation-rollback-minimum-dark.png)：路径包含同步历史、版本、版本号、记录编号及回滚预览，1180 × 760 下仍可辨识，底部返回及执行操作可达；重新进入不会自动执行。

已查看[导入密码必填](../screenshots/react-ant-design/navigation-import-required-light.png)、[PostgreSQL 必填字段](../screenshots/react-ant-design/navigation-required-postgresql-dark.png)及[深色长项目名称](../screenshots/react-ant-design/navigation-long-project-minimum-dark.png)：需要补密码的已选导入行显示红色星号，填入后保留；不参与导入的警告行不误标。初始数据库、连接字段和其他必填标签统一标记，较长项目名省略后保留完整 title，末级页面仍可见。

补充查看[深色 PostgreSQL SSL 条件必填](../screenshots/react-ant-design/navigation-required-postgresql-ssl-dark.png)：滚动后 CA 证书标签的星号清楚可见，客户端证书仍为可选；输入和底部保存／取消操作均可达。减少动态效果下首次进入不播放内容动效，面包屑悬浮背景即时生效，不保留过渡动画。

本次浏览器验收不连接真实数据库，也不证明 Tauri 原生安装或 PostgreSQL 真库行为。调试中生成的 `navigation-failure-light.png` 为中间失败样本，最终结果以本节链接的成功截图和报告为准。

## 2026-10-17：完整便携包原生复核

根目录完整打包成功后，直接解压本次便携 ZIP 运行原生验收，10 项通过、错误 0，
见[成品报告](../package-native/native-client-ui-qa.json)。已查看本次
[成品浅色](../package-native/screenshots/react-ant-design/native-client-light.png)与
[成品深色](../package-native/screenshots/react-ant-design/native-client-dark.png)截图，
空工作区、导航、主题及布局正常；减少动态效果下弹窗输入／关闭、宿主参数校验、
版本删除及重启状态保留通过。本次使用包内 Java 和引擎，独立资料目录，区别于下条
调试程序验收；真实数据库 smoke、资源摘要及未做干净安装的范围见[验证记录](README.md)。

## 2026-10-17：统一切换、模板选表与历史管理

生产前端的新增交互专项在浅色／深色下通过 12 项检查，控制台错误 0，报告见[关联交互验收](../interaction-revisions-ui-qa.json)。覆盖不同表身份及结构页签切换、系统减少动态效果、连接草稿数据库下拉、模板结构／数据共用表格、备注编辑、删除确认展示已有备注／版本说明、输入完整标识删除、取消及版本删除保留记录。

已查看[浅色模板结构表格](../screenshots/react-ant-design/template-structure-selector-light.png)、[浅色连接数据库选择](../screenshots/react-ant-design/connection-database-select-light.png)、[深色最小窗口删除确认](../screenshots/react-ant-design/record-delete-confirmation-minimum-dark.png)与[浅色版本删除确认](../screenshots/react-ant-design/version-delete-confirmation-light.png)：模板仅显示当前类型列，表格内部滚动且保存按钮可达；连接选择与原页面草稿共存；1180 × 760 窗口的确认标识、备注、风险说明、取消和永久删除按钮均可辨识及操作，版本说明保留换行。模板截图聚焦滚动后的选表区域，表单顶部字段仍可向上滚动查看。

动效由公共组件重播，不重挂载表单；同对象刷新和输入不触发。页面切换、不同表／记录／版本的身份及局部页签统一管理，减少动态效果时关闭。浏览器只使用内存虚构资料。

补齐本地 Rust／MSVC 后，本次新构建的 Tauri 调试程序通过 10 项原生检查，错误 0，见[原生桌面报告](../native-client-ui-qa.json)。已查看本次[原生浅色](../screenshots/react-ant-design/native-client-light.png)与[原生深色](../screenshots/react-ant-design/native-client-dark.png)截图，窗口布局与主题一致。覆盖减少动态效果下弹窗输入／关闭、宿主参数边界、版本确认标识和重启持久化；使用独立资料目录及项目 Java 引擎，不代表完整分发包或干净 Windows 安装验收。实际工具链、真库和证明范围见[验证记录](README.md)。

## 2026-10-17 统一动效、连接密码与版本表格

公共按钮反馈、页面与详情切换、弹层和树分支共用 `desktop/src/motion.ts`。按预览反馈，
树分支和箭头最终缩短为 60 ms；分组忙碌提示结束保持展开列表引用稳定，避免虚拟树
提前中断短过渡。减少动态效果时关闭位移，弹窗仍可连续打开、输入和关闭。

版本列表拆分版本号、说明、同步记录、创建时间与操作列；详情使用独立标题、概要和
关联记录表格。预览包含关联两条记录的版本和空版本。记录列表统一称“编辑”，详情
顶栏移除编辑、删除；GitHub 仅保留设置页关于入口。编辑已有模板默认展示已选表。

表格溢出文字使用与测试连接提示相同的 Ant Design Tooltip，支持悬停和键盘聚焦。
已存密码在 password 控件内显示固定遮挡，表单实际值为空，保存保留真实凭据；新输入
才替换密码。端口或密码材料缺失阻止保存，版本号重复时就地提示并阻止提交。

已查看浅色版本列表与悬浮提示、深色版本详情和原生浅色截图，表格、摘要和按钮可辨识。
最终生产构建的动效专项浅色／深色均通过、错误为零；连接树 1000／5000 张表四组
回归通过，均仅挂载 28 行。短暂忙碌提示使用点击前观察，避免点击返回后漏检。

- [动效专项](../motion-interaction-ui-qa.json)
- [本轮全量 UI 独立报告](../motion-default-ui-qa.json)
- [浅色表格溢出提示](../screenshots/react-ant-design/motion-table-overflow-light.png)
- [深色版本详情](../screenshots/react-ant-design/motion-version-detail-dark.png)
- [已存密码遮挡](../screenshots/react-ant-design/motion-connection-saved-light.png)
- [原生宿主检查](../motion-native/native-client-ui-qa.json)

浏览器截图使用内存虚构资料。原生检查使用本次调试构建和隔离资料目录，不能替代
正式安装包或干净 Windows 安装验收；实际命令与范围见验证记录。

## 2026-10-16：多数据库预览范围复核

修复验收脚本在目标表清单尚未稳定时勾选 MySQL 表的时序，并将原先误在 PostgreSQL
阶段拍摄的 MySQL 范围截图移到实际 MySQL 范围步骤。重新构建前端后，八组 MySQL／
PostgreSQL、浅色／深色、1488／1180 宽度的浏览器虚构流程通过，控制台错误 0。
已查看[浅色 MySQL 范围](../screenshots/react-ant-design/multi-db-mysql-scope-light-1488.png)
与[深色最小窗口 MySQL 范围](../screenshots/react-ant-design/multi-db-mysql-scope-dark-1180.png)：
来源和目标均显示 MySQL，选中表、匹配键及底部操作可辨识、可达。浏览器预览只使用内存
数据；真实数据库验收与发布工作流另见[验证记录](README.md)。

## 2026-10-16：原生标题栏、页面动画与弹窗恢复

正式客户端使用 Windows 原生标题栏显示图标、名称和窗口按钮；页面内部移除重复的
DBAligner 品牌行，左侧导航、工作区与页面标题直接从内容区顶部开始。浏览器虚构预览在
顶部保留 32 px 的独立提示条，正式客户端不显示。浅色和深色原生 WebView 内容截图：
[浅色](../screenshots/react-ant-design/native-client-light.png)、
[深色](../screenshots/react-ant-design/native-client-dark.png)。截图由 WebView2 内容捕获，
不包含系统绘制的标题栏，因此标题栏按钮以原生窗口操作验收为准。

移除会中断 Ant Design 弹窗退出动画的全局“减少动态效果”强制规则，保留弹窗本身的
显示／退出动效；页面面包屑、标题和内容增加约 180 ms 入场动画。连续导航时曾因两个
同级元素使用相同 React key 留下重复面包屑，现用不同 key；差异长列表在
1488／1180／960 宽度和浅色／深色下均有可用高度。完整浏览器 UI 132 条检查、
减少动态效果下两次弹窗操作、原生打包客户端八项检查均通过，错误 0。用户已亲自在
调试窗口确认弹窗恢复流畅，并确认该版交互可用；后续完整安装包为同一修复与布局的重建。
验证范围和安装／更新限制见[验证记录](README.md)。
