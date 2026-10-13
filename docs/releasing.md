# GitHub 构建与发布

GitHub 主仓库为 [zhangxiaowei6/db-aligner](https://github.com/zhangxiaowei6/db-aligner)，默认分支为 `master`。原 Gitea 保留为本地 `gitea` 远端，不自动镜像；GitHub 为 `origin`。现有提交历史保持不变。

## 日常构建

`master` 推送、PR 和手动触发执行 Windows x64 检查。主分支和手动构建执行根目录 `npm run dist`，生成 Actions Artifact，保留 14 天。Artifact 用于测试，不是正式 Release；客户端不会从 Artifact 更新。

工具链为 Node.js 24／npm 11、项目 `.tools` 中的 Java 21 和 Maven。`npm ci` 通过根 postinstall 显式准备 Windows x64 Electron 二进制，缺失时立即失败；打包由构建器按已锁定版本准备分发，不依赖本机预先填充的目录。仅缓存 npm／Maven下载资料，不缓存运行时、MySQL数据目录或凭据。普通打包固定 `--publish never`，无需发布 Token。

`v0.1.0` 因缺少 Electron 运行时失败，`v0.1.1` 完成打包后因 runner 存在多个 OpenSSL 而未能启动真库验收；两次均未生成 Release。保留失败标签作为证据，当前发布候选为 `v0.1.2`，没有重新指向旧标签。

## 创建版本草稿

1. 同步根 `package.json`、`desktop/package.json` 和 `engine/pom.xml` 的版本，通过 npm 更新 `package-lock.json`。运行 `npm run release:check`。引擎版本由 Maven资源过滤生成，不手工修改响应字符串。
2. 在 `master` 完成源码、默认测试、界面、三版本真库及打包验证，提交并推送版本变更。
3. 从主分支创建并推送标签，例如当前候选：

   ```powershell
   git tag v0.1.2
   git push origin master
   git push origin v0.1.2
   ```

4. 标签工作流核对标签与版本、主分支祖先关系，完整构建、运行三版本隔离真库和打包客户端 smoke，再生成 Release 草稿。
5. 核对附件：安装包、`.blockmap`、`latest.yml`、完整无需安装 ZIP、`SHA256SUMS.txt`。完成下节人工验收后，在 GitHub Releases 编辑草稿并发布。

发布作业仅使用自动提供的 `GITHUB_TOKEN` 并授予 `contents: write`；其他作业保持读取权限。无需个人 Token或签名证书。公开仓库需启用 Actions和私密漏洞报告，并检查仓库／组织策略允许发布作业写入内容。建议启用 GitHub秘密扫描与推送保护。

失败工作流可重跑；已有草稿允许重新上传本次产物，公开版本禁止覆盖。公开后发现问题时增加版本号，不能替换已发布安装包或复用标签。

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
