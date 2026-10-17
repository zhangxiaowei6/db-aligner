# 文档整理检查清单

检查日期：2026-10-17。范围为全部 21 份项目 Markdown 和六份 skill 界面元数据；第三方原文、生成 JSON、截图、代码与运行资料仅核对引用或变更边界，不重写。

## 原有文档逐篇去向

| 原位置                                          | 处理       | 当前入口                                                    | 检查及归属                                               |
| ----------------------------------------------- | ---------- | ----------------------------------------------------------- | -------------------------------------------------------- |
| `README.md`                                     | 重写       | [文档](../../README.md)                                     | 中文产品介绍、截图、下载、快速上手，工程细节移入开发文档 |
| `AGENTS.md`                                     | 压缩       | [文档](../../AGENTS.md)                                     | 公共硬约束、任务索引；详细规则与命令按需链接             |
| `CONTRIBUTING.md`                               | 重组       | [文档](../../CONTRIBUTING.md)                               | 开发提交、格式、文档职责和联动                           |
| `CHANGELOG.md`                                  | 重组与归档 | [文档](../../CHANGELOG.md)                                  | 当前用户变化；原迁移说明保留到归档                       |
| `SECURITY.md`                                   | 重组       | [文档](../../SECURITY.md)                                   | 私密渠道、报告脱敏、资料处置、更新与两类签名             |
| `THIRD_PARTY_NOTICES.md`                        | 重组       | [文档](../../THIRD_PARTY_NOTICES.md)                        | 组件、驱动、运行时、再分发；保留原许可语义               |
| `design-qa.md`                                  | 移动与归档 | [文档](design-qa.md)                                        | 当前 Tauri 视觉记录按日期；早期批次完整归档              |
| `docs/user-guide.md`                            | 移动与合并 | [文档](../guide/user-guide.md)                              | 多数据库、资源更新、历史编辑并入操作流程                 |
| `docs/limitations.md`                           | 移动与重组 | [文档](../guide/limitations.md)                             | 按对象、结构、数据、风险、恢复、权限及未验收组织         |
| `docs/architecture.md`                          | 移动与重组 | [文档](../reference/architecture.md)                        | 进程、适配、比较执行、核验恢复、本地资料、更新           |
| `docs/protocol.md`                              | 移动与重组 | [文档](../reference/protocol.md)                            | 通信基础先行，接口与模型按职责分章                       |
| `docs/interaction-guidelines.md`                | 移动与重组 | [文档](../reference/interaction-guidelines.md)              | 通用、布局、表单、反馈、业务及预览；保留细则             |
| `docs/performance.md`                           | 移动与重写 | [文档](../reference/performance.md)                         | 当前显示、列表、Rust 通信及待测热点；日期性分析归档      |
| `docs/releasing.md`                             | 移动与重组 | [文档](../development/releasing.md)                         | 当前 CI、签名、草稿和验收；纠正无签名命令及附件说明      |
| `docs/validation.md`                            | 移动与归档 | [文档](README.md)                                           | 当前日期记录与索引，原批次和发布准备归档                 |
| `.agents/skills/frontend-development/SKILL.md`  | 压缩       | [文档](../../.agents/skills/frontend-development/SKILL.md)  | 保留触发与专项流程；按相关章节阅读，公共检查集中维护     |
| `.agents/skills/protocol-change/SKILL.md`       | 压缩       | [文档](../../.agents/skills/protocol-change/SKILL.md)       | 保留触发与专项流程；按相关章节阅读，公共检查集中维护     |
| `.agents/skills/sync-safety/SKILL.md`           | 压缩       | [文档](../../.agents/skills/sync-safety/SKILL.md)           | 保留触发与专项流程；按相关章节阅读，公共检查集中维护     |
| `.agents/skills/verification/SKILL.md`          | 压缩       | [文档](../../.agents/skills/verification/SKILL.md)          | 保留触发与专项流程；按相关章节阅读，公共检查集中维护     |
| `.agents/skills/windows-packaging/SKILL.md`     | 压缩       | [文档](../../.agents/skills/windows-packaging/SKILL.md)     | 保留触发与专项流程；按相关章节阅读，公共检查集中维护     |
| `.agents/skills/git-commit-convention/SKILL.md` | 压缩       | [文档](../../.agents/skills/git-commit-convention/SKILL.md) | 保留触发与专项流程；按相关章节阅读，公共检查集中维护     |

