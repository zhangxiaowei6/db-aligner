---
name: windows-packaging
description: 在 Windows x64 构建或核验本仓库安装包时使用，完成项目工具链、两端构建、运行时和许可整理，确认本次产物及安装验收边界。
---

# Windows 构建与打包

## 适用任务

用于完整打包、构建失败排查、安装包资源核验与发布准备。
纯文档和普通 UI 修改不要求完整打包；远程发布、代码签名和破坏性清理需要在用户授权范围内处理。

## 阅读入口

- 先读[仓库约定](../../../AGENTS.md)、[README 手动构建安装包](../../../README.md#手动构建安装包)、[贡献说明](../../../CONTRIBUTING.md)与[支持范围](../../../docs/limitations.md)。
- 构建契约：[根 package.json](../../../package.json)、[桌面 package.json](../../../desktop/package.json)、[引擎 pom.xml](../../../engine/pom.xml)。
- 工具链：[bootstrap.ps1](../../../scripts/bootstrap.ps1)、[mvn.ps1](../../../scripts/mvn.ps1)与[runtime.ps1](../../../scripts/runtime.ps1)。
- 许可材料：[licenses.ps1](../../../scripts/licenses.ps1)、[npm-licenses.mjs](../../../scripts/npm-licenses.mjs)与[第三方说明](../../../THIRD_PARTY_NOTICES.md)。

## 操作流程

1. 从包含根 `package.json` 的仓库根目录执行，确认 Windows x64、Node.js 24／npm 11 及实际环境；检查已有产物，不能将它们算作本次构建结果。
2. 首次构建或依赖／工具链未准备时运行 `npm ci`、`npm run bootstrap`。Java 21、Maven 与本地 Maven 缓存使用 `.tools`，不改系统 PATH、不注册服务。
3. 运行根目录完整打包命令，按退出码与实际日志确认每个阶段：

   ```powershell
   npm run dist
   ```

   该命令依次构建引擎、前端与 Electron，准备裁剪运行时、整理许可，再调用 Electron NSIS 打包。不能以 `npm run dist -w desktop` 代替完整构建。

4. 读取桌面清单版本确认本次 `release` 安装包与 `win-unpacked` 资源，核对引擎 JAR、独立驱动依赖、随附 Java 运行时和许可材料。
5. 按 `verification` 完成受影响代码检查、三版本真库和需要的打包客户端测试；发布前记录干净 Windows 安装验收，交付本次产物与限制。

## 关键约束

- `npm run build` 只构建前端与 Electron，不构建 Java 引擎；根目录 `npm run dist` 的完整成功必须有本次日志和对应产物。
- 安装包版本取自 `desktop/package.json`，不要在技能内固定版本号和文件名。输出为 `release/Data Sync Setup <版本>.exe`；直接运行程序为 `release/win-unpacked/Data Sync.exe`。
- 无需安装的分发必须保留完整 `win-unpacked` 目录及资源，不能只分发 EXE。客户端应使用随附 Java，不依赖用户系统 Java／Maven。
- MariaDB Connector/J 使用独立、未修改 JAR，不打进引擎单一 JAR；驱动版本变化同时核对许可脚本内的版本与匹配源码，保留 LGPL 材料。
- Java 运行时保留法律文件及对应源码地址，项目代码采用 Apache-2.0；MySQL 服务端不随客户端分发。
- 当前未配置代码签名和自动更新；修改这些能力需另行核对实现与授权，不将打包成功描述为签名完成或远程发布。
- 发布产物、工具链、真实凭据、本地资料、SQL 档案及测试数据不提交到源码仓库。不要为获得干净构建删除用户资料或不相关目录。

## 验证与交付

- 记录完整打包命令、实际环境、退出码、版本、本次安装包路径、大小和 SHA-256；确认路径对应本次生成的产物。
- 独立检查随附运行时与资源；启用原生 smoke 前先完成本次完整打包，使用隔离数据库和资料目录。
- 将完整构建、打包客户端功能、干净机器安装／升级分别报告。没有干净 Windows 环境时保留安装验收未完成状态，不用当前开发机器替代。
- 若任一构建阶段失败，报告具体阶段和现有产物是否为旧文件，不能用后续单独打包成功掩盖完整构建失败。
