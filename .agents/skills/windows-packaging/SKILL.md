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
- 构建契约：[根 package.json](../../../package.json)、[桌面 package.json](../../../desktop/package.json)、[Tauri 配置](../../../desktop/src-tauri/tauri.conf.json)、[Cargo 清单](../../../desktop/src-tauri/Cargo.toml)与[引擎 pom.xml](../../../engine/pom.xml)。
- 工具链：[bootstrap.ps1](../../../scripts/bootstrap.ps1)、[mvn.ps1](../../../scripts/mvn.ps1)与[runtime.ps1](../../../scripts/runtime.ps1)。
- 许可材料：[licenses.ps1](../../../scripts/licenses.ps1)、[npm-licenses.mjs](../../../scripts/npm-licenses.mjs)与[第三方说明](../../../THIRD_PARTY_NOTICES.md)。

## 操作流程

1. 从包含根 `package.json` 的仓库根目录执行，确认 Windows x64、Node.js 24／npm 11、Rust MSVC 与 Windows C++ 构建工具的实际环境；检查已有产物，不能将它们算作本次构建结果。
2. 首次构建或依赖／工具链未准备时运行 `npm ci`、`npm run bootstrap`。Java 21、Maven 与本地 Maven 缓存使用 `.tools`，不改系统 PATH、不注册服务。
3. 运行根目录完整打包命令，按退出码与实际日志确认每个阶段：

   ```powershell
   npm run dist
   ```

   该命令依次构建引擎、前端与 Tauri 宿主，准备裁剪运行时、整理许可，再生成 Windows x64 NSIS 安装包。单独调用桌面工作区的打包命令不能代替完整构建。

4. 读取桌面与 Tauri 清单版本，确认本次 `desktop/src-tauri/target/release/bundle/nsis` 安装包；核对引擎 JAR、独立驱动依赖、随附 Java 运行时和许可材料。若分发无需安装 ZIP，检查主程序与资源完整，不能只压缩 EXE。
5. 普通本地或主分支 CI 无签名构建使用 `npm run dist:unsigned`。正式标签发布必须注入 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 并运行 `npm run dist`，核对签名、更新元数据、完整 ZIP 和摘要；签名私钥不得写入源码、日志或 Artifact。
6. 按 `verification` 完成受影响代码检查、三版本真库和需要的打包客户端测试；发布前记录干净 Windows 安装及两个 Tauri 版本之间的更新验收，交付本次产物与限制。

## 关键约束

- `npm run build` 不构建 Java 引擎或完整安装包；根目录 `npm run dist` 的完整成功必须有本次日志和对应产物。
- 安装包版本取自桌面清单和 Tauri 配置，不要在技能内固定版本号。正式发布附件为 `release/DBAligner-Setup-<版本>-win-x64.exe`、同名 `.exe.sig`、`latest.json` 与完整便携 ZIP；普通无签名构建仍包含完整便携 ZIP 与摘要，但不生成 `.sig` 或 `latest.json`。
- 无需安装的分发必须保留 Tauri 主程序、Java 引擎、运行时与许可等全部资源，不能只分发 EXE。客户端应使用随附 Java，不依赖用户系统 Java／Maven。缺少 WebView2 的机器首次安装可联网获取运行时。
- MariaDB Connector/J 使用独立、未修改 JAR，不打进引擎单一 JAR；驱动版本变化同时核对许可脚本内的版本与匹配源码，保留 LGPL 材料。
- Java 运行时保留法律文件及对应源码地址，项目代码采用 Apache-2.0；MySQL 服务端不随客户端分发。
- Tauri 更新签名是客户端验证更新包的必要条件，Windows 代码签名另行配置；不能把 `.sig` 说成 Authenticode 签名。普通打包不发布，标签工作流只生成草稿。版本、附件与干净安装／升级验收见[发布说明](../../../docs/releasing.md)，不将打包成功描述为真实更新验收完成。
- 发布产物、工具链、真实凭据、本地资料、SQL 档案及测试数据不提交到源码仓库。不要为获得干净构建删除用户资料或不相关目录。

## 验证与交付

- 记录完整打包命令、实际环境、退出码、版本、本次安装包路径、大小和 SHA-256；确认路径对应本次生成的产物，与旧 Electron 172.92 MiB 基准比较时注明是否含完整业务资源。
- 独立检查随附运行时与资源；启用 Tauri 打包客户端 smoke 前先完成本次完整打包，使用隔离数据库和资料目录。
- 将完整构建、打包客户端功能、干净机器安装／升级分别报告。没有干净 Windows 环境时保留安装验收未完成状态，不用当前开发机器替代。
- 若任一构建阶段失败，报告具体阶段和现有产物是否为旧文件，不能用后续单独打包成功掩盖完整构建失败。
