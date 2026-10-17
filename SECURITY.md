# 安全报告

## 私密报告渠道

请通过 [GitHub 私密漏洞报告](https://github.com/zhangxiaowei6/db-aligner/security/advisories/new)提交疑似漏洞。维护者需在仓库设置中启用 Private vulnerability reporting；如入口暂不可用，可创建仅说明“需要私密报告渠道”的 Issue，不公开漏洞细节或资料。

## 报告内容与脱敏

报告请包含受影响版本、复现条件、预期与实际行为、已脱敏的最小证据。不要提交密码、Token、私钥、真实连接导出、SQL 档案、SQLite、行快照或本地备份。

## 资料保护与凭据处置

疑似数据丢失时先保留原始记录及恢复资料，不反复同步、核验后改写执行事实或尝试无证据回滚。泄露凭据应先撤销或轮换；从当前文件删除凭据或加入 `.gitignore` 不能消除历史提交中的泄露。

## 客户端更新与签名

客户端更新只访问公开 GitHub Releases，不携带发布 Token，不上传数据库连接、密码、SQL、记录或档案。发布凭据仅在 GitHub Actions 的发布作业使用。正式更新包须具备 Tauri 更新签名；Windows 代码签名另行配置，更新验收范围见 [验证记录](docs/validation/README.md)。
