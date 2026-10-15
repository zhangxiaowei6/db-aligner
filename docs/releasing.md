# GitHub 构建与发布

GitHub 主仓库为 [zhangxiaowei6/db-aligner](https://github.com/zhangxiaowei6/db-aligner)，默认分支为 `master`。原 Gitea 保留为本地 `gitea` 远端，不自动镜像；GitHub 为 `origin`。现有提交历史保持不变。

## 日常构建

`master` 推送、PR 和手动触发执行 Windows x64 检查，以及 MySQL／PostgreSQL 的完整浏览器预览交互验收。主分支和手动构建还以无更新签名模式执行根目录 `npm run dist`，启动三个 MySQL 版本和 PostgreSQL 17.x 的项目隔离实例，运行真库与 Tauri 打包客户端验收后生成 Actions Artifact，保留 14 天。Artifact 仅包含测试用 NSIS 安装包与验收报告，不是正式 Release；客户端不会从 Artifact 更新。

工具链为 Node.js 24／npm 11、Windows x64 MSVC Rust、项目 `.tools` 中的 Java 21 和 Maven。根目录完整打包构建 Java、React 与 Tauri 宿主，生成 NSIS 安装包。普通 CI 和本地构建不需要签名密钥，也不运行正式 `release:files`；标签工作流才从 GitHub Secrets 注入 Tauri 更新签名私钥与密码，缺少任一项即停止签名构建。仅缓存 npm／Maven 下载资料，不缓存运行时、数据库数据目录或凭据。

真库使用 `.tools/mysql-test` 中的 5.7.44／8.0.45／8.4.8 和 `.tools/postgresql-test` 中的项目隔离 17.x，分别绑定 `127.0.0.1:33957`、`33980`、`33984`、`33917`，不注册服务。每个工作流在自己的 runner 内串行启动 UI 与真库测试，结束或失败都分别调用两种数据库的项目停止脚本。PostgreSQL 打包客户端验收包含首次驱动下载、重启后缓存复用，以及同一进程内 MySQL／PostgreSQL 双驱动连接。新的原生客户端报告使用 `docs/native-client-smoke-result.json`、`docs/postgresql-native-client-smoke.json` 和 `docs/postgresql-native-client-cached-smoke.json`；旧 Electron 报告保留为历史证据。报告与多数据库截图保存为独立的验收 Artifact；不会上传测试凭据、SQL 档案或数据库资料。

旧 Electron 发布使用过 `v0.1.0`、`v0.1.1`、`v0.1.2` 和 `v0.2.0` 标签，其中后两个曾公开为 Release。Tauri 客户端与旧版的安装、资料和更新签名不兼容，因此新系列从 `v0.1.0` 重新编号。按维护者要求删除旧 Release 与标签，但保留 Git 提交历史及[验证记录](validation.md)中的原始日期、构建和验收范围。旧版用户需要手动安装新版并重新配置；旧版的本地资料不会被删除。

## 创建版本草稿

1. 同步根 `package.json`、`desktop/package.json`、Tauri 配置与 Cargo 清单、`engine/pom.xml` 的版本，更新 `package-lock.json` 与 `Cargo.lock`，在根 [CHANGELOG.md](../CHANGELOG.md) 添加对应的 `## X.Y.Z - YYYY-MM-DD` 中文版本记录。运行 `npm run release:check`，核对标签候选版本和当前版本记录唯一、非空。引擎版本由 Maven 资源过滤生成，不手工修改响应字符串。创建标签前确认远端没有同名标签或 Release。
2. 在 `master` 完成源码、默认测试、界面、三版本 MySQL、PostgreSQL 17.x 真库及打包验证，提交并推送版本变更。
3. 从主分支创建并推送新的版本标签。先确认该版本没有标签或公开 Release，命令读取当前清单版本：

   ```powershell
   $taskVersion = (Get-Content -Raw desktop/package.json | ConvertFrom-Json).version
   git tag "v$taskVersion"
   git push origin master
   git push origin "v$taskVersion"
   ```

4. 标签工作流核对标签与版本、主分支祖先关系，完整构建并签名 Tauri 更新包，运行多数据库预览、两种数据库的隔离真库和 Tauri 打包客户端 smoke，再生成 Release 草稿。独立 `release-validation` Artifact 保留该次验收报告和截图 14 天。
5. 核对附件：`DBAligner-Setup-<版本>-win-x64.exe`、同名 `.exe.sig`、`latest.json`、完整的 `DBAligner-<版本>-win-x64.zip`、`RELEASE_NOTES.md`、`SHA256SUMS.txt`。`latest.json` 的 `windows-x86_64` 项必须指向本标签的安装包，并包含该 `.sig` 文件的实际内容。版本说明从本次标签的 `CHANGELOG.md` 对应段落生成，原有中文分类与内容保留，文档链接指向同一版本的源码；Release 正文与该附件一致，附件摘要也纳入清单。完成下节人工验收后，在 GitHub Releases 编辑草稿并发布。

草稿公开前可根据维护者的实际验收确认更新发布说明，并同步 `RELEASE_NOTES.md`、清单中该附件的摘要和源码更新记录；安装包、`.sig`、`latest.json` 和版本标签保持原样。记录修改前后证据，公开后不再覆盖附件。

发布脚本使用 `gh release view --json isDraft` 识别已有草稿；REST 按标签查询不能可靠读取草稿。任何当前公开的 Release 都禁止覆盖附件或复用标签；修复已发布版本时必须增加版本号。

发布作业仅使用自动提供的 `GITHUB_TOKEN` 并授予 `contents: write`；其他作业保持读取权限。无需个人 Token。Tauri 更新签名公钥写入客户端配置，私钥和密码分别放入仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，不能提交、输出到日志或放入 Artifact。丢失私钥后无法为已安装的 Tauri 客户端签发后续更新。Tauri 的 `.sig` 用于客户端校验更新包，不是 Windows Authenticode 代码签名；未另行配置代码签名时安装界面仍可能显示未知发布者。公开仓库需启用 Actions 和私密漏洞报告，并检查仓库／组织策略允许发布作业写入内容。建议启用 GitHub 秘密扫描与推送保护。[Tauri 更新签名与静态 JSON 格式](https://v2.tauri.app/plugin/updater/)见官方说明。

失败工作流可重跑；已有草稿允许重新上传本次产物并更新同版本说明，公开版本禁止覆盖。重跑时新构建的 `.sig` 与 `latest.json` 必须和新安装包成套替换并重新核对摘要。分发整理还检查 PostgreSQL 许可、与源码相符的驱动目录，以及可选 JDBC 驱动未被打入引擎依赖目录。公开后发现问题时增加版本号，不能替换已发布安装包或复用标签。

## 发布前验收

- 在干净 Windows 10／11 x64 环境安装 Tauri NSIS 包，验证无需系统 Java／Maven；缺少 WebView2 的电脑在首次安装时可联网获取运行时。未配置 Windows 代码签名时可能显示未知发布者提示。[Windows 安装器与 WebView2 模式](https://v2.tauri.app/distribute/windows-installer/)见官方说明。
- 在隔离测试资料目录完成两个新版客户端版本之间的覆盖升级，检查连接、系统加密密码、主题、SQLite、记录与恢复档案仍可使用；确认旧 Electron 安装与资料保持独立，不执行迁移。
- 用两个递增的正式版本验证发现、下载、签名校验、取消安装、确认重启、安装及资料保留。草稿／预发布不能被正式客户端发现。有运行、排队或取消中的任务时必须拒绝安装，原任务继续运行。
- 无需安装 ZIP 必须完整解压，包含程序、Java 引擎、运行时与许可材料；升级先关闭客户端，再替换完整程序目录。自动更新验收针对 新版 NSIS 安装版。
- 网络无法访问 GitHub时，用户可下载正式安装包手动覆盖安装。更新检查失败不阻塞数据库功能。

未完成干净安装或真实更新验收时保持草稿。记录实际环境、命令、失败／跳过、安装包大小和 SHA-256；本机 smoke 与 Actions构建不能替代干净安装验收。

## 首次公开前检查

检查全部 Git历史的秘密扫描结果和图片／报告中的个人、连接及业务信息。忽略规则只防止新增文件，不移除已跟踪文件或历史内容。提交作者信息及提交历史也会公开；本地远端配置不会作为源码提交。

保留 Apache-2.0、NOTICE、第三方许可、独立 MariaDB驱动及匹配源码。不得提交 `.tools`、`.local-data`、安装包、真实连接导出、密码材料或 SQL档案。恢复证据与历史验收资料按项目规范保留，不能用清理文档抹去历史限制。
