---
name: windows-packaging
description: 构建或核验 Windows x64 安装包、便携包及发布资源时使用。
---

# Windows 构建与打包

## 按需入口

按[开发指南](../../../docs/development/README.md#手动构建安装包)操作，正式签名与远程发布查[发布说明](../../../docs/development/releasing.md)。纯文档或普通 UI 不要求打包。

契约以根／桌面清单、Tauri／Cargo 配置和 `engine/pom.xml` 为准；工具入口为 `scripts/tauri.ps1`、`runtime.ps1`、`licenses.ps1`、`release-files.ps1`。

## 构建与核验

1. 检查实际 Windows x64、Node／npm、Rust MSVC、C++／SDK、项目 Java／Maven，区分旧产物，缺依赖时按开发指南准备。
2. 根目录完整构建：本地 `npm run dist:unsigned`；正式更新签名 `npm run dist`。逐阶段检查退出码，私钥不写入源码、日志或 Artifact。
3. 读取本次版本与 `desktop/src-tauri/target/release/bundle/nsis` 产物；核对主程序、引擎、独立 MariaDB JAR、匹配源码、Java 运行时和法律材料。PostgreSQL 可选驱动核对随附目录与许可，不预置到引擎依赖。
4. 核对 `release` 安装包、完整便携 ZIP、版本说明和 SHA-256；正式构建另核验 `.exe.sig` 与 `latest.json` 的版本、地址、签名一致。Tauri 签名与 Windows 代码签名分别报告。
5. 按[测试指南](../../../docs/development/testing.md#打包客户端与安装验收)完成 smoke，发布前另记录干净 Windows 安装和两个递增版本升级。

交付本次命令、环境、版本、产物路径、大小、SHA-256 及失败和未完成项。单独打包不能掩盖完整构建失败，不清理用户资料或无关目录；普通打包不自动发布。
