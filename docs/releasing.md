# GitHub 构建与发布

GitHub 主仓库为 [zhangxiaowei6/db-aligner](https://github.com/zhangxiaowei6/db-aligner)，默认分支为 `master`。原 Gitea 保留为本地 `gitea` 远端，不自动镜像；GitHub 为 `origin`。现有提交历史保持不变。

## 日常构建

`master` 推送、PR 和手动触发执行 Windows x64 检查，以及 MySQL／PostgreSQL 的完整浏览器预览交互验收。主分支和手动构建还执行根目录 `npm run dist`，启动三个 MySQL 版本和 PostgreSQL 17.x 的项目隔离实例，运行真库与打包客户端验收后生成 Actions Artifact，保留 14 天。Artifact 用于测试，不是正式 Release；客户端不会从 Artifact 更新。

工具链为 Node.js 24／npm 11、项目 `.tools` 中的 Java 21 和 Maven。`npm ci` 通过根 postinstall 显式准备 Windows x64 Electron 二进制，缺失时立即失败；打包由构建器按已锁定版本准备分发，不依赖本机预先填充的目录。仅缓存 npm／Maven 下载资料，不缓存运行时、数据库数据目录或凭据。普通打包固定 `--publish never`，无需发布 Token。

真库使用 `.tools/mysql-test` 中的 5.7.44／8.0.45／8.4.8 和 `.tools/postgresql-test` 中的 17.11，分别绑定 `127.0.0.1:33957`、`33980`、`33984`、`33917`，不注册服务。每个工作流在自己的 runner 内串行启动 UI 与真库测试，结束或失败都分别调用两种数据库的项目停止脚本。PostgreSQL 打包客户端验收包含首次驱动下载、重启后缓存复用，以及同一进程内 MySQL／PostgreSQL 双驱动连接。报告与多数据库截图保存为独立的验收 Artifact；不会上传测试凭据、SQL 档案或数据库资料。

`v0.1.0` 因缺少 Electron 运行时失败，`v0.1.1` 完成打包后因 runner 存在多个 OpenSSL 而未能启动真库验收；两次均未生成 Release。保留失败标签作为证据，没有重新指向旧标签。首个正式版本 [v0.1.2](https://github.com/zhangxiaowei6/db-aligner/releases/tag/v0.1.2) 已于 2026-10-13 在维护者确认验收完成后公开。

多数据库正式版本 [v0.2.0](https://github.com/zhangxiaowei6/db-aligner/releases/tag/v0.2.0) 于 2026-10-15 在维护者确认验收没有问题并要求正式发布后公开，已设为 Latest；实际构建、附件核验及确认来源见[验证记录](validation.md)。

## 创建版本草稿

1. 同步根 `package.json`、`desktop/package.json` 和 `engine/pom.xml` 的版本，通过 npm 更新 `package-lock.json`，在根 [CHANGELOG.md](../CHANGELOG.md) 添加对应的 `## X.Y.Z - YYYY-MM-DD` 中文版本记录。运行 `npm run release:check`，同时检查版本一致及当前版本记录唯一、非空。引擎版本由 Maven 资源过滤生成，不手工修改响应字符串。
2. 在 `master` 完成源码、默认测试、界面、三版本 MySQL、PostgreSQL 17.x 真库及打包验证，提交并推送版本变更。
3. 从主分支创建并推送新的版本标签。先确认该版本没有标签或公开 Release，命令读取当前清单版本：

   ```powershell
   $taskVersion = (Get-Content -Raw desktop/package.json | ConvertFrom-Json).version
   git tag "v$taskVersion"
   git push origin master
   git push origin "v$taskVersion"
   ```

4. 标签工作流核对标签与版本、主分支祖先关系，完整构建、运行多数据库预览、两种数据库的隔离真库和打包客户端 smoke，再生成 Release 草稿。独立 `release-validation` Artifact 保留该次验收报告和截图 14 天。
5. 核对附件：安装包、`.blockmap`、`latest.yml`、完整无需安装 ZIP、`RELEASE_NOTES.md`、`SHA256SUMS.txt`。版本说明从本次标签的 `CHANGELOG.md` 对应段落生成，原有中文分类与内容保留，文档链接指向同一版本的源码；Release 正文与该附件一致，附件摘要也纳入清单。完成下节人工验收后，在 GitHub Releases 编辑草稿并发布。

草稿公开前可根据维护者的实际验收确认更新发布说明，并同步 `RELEASE_NOTES.md`、清单中该附件的摘要和源码更新记录；客户端二进制、blockmap、更新元数据和版本标签保持原样。记录修改前后证据，公开后不再覆盖附件。

发布脚本使用 `gh release view --json isDraft` 识别已有草稿；REST 按标签查询不能可靠读取草稿。后续标签继承修复，不移动旧标签。`v0.1.2` 和 `v0.2.0` 已公开，禁止重新上传、覆盖附件或复用这些标签；修复已发布版本时必须增加版本号。

发布作业仅使用自动提供的 `GITHUB_TOKEN` 并授予 `contents: write`；其他作业保持读取权限。无需个人 Token或签名证书。公开仓库需启用 Actions和私密漏洞报告，并检查仓库／组织策略允许发布作业写入内容。建议启用 GitHub秘密扫描与推送保护。

失败工作流可重跑；已有草稿允许重新上传本次产物并更新同版本说明，公开版本禁止覆盖。分发整理还检查 PostgreSQL 许可、与源码相符的驱动目录，以及可选 JDBC 驱动未被打入引擎依赖目录。公开后发现问题时增加版本号，不能替换已发布安装包或复用标签。

## 发布前验收

- 在干净 Windows 10／11 x64 环境安装，验证无需系统 Java／Maven。未签名安装包可能显示未知发布者提示，不声明已完成签名。
- 在隔离测试资料目录完成覆盖升级，检查连接、系统加密密码、主题、SQLite、记录与恢复档案仍可使用。
- 用两个递增的正式版本验证发现、下载、校验、取消安装、确认重启、安装及资料保留。草稿／预发布不能被正式客户端发现。有运行、排队或取消中的任务时必须拒绝安装，原任务继续运行。
- 当前旧的本地 `0.1.0` 未包含更新代码，先手动安装含更新能力的版本。无需安装 ZIP 必须完整解压；升级先关闭客户端，再替换完整程序目录，保留业务资料及档案。自动更新验收针对 NSIS安装版。
- 网络无法访问 GitHub时，用户可下载正式安装包手动覆盖安装。更新检查失败不阻塞数据库功能。

未完成干净安装或真实更新验收时保持草稿。记录实际环境、命令、失败／跳过、安装包大小和 SHA-256；本机 smoke 与 Actions构建不能替代干净安装验收。

## 首次公开前检查

检查全部 Git历史的秘密扫描结果和图片／报告中的个人、连接及业务信息。忽略规则只防止新增文件，不移除已跟踪文件或历史内容。提交作者信息及提交历史也会公开；本地远端配置不会作为源码提交。

保留 Apache-2.0、NOTICE、第三方许可、独立 MariaDB驱动及匹配源码。不得提交 `.tools`、`.local-data`、安装包、真实连接导出、密码材料或 SQL档案。恢复证据与历史验收资料按项目规范保留，不能用清理文档抹去历史限制。