## 新增入口与历史保留

新增[文档导航](../README.md)、[开发指南](../development/README.md)、[测试指南](../development/testing.md)与本清单。历史记录集中到[归档目录](../archive/legacy-client/README.md)，包括验证、设计和原迁移／性能说明。

当前证据索引不默认加载历史原文。混合发布记录保留完整原文，当前入口仅摘录 Tauri 发布事实并链接来源。历史环境、命令、失败、哈希与未验收范围继续保留，原始报告和截图路径不变。

六份 `agents/openai.yaml` 均检查中文显示、说明、默认提示及与技能标识一致性，保持现有自动发现策略。第三方许可证原文、生成清单和 LICENSE／NOTICE 保留。

## 上下文压缩统计

按 UTF-8 解码、统一 LF 后的字符数统计 AGENTS.md 和六个 SKILL.md 正文文件，包含 frontmatter；不是 token 估计，不计按需引用的专题文档。

| 内容          | 整理前 | 整理后 |  减少 |
| ------------- | -----: | -----: | ----: |
| AGENTS.md     |  7,714 |  4,140 | 46.3% |
| 六个 SKILL.md | 16,523 |  7,483 | 54.7% |
| 合计          | 24,237 | 11,623 | 52.0% |

六个技能名称、默认提示及自动发现策略保留。公共硬约束仍集中在 AGENTS；命令在测试／开发指南维护，skills 按相关章节读取。

## 实际检查与边界

本次环境为 Windows x64、Node.js 22.22.2／npm 10.9.7、Python 3.13.7、Prettier 3.6.2、任务临时目录中的 PyYAML 6.0.3；实际检查环境不替代项目推荐工具链。

| 实际检查                                                                                                    | 结果与证明范围                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 逐篇审读与职责检查                                                                                          | 原有 21 份 Markdown、六份元数据全部纳入上表；整理后 29 份 Markdown                                                                          |
| Markdown AST 检查                                                                                           | 单一一级标题、连续标题层级、相对目标、图片和锚点均通过；仅本地完整性，不代表远程资源可用                                                    |
| 文本归并核对                                                                                                | 历史验证 369 段、历史设计 162 段在当前／归档联合内容中保留；协议 39 段、交互 123 段无遗漏。比较忽略标题、空白、表格分隔线及移动后的链接目标 |
| 现行关键词检查                                                                                              | 旧栈名称及失效宿主路径仅在历史归档中；现行说明和 skills 无匹配                                                                              |
| `node node_modules/prettier/bin/prettier.cjs --check "*.md" "docs/**/*.md" ".agents/skills/**/*.{md,yaml}"` | 退出 0，显式覆盖文档和全部技能元数据                                                                                                        |
| `python -X utf8 <skill-creator>/scripts/quick_validate.py <技能目录>`                                       | 六个技能逐个执行，6/6 退出 0；PyYAML 仅安装于本任务忽略目录，未修改项目依赖                                                                 |
| 元数据检查                                                                                                  | 六份中文说明、默认提示中的技能名及自动发现策略检查通过；未操作客户端技能选择器                                                              |
| `git diff --check` 与限定文档范围的差异检查                                                                 | 均退出 0                                                                                                                                    |
| 非文档基线哈希                                                                                              | 本次开始记录的 1,430 个代码、报告、截图、清单等非文档文件全部未变；另核对 47 份第三方 Markdown 原文，字节一致                               |

修正了现行文字与已存在实现不一致的三处口径：普通无签名构建使用 `dist:unsigned`；密码保存不能清除必需的凭据材料；MySQL 分批／隐式 DDL 提交与 PostgreSQL 每目标事务分别描述。签名说明区分 Tauri 更新签名与 Windows 代码签名，MySQL 字符串和权限规则不扩大到 PostgreSQL。没有修改对应实现。

全仓旧路径检索只剩本清单的迁移来源及归档中的历史说明，现行有效引用已更新。许可证原文、JSON 和截图保持原内容；检查工具、基线和临时校验依赖放在忽略目录。

本次没有运行业务测试、数据库回归、UI、完整打包或安装验收，没有刷新生成报告，也没有创建提交、推送或发布。历史远程链接保留原日期，未联网重新核验 Release、Artifact 或下载状态。
