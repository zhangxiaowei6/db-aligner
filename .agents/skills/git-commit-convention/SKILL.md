---
name: git-commit-convention
description: 创建、检查或拆分 Git 提交消息时使用中文 Conventional Commits。
---

# Git 提交规范

## 消息约定

格式为 `<type>[(scope)][!]: <中文描述>`。type、scope 用英文，主题、正文和说明用中文；主题表达实际结果，不以句号结尾。

- 功能／修复：`feat`／`fix`；文档／格式／重构／性能／测试：`docs`／`style`／`refactor`／`perf`／`test`；构建／CI／维护／回退：`build`／`ci`／`chore`／`revert`。
- scope 指实际模块，如 `desktop`、`engine`、`protocol`；可省略。纯文档和 skills 优先 `docs`。
- 破坏性变更同时用 `!` 与 `BREAKING CHANGE: 中文影响及兼容说明`，标识和路径保留原文。
- 每个提交单一目的，不混入无关格式或产物。示例：`docs: 整理文档目录并精简任务规范`。

## 提交前

1. 查看工作区及暂存区完整 diff，区分已有修改并按逻辑拆分，核对[贡献规范](../../../CONTRIBUTING.md#开发与提交)。
2. 检查秘密、真实会话、本地数据库、档案、工具和安装包；按[测试指南](../../../docs/development/testing.md#检查组合)核对实际验证。
3. 拟定消息，检查 `git diff --cached`；提交前报告范围。
4. 仅拟定或检查消息时展示建议，明确要求提交后才运行 `git commit`；不自动包含推送和发布授权。

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/zh-hans/v1.0.0/)定义结构，上述类型及中文要求是项目约定，不替代审查和发布流程。
