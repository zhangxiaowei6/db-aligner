# 开发与本地构建

面向 Windows x64 开发者。首次使用需联网准备依赖和工具链；用户下载安装见[使用指南](../guide/user-guide.md)，检查组合见[测试指南](testing.md)，正式发布见[发布流程](releasing.md)。命令默认在仓库根目录执行。

## 工具链与首次准备

需要 Node.js 24／npm 11、Rust MSVC 工具链、Windows C++ Build Tools 与 SDK、WebView2。Java 21 和 Maven 由项目脚本下载到 `.tools`，不修改系统 PATH、不注册服务。实际依赖版本以根与桌面清单、锁文件、Cargo 清单和 `engine/pom.xml` 为准。

```powershell
npm ci
npm run bootstrap
```

`bootstrap` 准备 Java／Maven，不代替 Rust 和 C++ 环境安装。Maven 使用 `mvnw.cmd` 或 `scripts/mvn.ps1`，仅为当前运行设置环境。`scripts/tauri.ps1` 优先使用已有的项目内 `.tools/cargo`，否则使用可用 Rust 环境。

## 启动桌面开发

```powershell
npm run desktop
```

根命令先构建引擎，再启动 Vite、Tauri 和真实 Java 引擎，使用 `.local-data`。浏览器预览也使用 4173，不能同时占用端口启动。开发默认不做真实软件更新检查。

## 浏览器演示

```powershell
npm run dev
```

打开 `http://127.0.0.1:4173/?preview=1`。预览仅使用内存虚构资料，不连接数据库、下载驱动或持久保存；按页面标记演示两种数据库的范围、差异和模拟结果。真实连接、同步和本地资料操作使用桌面客户端。

## 常用构建

| 命令                   | 范围                                       |
| ---------------------- | ------------------------------------------ |
| `npm run typecheck`    | 前端 TypeScript                            |
| `npm test`             | 前端及默认引擎测试，真库入口默认跳过       |
| `npm run build`        | 前端类型与生产资源，不构建引擎或完整安装包 |
| `npm run engine:build` | Maven 引擎打包及默认测试                   |
| `npm run runtime`      | 随附 Java 运行时                           |
| `npm run licenses`     | 第三方许可与清单                           |

验收时按[测试指南](testing.md)完成构建前置条件；不能把单阶段成功描述为完整打包通过。

## 手动构建安装包

本地无更新签名构建：

```powershell
npm run dist:unsigned
```

正式更新签名构建需可用的 Tauri 签名私钥与密码：

```powershell
npm run dist
```

两条根命令依次构建引擎、前端、运行时、许可、release 模式 Tauri 宿主及 NSIS，再整理便携包和摘要；无签名命令以 `release:files -- -Unsigned` 完成整理。单独运行桌面工作区打包不会重新构建全部资源。

便携包压缩前，脚本仅将暂存副本中超出 ZIP 支持范围（1980～2107 年）的修改时间调整到边界，保留文件内容与依赖源文件。若本次完整构建已完成前序阶段，仅发布资料整理失败，修复原因后可运行 `npm run release:files -- -Unsigned` 重试无签名整理；源码或构建资源变化后应重新完整构建。

签名构建读取 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；本地脚本也识别忽略目录 `.tools/tauri-signing` 中已配置的密钥材料。私钥和密码不提交、不输出。正式签名不能用无签名产物替代；Tauri 更新签名不等于 Windows Authenticode 代码签名。

| 根 `release` 产物                    | 用途                                   |
| ------------------------------------ | -------------------------------------- |
| `DBAligner-Setup-<版本>-win-x64.exe` | Windows x64 NSIS                       |
| `DBAligner-<版本>-win-x64.zip`       | 主程序、引擎、运行时及许可齐全的便携包 |
| `SHA256SUMS.txt`、`RELEASE_NOTES.md` | 摘要及对应版本说明                     |
| 同名 `.exe.sig`、`latest.json`       | 仅正式签名更新构建生成                 |

版本由清单与配置决定，已有安装包不能证明本次构建。直接分发须保留完整目录，不能只取 EXE。缺少 WebView2 的机器首次安装可联网获取。构建成功和本机 smoke 不代替干净 Windows 安装／升级验收；远程发布另按发布流程操作。

## 目录与本地资料

| 位置                                | 职责                                           |
| ----------------------------------- | ---------------------------------------------- |
| `desktop/src`                       | React 页面、公共组件、控制器、类型、预览与测试 |
| `desktop/src-tauri`                 | Rust 宿主、命令权限、凭据与引擎进程            |
| `engine/src/main/java/io/dbaligner` | 数据库适配、比较、执行、记录与恢复             |
| `engine/src/test/java/io/dbaligner` | 单元、隔离真库及客户端测试                     |
| `scripts`、`desktop/scripts`        | 工具链、构建、许可与验收                       |
| `docs`、`.agents/skills`            | 专题文档、证据与按任务加载的技能               |
| `licenses`                          | 第三方原文、驱动源码及生成清单                 |

生产应用身份为 `io.dbaligner.client`，业务资料位于其独立 Windows LocalAppData 应用目录的 `data`。不同应用身份的资料不自动迁移或删除。`DB_ALIGNER_HOME` 可指定隔离资料目录，WebView2 放在其中的 `webview-profile`。资料、密码和恢复保护见[架构](../reference/architecture.md)。

`.tools`、`.local-data`、`node_modules`、`desktop/dist`、`desktop/src-tauri/target`、`engine/target` 和 `release` 不作为业务源码提交。修改源码、配置和生成脚本，不手工修改生成产物。
