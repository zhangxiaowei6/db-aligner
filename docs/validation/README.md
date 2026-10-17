# 验证记录

本文件按日期保存当前 Tauri 客户端的实际验证。历史客户端、迁移候选和早期引擎批次见[历史验证归档](../archive/legacy-client/validation.md)，日期、失败和证明范围继续保留。发布准备过程也在归档中。

## 证据索引

| 需要核对               | 入口与边界                                                            |
| ---------------------- | --------------------------------------------------------------------- |
| 默认测试、真库与构建   | 下方带日期的实际命令；执行方法见[测试指南](../development/testing.md) |
| 浏览器与原生界面       | [设计 QA](design-qa.md)及各条目报告，预览结果不证明真实数据库行为     |
| 完整便携包资源与 smoke | 2026-10-17 完整本地打包条目                                           |
| 正式发布               | 2026-10-16 发布事实；后续远程状态需重新核实                           |
| 文档重整               | 本次纯文档检查条目及[逐篇检查清单](documentation-review.md)           |

同名 JSON 与截图保存对应最近一次输出，可能已覆盖，不能当作所有历史运行的独立快照。历史环境和测试计数不作为推荐环境或当前通过结果。

## 2026-10-18：0.1.1 发布前完整回归

本轮将维护者已验收的当前修改准备为 `0.1.1`，同步根、桌面、Tauri、Cargo、引擎及锁文件版本。
环境为 Windows x64、Node.js 24.9.0／npm 11.6.0、Temurin 21.0.12.1、Maven 3.9.11、
Rust／Cargo 1.99.1、项目 MSVC x64 开发环境及 Chrome 155.0.8059.84。

| 实际命令或检查                                                                                                                               | 结果                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `npm run typecheck`、`npm run release:check`                                                                                                 | 均退出 0，版本与更新记录一致                                                          |
| 完整 `npm test`                                                                                                                              | 前端 26 文件、259 项通过；引擎 42 项、失败 0、错误 0、默认跳过 4                      |
| `cargo fmt --check`、`cargo check --locked`、`cargo test --locked`                                                                           | 均通过；宿主 16 项通过、真实引擎生命周期入口 1 项默认忽略                             |
| `npm run format:check`、文档及 skills 显式 Prettier、六个技能结构校验                                                                        | 均通过；29 份 Markdown 的 483 个相对链接、图片及锚点检查通过                          |
| `npm run build`、`npm run qa:ui -w desktop`                                                                                                  | 生产前端构建及完整浏览器 132 项检查通过，错误 0                                       |
| UI `--navigation`、`--interaction-revisions`、`--motion` 专项及 `qa:tree`                                                                    | 分别通过 2、12、2、4 组检查，错误 0；树覆盖浅深主题与 1,000／5,000 表，每组挂载 28 行 |
| 根目录 `npm run dist:unsigned`                                                                                                               | 退出 0，重新构建本次引擎、前端、宿主、运行时、许可及 NSIS／完整便携 ZIP               |
| `npm run qa:desktop -w desktop`                                                                                                              | 从本次便携 ZIP 解压运行，13 项通过、错误 0，使用独立临时资料和随包 Java               |
| `./scripts/mvn.ps1 test '-Ddbaligner.mysql.versions=5.7.44,8.0.45,8.4.8' '-Ddbaligner.postgresql.test=true' '-Ddbaligner.native.smoke=true'` | 48 项通过，失败／错误／跳过均为 0，完成于北京时间 00:50:52                            |

真库仅使用项目 `.tools` 内绑定 `127.0.0.1` 的 MySQL 5.7.44／8.0.45／8.4.8 和
PostgreSQL 17.11，以及随机 `ds_it_*` 数据库；OpenSSL 3.2.4 检查通过，结束后项目停止脚本
已关闭本次四个隔离实例。MySQL 原生客户端 smoke 在 8.4.8 分支运行；PostgreSQL 原生
覆盖首次驱动准备、缓存复用及同进程双驱动。新报告见[MySQL 原生](../native-client-smoke-result.json)、
[PostgreSQL 首次](../postgresql-native-client-smoke.json)、[缓存复用](../postgresql-native-client-cached-smoke.json)
及[便携包原生 UI](../package-native/native-client-ui-qa.json)。

