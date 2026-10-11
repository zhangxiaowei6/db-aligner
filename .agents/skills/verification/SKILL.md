---
name: verification
description: 为本仓库的修改选择验证组合、执行检查并记录证据时使用，区分文档、默认测试、界面预览、真库回归、打包客户端与安装验收的证明范围。
---

# 修改验证与证据记录

## 适用任务

用于开发后的验证、已有结果复核、验收报告和技能文档检查。
按实际修改范围选择命令，纯文档修改不因此连接数据库、启动 UI 或完整打包。

## 阅读入口

- 先读[仓库约定](../../../AGENTS.md)、[贡献说明](../../../CONTRIBUTING.md)与[README](../../../README.md)；文档合并、删除和证据维护遵循[文档规范](../../../CONTRIBUTING.md#文档规范)。
- 命令来源：[根 package.json](../../../package.json)、[桌面 package.json](../../../desktop/package.json)、[Maven 入口](../../../scripts/mvn.ps1)与[引擎构建配置](../../../engine/pom.xml)。
- 真库工具：[实例启动](../../../scripts/mysql-test-server.ps1)、[实例停止](../../../scripts/mysql-test-stop.ps1)与[集成测试目录](../../../engine/src/test/java/io/datasync)。
- UI 工具：[ui-qa.mjs](../../../desktop/scripts/ui-qa.mjs)、[tree-qa.mjs](../../../desktop/scripts/tree-qa.mjs)；结果说明见[验证记录](../../../docs/validation.md)和[设计 QA](../../../design-qa.md)。

## 操作流程

1. 检查本次 diff，分清已有修改，记录实际 Node、npm、Java、数据库与浏览器环境；推荐 Node.js 24／npm 11 不等于当前实测环境。
2. 按下表选择验证组合。多种影响叠加要求，文档中描述某功能不等于修改该功能的实现。

| 修改范围                     | 必要检查与前置条件                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 纯文档或技能说明             | 核对事实、命令、相对链接及格式；技能检查 frontmatter、元数据和任务选择边界。无需业务测试。                                             |
| 前端、Electron 或引擎代码    | `npm run typecheck`、`npm test`，追加受影响行为的验证。默认引擎测试跳过真库入口，须如实记录。                                          |
| UI 行为                      | 先 `npm run build`，再 `npm run qa:ui -w desktop`，查看相关浅色／深色截图并更新设计记录。                                              |
| 连接树规模、刷新或组织拖拽   | 按影响追加 `npm run qa:tree -w desktop` 或 `npm run qa:ui -w desktop -- --tree-organization`。                                         |
| 原生窗口、桌面外观或桥接     | 准备前端／Electron 与可用引擎构建，运行 `npm run qa:desktop -w desktop`，使用隔离资料目录。                                            |
| 数据库比较、执行、归档或回滚 | 必须运行下述三个版本的隔离真库回归，不能由模拟对象或浏览器预览替代。                                                                   |
| 打包客户端功能               | 先根目录 `npm run dist`，再启用 `datasync.electron.smoke`；当前测试代码只在 8.4.8 分支启动原生客户端，不能声称三个版本都做了原生验收。 |
| 安装／升级发布               | 完成干净 Windows 安装验收；本机原生 smoke 与打包成功不能替代。                                                                         |
| 添加依赖                     | 更新锁文件、第三方说明，运行 `npm run licenses`，核对驱动独立分发和许可材料。                                                          |

3. 检查每条命令退出码和测试报告中的失败、错误与跳过。失败后修复并重跑受影响检查；未再次完整通过时不能报告完整套件通过。
4. 更新本次验证记录，保留历史条目的日期、环境和证明范围；交付通过项、跳过项及原因。

## 关键约束

所有命令从仓库根目录运行；实际版本与脚本保持一致。三版本真库命令为：

```powershell
./scripts/mysql-test-server.ps1 -Version 5.7.44 -Port 33957
./scripts/mysql-test-server.ps1 -Version 8.0.45 -Port 33980
./scripts/mysql-test-server.ps1 -Version 8.4.8 -Port 33984
try {
  ./scripts/mvn.ps1 test '-Ddatasync.mysql.versions=5.7.44,8.0.45,8.4.8'
  if ($LASTEXITCODE -ne 0) { throw '三版本真库回归失败' }
} finally {
  ./scripts/mysql-test-stop.ps1
}
```

测试只使用 `.tools/mysql-test` 内绑定 `127.0.0.1` 的项目实例和随机 `ds_it_*` 数据库，不注册服务。
启动失败时检查已启动实例并用项目停止脚本清理；不能连接或停止其他用户数据库进程。
SSL 回归的 OpenSSL 探测位置以启动脚本为准，当前为 `D:/Git/usr/bin/openssl.exe`，缺失时不能声称 SSL 已验证。

打包客户端测试在完成 `npm run dist`、启动隔离实例后运行：

```powershell
./scripts/mvn.ps1 test '-Ddatasync.mysql.versions=5.7.44,8.0.45,8.4.8' '-Ddatasync.electron.smoke=true'
```

执行结束用项目停止脚本清理隔离实例。`DATA_SYNC_HOME` 隔离资料；测试随机凭据、SQL 档案和 SQLite 不提交。
浏览器开发预览使用 4173，生产 UI QA 使用 4183，树 QA 使用 4184；不要占用同一端口并行启动实例。

## 验证与交付

- 普通格式范围由 `npm run format:check` 决定；该命令当前不覆盖技能目录。新增技能显式使用本地 Prettier：`node node_modules/prettier/bin/prettier.cjs --check .agents/skills`。
- 每个技能用当前环境可用的 `skill-creator/scripts/quick_validate.py` 验证；另查 `agents/openai.yaml` 的中文字符串、默认提示、相对链接和未完成占位内容。不要为验证技能向项目添加业务依赖。
- 结果列出实际命令、版本、退出码、失败／错误／跳过、报告位置及限制；将虚构预览、真库、原生功能和干净安装分别表达。
- 纯文档修改不刷新数据库或 UI 报告冒充本次验收；测试计数不能代替实际场景覆盖说明。
- 技能文件格式有效不等于客户端已发现；仅在实际查看技能目录或选择器后报告发现状态。
