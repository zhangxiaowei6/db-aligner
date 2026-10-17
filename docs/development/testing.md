# 测试与验收指南

按本次实际影响选择检查。此文负责命令和前置条件，[验证记录](../validation/README.md)负责实际结果，[设计 QA](../validation/design-qa.md)负责视觉复核。历史通过不代表当前修改通过，测试计数不等于场景覆盖数量。

## 检查组合

| 修改范围                | 必要检查                                                                   |
| ----------------------- | -------------------------------------------------------------------------- |
| 纯文档或 skills         | 事实、命令、链接、锚点、编码、Prettier、差异空白；技能另做结构及元数据校验 |
| 前端、Rust 或 Java 代码 | `npm run typecheck`、`npm test`；按影响追加下列检查                        |
| UI 行为                 | 先 `npm run build`，再浏览器 UI；查看浅色、深色及受影响窗口截图            |
| 原生窗口、宿主或桥接    | 可用前端、宿主和引擎构建，原生客户端验收，隔离资料                         |
| 比较、执行、归档或回滚  | MySQL 5.7.44／8.0.45／8.4.8 三版本隔离真库，不能用模拟替代                 |
| PostgreSQL 适配         | 隔离 17.x 比较、执行、核验、恢复及相关风险分支                             |
| 打包客户端              | 先本次根目录完整打包，再 native smoke                                      |
| 安装／升级发布          | 干净 Windows 安装、覆盖升级及两个递增正式版本真实更新                      |
| 添加依赖                | 锁文件、第三方说明、`npm run licenses`                                     |

多种影响叠加要求。运行前记录实际 Node、npm、Java、Rust、数据库和浏览器环境；推荐环境不替代实测环境。

## 默认与格式检查

```powershell
npm run typecheck
npm test
npm run format:check
git diff --check
```

根格式脚本当前不覆盖 skills，纯文档变更显式选择文档和 `.agents/skills` 使用本地 Prettier，避免重排无关源码。Java 使用 Google Java Format 1.28.0；Rust 检查 `cargo fmt --check`、`cargo check`，按宿主影响运行 `cargo test`。Rust 工具需加载可用的 MSVC 环境。

技能用当前可用的 `skill-creator/scripts/quick_validate.py <技能目录>` 逐个校验，Python 开启 UTF-8；另查中文元数据、`$skill-name` 默认提示、引用及触发边界。结构校验不证明客户端已发现或流程已端到端验证。

## 浏览器与原生界面

先构建生产前端：

```powershell
npm run build
npm run qa:ui -w desktop
```

| 专项命令                                              | 用途                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `npm run qa:tree -w desktop`                          | 1,000／5,000 表、滚动、展开重查、刷新与重试                        |
| `npm run qa:ui -w desktop -- --tree-organization`     | 分组与原生 HTML5 拖拽                                              |
| `npm run qa:ui -w desktop -- --context-feedback`      | 菜单反馈、模块隔离及原页编辑                                       |
| `npm run qa:ui -w desktop -- --record-confirmation`   | 全目标脚本、回滚确认及取消                                         |
| `npm run qa:ui -w desktop -- --navigation`            | 页面路径、首次进入、必填及长名称                                   |
| `npm run qa:ui -w desktop -- --interaction-revisions` | 模板选表、关联草稿、备注及标识删除                                 |
| `npm run qa:ui -w desktop -- --motion`                | 公共动效、减少动态效果和对象切换                                   |
| `npm run qa:ui -w desktop -- --multi-database`        | MySQL／PostgreSQL 驱动、命名空间及模拟流程                         |
| `npm run qa:ui -w desktop -- --performance`           | 大 SQL 与虚拟清单显示，详见[性能说明](../reference/performance.md) |
| `npm run qa:desktop -w desktop`                       | 真实 Tauri 窗口、桥接、主题及重启持久化                            |