独立打开 ZIP 核对 1,218 个条目，其中 1,147 个文件摘要与暂存副本一致；关键程序、引擎、
Java、驱动源码及许可核对通过，未发现本地资料、SQLite 或凭据路径，清单摘要全部匹配。
[打包资源报告](../package-qa.json)记录本次本地无签名产物：

| 产物                                | 大小（字节） | SHA-256                                                            |
| ----------------------------------- | -----------: | ------------------------------------------------------------------ |
| `DBAligner-Setup-0.1.1-win-x64.exe` |   61,186,211 | `67c5243c9fa4c2f65f3655b3bb6d93b2a939792b4705fcfbdbd5e94c50a8402c` |
| `DBAligner-0.1.1-win-x64.zip`       |   67,549,304 | `1778866c78171515300246b984c723f149e8986efaa22cbfd5ca0dab370d9179` |

中间失败如实保留：首次并行负载下两个前端用例超过原 15 秒限时，单独重跑后在原限时内通过，
随后完整默认测试重跑通过。沙箱内引擎测试因临时目录原子改名和 junction 创建权限失败，
获准在正常环境重跑后通过。交互专项两处中文按钮定位未兼容 Ant Design 的自动空格，修正
“编辑”“保存”的空白匹配后，保留原业务断言并完整重跑浅深主题通过。Vite 仍有大包体提示，
jsdom 仍有 CSS 解析告警；实际浏览器检查错误为 0。

维护者在本次对话明确确认已验收并授权直接公开发布。本条没有独立执行干净 Windows 安装或
两个递增正式版本间真实自动更新；远程签名构建、附件核验与公开结果另行记录，不将本地无签名
产物作为正式 Release 附件。

## 2026-10-18：便携 ZIP 许可证时间戳修复

修复 `scripts/release-files.ps1` 在 Windows PowerShell `Compress-Archive` 下处理早于
1980 年的依赖许可证时间戳失败的问题。压缩前仅调整便携包暂存副本的越界修改时间，
下限为 1980-01-01，上限为 2107-12-31 23:59:58；源文件和文件内容保持不变。
开发指南补充该行为和仅整理阶段失败时的无签名重试命令。

实际环境为 Windows x64、Node.js 22.22.2、npm 10.9.7、Windows PowerShell
5.1.26100.9711、项目 Temurin 21.0.12.1。`npm run release:files -- -Unsigned`
退出 0，复用本次用户已构建的 0.1.0 主程序、安装包与引擎，未重新执行完整构建。
中间验证因保存脚本时遗漏 UTF-8 BOM 出现解析错误，已恢复 BOM 和 CRLF；随后旧
便携目录中的 JAR 被运行程序占用，用户关闭程序后重试成功。

独立打开 ZIP 核对全部 1,218 个条目，其中 1,147 个文件的 SHA-256 均与暂存副本
一致；35 个源许可证仍保留早于 1980 年的修改时间，内容与暂存副本一致，暂存目录
越界时间戳为 0。未发现本地资料、SQLite、凭据或私钥路径，`SHA256SUMS.txt`
所列摘要全部匹配。

| 本次整理产物                        | 大小（字节） | SHA-256                                                            |
| ----------------------------------- | -----------: | ------------------------------------------------------------------ |
| `DBAligner-Setup-0.1.0-win-x64.exe` |   61,183,372 | `fff3ba2cd413539356077a418a0a1d5a4a6a02cae6a198ff893e9e4f64eeb668` |
| `DBAligner-0.1.0-win-x64.zip`       |   67,549,533 | `bfcb40bd038e8adfc92c1b5fbb32d1806bb99c4518e3851aebde1a6ac436620d` |

本次未执行真库、原生 smoke、干净 Windows 安装、升级或远程发布，不将发布资料
整理通过描述为完整构建或客户端验收通过。

