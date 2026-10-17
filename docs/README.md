# 文档导航

按阅读目的选择入口；只读当前任务相关章节。现行规则与带日期的验证证据分别维护，历史结果不作为本次通过证明。

## 用户指南

- [使用指南](guide/user-guide.md)：安装、连接、同步、历史及恢复的操作顺序。
- [支持范围与限制](guide/limitations.md)：MySQL／PostgreSQL 能力、风险、权限、恢复和未验收项。
- [项目首页](../README.md)、[更新记录](../CHANGELOG.md)、[安全报告](../SECURITY.md)。

## 开发与贡献

- [开发与本地构建](development/README.md)：环境、启动、完整打包、产物及资料目录。
- [测试与验收](development/testing.md)：按影响选择命令，区分预览、真库、原生、打包和安装。
- [GitHub 构建与发布](development/releasing.md)：CI、签名、草稿、附件及人工验收。
- [贡献说明](../CONTRIBUTING.md)：提交、格式和文档规范；[代理约定](../AGENTS.md)与[项目 skills](../.agents/skills)。

## 技术参考

- [架构与证据模型](reference/architecture.md)：进程、适配器、比较、执行与本地恢复。
- [本地协议](reference/protocol.md)：消息、接口、事件、模型及兼容。
- [交互规范](reference/interaction-guidelines.md)：组件、布局、导航、表单、反馈和业务流程。
- [性能排查](reference/performance.md)：显示与列表保护、当前通信入口和待量化热点。

## 验证与归档

- [验证记录](validation/README.md)：按日期保存当前客户端的实际命令、环境、结果和限制。
- [设计 QA](validation/design-qa.md)：按日期保存视觉复核及截图。
- [本次文档整理检查清单](validation/documentation-review.md)：逐篇去向、压缩统计及本次检查范围。
- [历史客户端归档](archive/legacy-client/README.md)：完整历史批次、原型对照和迁移说明。

## 目录约定

```text
docs/
  README.md
  guide/          用户操作与支持范围
  development/    开发、测试与发布
  reference/      架构、协议、交互与性能
  validation/     当前验证记录、设计 QA 与文档检查
  archive/        历史记录和迁移原文
  screenshots/    验收脚本生成的截图
  *.json          现有验收脚本约定的报告路径
```

截图、报告及专项资源目录由脚本维护，本次不移动、不重新生成。`licenses`、根许可证和第三方原文按法律及生成规则保留，见[第三方说明](../THIRD_PARTY_NOTICES.md)。