浏览器脚本使用 Chrome／Edge，可用 `DB_ALIGNER_QA_BROWSER` 指定程序。开发预览端口 4173、生产 UI QA 4183、树 QA 4184；同端口的实例不要并行。原生需本次宿主、前端和引擎构建，通过 `DB_ALIGNER_QA_APP` 可指定客户端；使用独立 `DB_ALIGNER_HOME`，不访问用户资料。

报告仍由脚本写入 `docs/*.json`，截图仍在 `docs/screenshots` 或专项输出目录，不因文档分类移动。报告与截图可能被下次运行覆盖。退出码之外还要查看相关截图和实际行为；浏览器虚构结果不证明系统权限、加密或真实数据库操作。

## MySQL 三版本隔离回归

只使用 `.tools/mysql-test` 内绑定 `127.0.0.1` 的实例和随机 `ds_it_*` 数据库，不注册服务。SSL 必须有可用 OpenSSL；启动脚本接受 `-OpenSsl`／`DB_ALIGNER_OPENSSL`，并探测 PATH 和 Git for Windows。缺失即失败，不静默跳过 SSL。

```powershell
try {
  ./scripts/mysql-test-server.ps1 -Version 5.7.44 -Port 33957
  ./scripts/mysql-test-server.ps1 -Version 8.0.45 -Port 33980
  ./scripts/mysql-test-server.ps1 -Version 8.4.8 -Port 33984
  ./scripts/mvn.ps1 test '-Ddbaligner.mysql.versions=5.7.44,8.0.45,8.4.8'
  if ($LASTEXITCODE -ne 0) { throw '三版本真库回归失败' }
} finally {
  ./scripts/mysql-test-stop.ps1
}
```

启动失败也检查并清理本次项目实例。MySQL 8 使用 `--no-monitor`；停止脚本复验完整进程路径、配置和创建时间，只清理项目进程，不能停止用户数据库。随机凭据、SQL 档案和 SQLite 不提交。

## PostgreSQL 隔离回归

只使用 `.tools/postgresql-test` 内的隔离 17.x，默认本机端口 33917，同样要求可用 OpenSSL 和随机 `ds_it_*` 库：

```powershell
try {
  ./scripts/postgresql-test-server.ps1 -Port 33917
  ./scripts/mvn.ps1 test '-Ddbaligner.postgresql.test=true'
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 真库回归失败' }
} finally {
  ./scripts/postgresql-test-stop.ps1
}
```

驱动测试制品按应用随附目录下载到忽略的 `.tools/multi-db`，不加入引擎分发依赖，不访问用户实例。

## 打包客户端与安装验收

先运行根目录 `npm run dist:unsigned`，或已配置更新签名的 `npm run dist`，确认本次完整产物，再启动上述两种隔离实例并运行：

```powershell
./scripts/mvn.ps1 test '-Ddbaligner.mysql.versions=5.7.44,8.0.45,8.4.8' '-Ddbaligner.postgresql.test=true' '-Ddbaligner.native.smoke=true'
```

测试后分别调用两种数据库停止脚本。MySQL 客户端只在 8.4.8 分支启动，不能声称三个版本都做了客户端验收。原生测试限制 PATH、清除 JAVA_HOME、使用随包 Java 及独立资料，验证桥接、凭据、真实连接、比较、保存、执行、归档、核验及恢复；PostgreSQL 包含首次驱动准备和重启缓存复用。

本机 smoke、ZIP 解压运行和 CI 构建不能代替干净 Windows 安装／升级。发布验收清单见[发布流程](releasing.md#发布前验收)。

## 证据记录

记录实际命令、环境、退出码、失败／错误／跳过、证据位置及限制。UI 更新相关截图与设计 QA；构建核对本次产物版本、大小和 SHA-256。未知状态和恢复资料缺失如实保留，核验不能改写原执行事实。

纯文档检查不刷新数据库、UI 或安装包报告。历史外链和已到期 Artifact 说明其用途，不声称本次重新访问或验收通过。