`npm run typecheck` 退出 0；两个本次修改文档的显式 Prettier 检查和
`git diff --check -- scripts/release-files.ps1` 通过。
`npm test` 的前端阶段通过，存在 jsdom CSS 和伪元素计算样式告警；引擎阶段首次在
沙箱中因临时目录重命名及 Windows junction 权限失败，42 项中失败 1、错误 3、跳过
4，根命令退出 1。普通 Windows 权限下单独重跑 `npm run engine:test` 退出 0，
42 项中失败／错误均为 0、跳过 4；默认跳过的集成入口不作为真库或更新验收。

## 2026-10-17：全量文档、目录与任务规范整理

本轮仅修改文档与六个技能的元数据，以已有未提交内容为基础。全部原有 21 份项目 Markdown 和六份元数据逐篇检查，专题说明按用户、开发、技术参考、验证与历史归档分组，README 改为中文产品展示入口。

历史验证与设计批次原文移入归档，日期、命令、失败、哈希和未验收范围保留；当前协议与交互规则归并核对无遗漏。现行文档清除旧栈表述，补正无签名构建、两种数据库提交模型和密码保存的说明。没有修改功能实现或重新运行历史验收。

实际环境为 Windows x64、Node.js 22.22.2／npm 10.9.7、Python 3.13.7，临时 PyYAML 6.0.3 仅用于技能校验。29 份 Markdown 的标题、链接和锚点检查通过；文档及 skills 的显式 Prettier、六个技能的 quick_validate、元数据和差异空白检查通过。AGENTS 与六个 SKILL.md 合计字符数由 24,237 减至 11,623，减少 52.0%。

开始时记录的 1,430 个非文档文件哈希均未改变，另核对 47 份第三方 Markdown 原文，字节一致，包含代码、截图、报告、清单和许可原文。逐篇去向、命令及统计见[文档检查清单](documentation-review.md)。未运行业务测试、真库、UI、完整打包或干净安装，未刷新生成报告，未提交、推送或发布；历史远程状态未联网复验。

## 2026-10-17：页面路径、面包屑首次进入与表单必填标记

本次在已有未提交修改上完成前端导航与表单标记整理。实际环境为 Windows 11 x64、Node.js 22.22.2、npm 10.9.7、项目内 Java 21.0.12.1／Maven 3.9.11，UI 使用 Chrome 155.0.8059.84；这不是将当前环境替代 README 推荐的 Node.js 24／npm 11。

| 实际命令                                                                                      | 结果与证明范围                                                                                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                           | 退出 0，前端类型检查通过。                                                                                       |
| `npm test`                                                                                    | 退出 0，前端 26 个文件、259 项全部通过；引擎 42 项、失败 0、错误 0、跳过 4。默认跳过的真库入口不作为数据库验收。 |
| `npm run format:check`、`git diff --check`                                                    | 退出 0，格式与本次修改的空白检查通过。                                                                           |
| `npm run build`                                                                               | 退出 0，生产前端构建通过；仍有大于 500 kB 的 chunk 提示。                                                        |
| `npm run qa:ui -w desktop`                                                                    | 退出 0，132 项检查、错误 0；报告为 [完整浏览器 UI](../react-ui-qa.json)。                                        |
| `npm run qa:ui -w desktop -- --navigation`                                                    | 退出 0，浅色／深色两组通过、错误 0；报告为 [面包屑与表单](../navigation-ui-qa.json)。                            |
| `npm run test -w desktop -- src/connection-validation.test.ts src/components/shared.test.tsx` | 退出 0，19 项通过；覆盖条件密码必填、默认值、复合字段的标签及 required 语义。                                    |
| `./scripts/mvn.ps1 test '-Ddbaligner.mysql.versions=5.7.44,8.0.45,8.4.8'`                     | 退出 0，48 项、失败 0、错误 0、跳过 1；跳过项为 PostgreSQL 真库入口。                                            |

MySQL 真库使用项目启动脚本分别在 33957／33980／33984 启动 `.tools/mysql-test` 下的 5.7.44、8.0.45、8.4.8 隔离实例，仅连接 `127.0.0.1` 并使用随机 `ds_it_*` 数据库。OpenSSL 3.2.4 检查通过；运行后由项目停止脚本清理本次拥有的三个实例。首次沙箱运行因本机套接字与临时档案重命名权限失败，清理阶段也受 CIM 权限限制；获准在沙箱外重跑后完成上述成功结果。

导航专项验证项目后的祖先与末级均可点击、记录列表和版本来源分支、回滚重新校验、列表及设置首次进入初始化、导入清空、过期请求不覆盖新页面、Enter／Space、减少动态效果、长项目名及最小窗口。面包屑为交互文本，实测 padding／margin 均为 0、文字高度 22px，悬浮前后宽高和颜色保持一致，悬浮有淡色背景；减少动态效果下背景 transition-duration 为 0s。专项另外断言没有自动提交 `sync.save` 或 `rollback.execute`。

必填项复核包含已有默认值、新建与编辑密码差异、PostgreSQL 初始数据库及 SSL CA、版本新建／追加、删除确认标识和导入行密码。宿主暂存密码、更新时保留的已存密码及跳过的重复连接不误标；需要新密码的已选行填入后仍保留星号。截图及视觉复核见 [设计 QA](design-qa.md#2026-10-17页面路径文字面包屑与必填标记)。

中间验证保留以下边界：早期前端运行遇到表格文字嵌套后的旧定位断言，按当前可访问角色复核通过；新增异步导入样例最初因默认跳过重复连接而未实际发起保存，改为“另存新连接”后通过。已有连接表单生命周期用例中途超过其原有 15 秒限制，限定弹窗查询范围并改为单次输入事件后，保持原断言和超时不变，单项约 5 秒通过。UI 专项调试修正了虚拟下拉隐藏节点的定位；完整 UI 中间一轮因 4183 连接拒绝中断，随后顺序独占端口重跑通过 132 项。`navigation-failure-light.png` 仅是中间失败样本，不作为最终成功截图。

浏览器验收只使用内存虚构资料；本次未做 Tauri 原生客户端、完整打包、干净 Windows 安装或 PostgreSQL 真库验收。Vitest 日志中的 jsdom CSS 解析告警与实际 Chrome UI 结果分开记录，不能将预览成功作为真实数据库执行证明。

## 2026-10-17：当前修改的 Windows 完整本地打包

在此前同日交互修正完成后，按维护者要求从根目录执行 `npm run dist:unsigned`，
退出 0。版本保持清单中的 `0.1.0`，包含当前工作区未提交的修改；没有远程发布。
环境沿用下条记录的 Node 24.9.0／npm 11.6.0、Temurin 21.0.12.1、Maven 3.9.11、
Rust 1.99.1、MSVC 19.44 和 Windows SDK 10.0.26100，并加载官方 MSVC 开发环境。

完整命令重新构建 Java 引擎、前端、Java 运行时、许可清单及 release 模式 Tauri
主程序，再由 NSIS 生成安装包，并整理完整便携 ZIP。Java 默认 40 项无失败／错误、
4 项集成入口按默认配置跳过。前端有已有体积提示；ZIP 压缩将部分许可文件早于 1980 年
的时间戳映射到 ZIP 支持的起始日期，未改变文件内容，命令最终成功。

| 本次产物                                    | 大小（字节） | SHA-256                                                            |
| ------------------------------------------- | -----------: | ------------------------------------------------------------------ |
| `release/DBAligner-Setup-0.1.0-win-x64.exe` |   61,174,866 | `4aefd252d5ca2999548b3eabd012d9593597d580e0fb2b2f646851e8da92be92` |
| `release/DBAligner-0.1.0-win-x64.zip`       |   67,540,208 | `48044a71b3826967807bdd0305aaacc30741492a38edef9bbe6b9369b654f5ca` |

独立打开 ZIP 核验 1,218 个条目，主程序、引擎、MariaDB 驱动、Java 可执行文件、
驱动源码及许可等关键文件的 SHA-256 与本次源产物一致，Java legal 文件存在，
未发现本地资料、数据库、凭据或私钥路径；`release/SHA256SUMS.txt` 全部匹配，
随附 Java `--version` 正常。机器可读结果见[打包资源核验](../package-qa.json)。

清除 `DB_ALIGNER_QA_APP` 后运行 `npm run qa:desktop -w desktop`，直接从本次 ZIP
解压运行，独立临时资料目录下 10 项通过、错误 0，见[成品便携包原生报告](../package-native/native-client-ui-qa.json)
与[设计 QA](design-qa.md)。

另运行 `./scripts/mvn.ps1 test '-Dtest=MySqlIntegrationTest,PostgresIntegrationTest'
'-Ddbaligner.mysql.versions=8.4.8' '-Ddbaligner.postgresql.test=true'
'-Ddbaligner.native.smoke=true'`，2 项通过、失败／错误／跳过均为 0，包含完整 ZIP
客户端的 MySQL 8.4.8 与 PostgreSQL 17.11 真库 smoke。子进程移除 `JAVA_HOME`、
限制 PATH，验证随包 Java、受限桥接、系统凭据保护、真实连接、比较、保存、执行、
导出与恢复，以及 PostgreSQL 驱动首次准备／缓存复用。仅使用项目绑定本机的隔离实例，
结束后使用停止脚本关闭。此前三版本 MySQL 引擎回归证据仍见下条，不能把本次 8.4.8
原生 smoke 扩大解释为三版本均做了成品客户端验收。

本次为本地无更新签名构建，未生成 `.exe.sig` 或 `latest.json`；没有执行干净
Windows 安装／卸载或真实自动更新，也未提交、推送或公开发布。

## 2026-10-17：统一交互、关联刷新与历史资料删除

环境为 Windows x64、项目目录内 Node.js 24.9.0／npm 11.6.0、Temurin
21.0.12.1／Maven 3.9.11、Rust／Cargo 1.99.1。按维护者要求补齐环境：Rust 安装于
`.tools/cargo` 与 `.tools/rustup`，现有 `tauri.ps1` 自动使用它；微软 Build Tools 2022
17.14.42 安装于 `C:/BuildTools`，包含 MSVC 19.44.35229 和 Windows SDK
10.0.26100。SDK 沿用机器原有登记目录 `G:/Windows Kits/10`。安装器退出 0，无需重启；
没有安装完整 Visual Studio IDE，也未修改系统 PATH 或全局 Rust 默认工具链。

| 实际检查                                                                                                                              | 本次结果与证明范围                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                                                                                   | 退出 0                                                                                                                     |
| `npm test`                                                                                                                            | 前端 21 文件、227 项通过；引擎默认 40 项，失败／错误 0，四个集成入口按默认配置跳过                                         |
| `npm run format:check`                                                                                                                | 退出 0；另执行修改 Java 文件的 Google Java Format 1.28.0 与 Rust 格式检查                                                  |
| `npm run build`                                                                                                                       | 前端生产构建成功；存在大于 500 kB 的已有体积提示，不代表原生构建                                                           |
| `npm run engine:build`、`npm run runtime`                                                                                             | Java 引擎打包及精简运行时生成成功；原生验收前以 `./scripts/mvn.ps1 package -DskipTests` 再生成当前引擎，测试结果见其他条目 |
| `./scripts/mvn.ps1 test '-Ddbaligner.mysql.versions=5.7.44,8.0.45,8.4.8' '-Ddbaligner.postgresql.test=true'`                          | 46 项，失败／错误／跳过均为 0；使用 `.tools` 内绑定本机的隔离 MySQL 三版本与 PostgreSQL 17.11，完成后已停止这些实例        |
| `npm run qa:ui -w desktop`                                                                                                            | 132 项，控制台错误 0，见[完整浏览器验收](../react-ui-qa.json)                                                              |
| `npm run qa:ui -w desktop -- --interaction-revisions`                                                                                 | 12 项，控制台错误 0，见[新增交互专项](../interaction-revisions-ui-qa.json)；包含记录备注和版本说明的删除确认               |
| `npm run qa:ui -w desktop -- --tree-organization`                                                                                     | 8 项，控制台错误 0，见[连接组织验收](../tree-organization-qa.json)                                                         |
| `cargo check --manifest-path desktop/src-tauri/Cargo.toml --locked`                                                                   | 退出 0，使用新 Rust 和官方 MSVC 开发环境                                                                                   |
| `cargo test --manifest-path desktop/src-tauri/Cargo.toml --locked`                                                                    | 14 项通过、0 失败、1 项默认忽略                                                                                            |
| `cargo test --manifest-path desktop/src-tauri/Cargo.toml --locked real_java_engine_uses_one_line_json_and_graceful_exit -- --ignored` | 显式运行上述默认忽略的真实 Java 通信测试，1 项通过、0 失败                                                                 |
| `../node_modules/.bin/tauri.cmd build --debug --no-bundle --config src-tauri/tauri.unsigned.conf.json`（在 `desktop` 目录）           | 本次原生调试程序构建成功，无安装包                                                                                         |
| 指定本次 `target/debug/dbaligner.exe` 后运行 `npm run qa:desktop -w desktop`                                                          | 10 项通过、错误 0；独立临时资料目录，见[原生桌面验收](../native-client-ui-qa.json)                                         |

新增引擎测试覆盖标识不匹配、非空工作区／分组、失效资源提交、恢复父子证据保护、
版本删除保留记录及档案、共享计划保留、备注不改原始档案及新导出元数据、非法／共享
档案路径、Windows junction、SQLite 提交失败恢复、重启恢复暂存目录、文件占用后的
清理提示与重试。真库回归另外验证草稿不受旧数据库范围过滤，以及备注／删除资料不写入
目标数据库。前端新增测试覆盖公共动效、减少动态效果、失效引用协调、模板缺失表、
数据库发现失败回退、过期表请求与备注请求、删除失败保留弹窗和已有备注／说明展示。

浏览器验收使用生产前端与内存虚构资料，浅色／深色及最小窗口截图见
[设计 QA](design-qa.md)。调整了取消按钮选择器与减少动态效果的验收预期；首次并行
重负载下一个复杂 UI 单测超过 15 秒，将该测试限时调整为 30 秒后完整重跑。验收期间
曾因并行重建前端短暂出现资源 404，改为先完成构建再运行验收并重跑通过。

Rust 已执行 `cargo fmt --check`。环境补齐前，原 Cargo 1.83.0 因不支持依赖所需的
`edition2024` 退出 101，离线检查因缓存缺失失败。只安装新 Rust 后，实际编译又报
`link.exe` 缺失，确认需要 C++ Build Tools。安装 MSVC／SDK 并加载官方开发环境后，
上述检查与测试全部通过。原生验收覆盖本地页面、受限桥接、离线 MySQL 驱动、减少动态
效果下的弹窗输入／关闭、分组保存删除、备注与删除命令参数边界、版本完整标识校验及
记录数量保留、浅深主题与重启持久化。原生调试程序使用项目 JDK 与当前引擎；不能把它
称为完整便携包或安装版验收。没有构建完整安装包，没有执行干净 Windows 安装、发布或推送。

## 2026-10-17：统一交互、连接凭据与版本校验

本轮包含统一动效、连接保存必填复验、固定 GitHub 入口、模板默认筛选及记录／版本
表格交互。版本号按工作区去除首尾空格后校验唯一；预览与引擎既有写锁校验一致。
新增本地 SQLite 测试覆盖重复、编辑自身、跨工作区和并发创建，没有修改引擎执行逻辑。

环境为 Windows x64、Node.js 24.9.0／npm 11.6.0、项目 Java 21 工具链；树专项浏览器
为 Chromium 155.0.8059.84。命令从仓库根目录运行，结果如下：

- `npm run typecheck`、`npm run build` 通过，Vite 仍提示大于 500 kB 的包体。
- 完整 `npm test`：前端 26 个文件、257 项通过；引擎 42 项，零失败／错误、4 项默认
  跳过，完成于 2026-10-17 23:11:05 +08:00。最终提速后另跑树展开、页面过渡和溢出
  提示三个文件的 5 项测试，全部通过；最终构建也包含类型检查。
- Rust 格式、检查及调试构建通过；宿主测试 16 项通过、1 项真实引擎生命周期入口
  默认忽略。宿主依据真实加密凭据判断，页面 hasPassword 标记不能绕过必填要求。
- 全量 `npm run qa:ui -w desktop` 本轮 132 条检查通过、错误为零，独立报告为
  [motion-default-ui-qa.json](../motion-default-ui-qa.json)。该轮在最终 60 ms 调整前完成；
  从本轮原始输出保存独立报告，避免共享报告被其他验收覆盖，不称为最终参数的全量重跑。
- 最终构建后 `npm run qa:ui -w desktop -- --motion` 浅色／深色两组通过、错误为零，见
  [motion-interaction-ui-qa.json](../motion-interaction-ui-qa.json)。初次短动效验收暴露分组
  提示结束会打断虚拟树过渡，已稳定展开数组引用并重跑通过；同时在点击前观察短暂
  忙碌状态，保留实际过渡事件检查。
- 最终 `npm run qa:tree -w desktop` 浅色／深色各 1000／5000 张表四组通过，错误为零，
  每组仅挂载 28 行；规模、实测时间和键盘等检查见 [tree-qa.json](../tree-qa.json)。
  60 ms 指 CSS 过渡时长，不是包含查询和反馈的端到端耗时。
- 本次 Tauri 调试程序通过 CLI 构建本地资源后运行 `npm run qa:desktop -w desktop`，
  13 项检查通过、错误为零。覆盖固定仓库地址、端口与真实凭据复验、密码不回显、
  已存凭据保留、版本重复拒绝、主题和重启，见
  [motion-native/native-client-ui-qa.json](../motion-native/native-client-ui-qa.json)。

预览不连接数据库，本轮没有将默认跳过的真库入口称为真库回归通过。原生检查使用
隔离资料和本次调试程序；未做完整发布构建、干净安装、升级、远程发布或 Git 提交。

## 2026-10-16：Tauri 0.1.0 GitHub 正式发布

代码提交 `da7d6a3` 已推送到 `origin/master`，新建的 `v0.1.0` 标签指向该提交。
[主分支 CI](https://github.com/zhangxiaowei6/db-aligner/actions/runs/38804684124)
与[标签发布工作流](https://github.com/zhangxiaowei6/db-aligner/actions/runs/38804718478)
均成功。标签工作流通过 Node／Java 测试、完整签名构建、MySQL 与 PostgreSQL 浏览器交互、
MySQL 5.7.44／8.0.45／8.4.8 与 PostgreSQL 17 隔离真库及打包客户端验收，并生成六个
GitHub Release 附件。云端 `SHA256SUMS.txt` 与各附件的 GitHub SHA-256 摘要一致；下载的
`latest.json` 与 `.exe.sig` 签名文本一致，版本和 Latest 下载链接正确。

| GitHub 构建产物                     | 大小（字节） | SHA-256                                                            |
| ----------------------------------- | -----------: | ------------------------------------------------------------------ |
| `DBAligner-Setup-0.1.0-win-x64.exe` |   61,160,583 | `44996bf3efeb70c370adf2e997d6c4927acb5e9e1d6a521e642ba4a08492f3bf` |
| `DBAligner-0.1.0-win-x64.zip`       |   67,522,410 | `30640551a3855e19991dc35dab41e1255abdd346147f29d9fb081e1299623780` |

[DBAligner 0.1.0](https://github.com/zhangxiaowei6/db-aligner/releases/tag/v0.1.0)
于北京时间 2026-10-16 05:05:34 公开发布，当时被 GitHub 标记为 Latest。维护者确认本地已验收；本记录没有独立的干净 Windows 安装或两个 Tauri 版本间真实自动更新证据。

完整发布过程和此前系列清理事实见[历史发布原文](../archive/legacy-client/validation.md#2026-10-16tauri-010-github-正式发布)。
