# AGENTS.md

本文件适用于整个仓库，整理项目已有的开发约定。修改前阅读相关源码与文档，保持现有架构、数据保护和恢复证据模型。

## 1. 项目概况与阅读入口

Data Sync 是按工作区组织的 MySQL 结构与基础数据同步桌面工具：比较一个源库与多个目标库，预览所选表的差异，保存脚本或执行同步，并保留记录、恢复资料和版本归档。当前面向 Windows x64。

- 桌面端：Electron、React 19、TypeScript、Ant Design 6、Vite。
- 引擎：Java 21、Spring Boot 4 非 Web 模式、JDBC；SQLite 保存本地配置与记录。
- 精确版本与命令以根目录及 `desktop/package.json`、`package-lock.json`、`engine/pom.xml` 和实际脚本为准。

按修改内容阅读以下文档：

- [README](README.md)：产品概况、开发启动、构建与真库测试。
- [贡献说明](CONTRIBUTING.md)：格式、验证、依赖与提交资料约束。
- [架构与证据模型](docs/architecture.md)：进程边界、比较、执行、回滚与本地备份。
- [本地协议](docs/protocol.md)：请求、响应、事件和兼容契约。
- [支持范围与限制](docs/limitations.md)：可支持对象、阻止策略及验收限制。
- [交互规范](docs/interaction-guidelines.md)：布局、组件、异步反馈与业务交互。
- [验证记录](docs/validation.md)：历史验证范围与证据；不能替代当前修改的实际验证。
- [使用指南](docs/user-guide.md)：完整业务流程。

## 2. 目录职责与修改定位

| 目录或文件                           | 职责                                                                 |
| ------------------------------------ | -------------------------------------------------------------------- |
| `desktop/src`                        | React 页面、公共组件、控制器、类型、浏览器预览与前端测试             |
| `desktop/electron`                   | 主进程、preload、受限 IPC、系统凭据加密、原生文件操作与引擎生命周期  |
| `desktop/scripts`                    | 桌面开发启动与 UI / 桌面验收                                         |
| `engine/src/main/java/io/datasync`   | 协议入口、服务路由、连接、元数据、比较、执行、归档、核验、回滚与备份 |
| `engine/src/test/java/io/datasync`   | 引擎单元测试、隔离 MySQL 集成测试与打包客户端测试                    |
| `scripts`                            | 项目内工具链、Maven、运行时、许可与隔离 MySQL 测试脚本               |
| `docs`、`design-qa.md`               | 使用与技术文档、验收证据、截图和设计复核                             |
| `licenses`、`THIRD_PARTY_NOTICES.md` | 第三方许可、驱动源码与依赖材料                                       |

修改协议时同时核对 `desktop/electron/main.ts` 的允许方法及参数处理、preload 桥接、前端类型与预览实现、Java `Service.java` 路由与 `Model.java` 模型，并更新协议文档。具体实现以源码为准。

`.tools` 是下载工具链及隔离测试资料，`.local-data` 是开发资料；`node_modules`、`desktop/dist`、`desktop/dist-electron`、`engine/target` 和 `release` 是依赖或生成产物。修改对应源码、配置或生成脚本，不将这些目录当作业务源码修改或提交。

## 3. 开发环境与常用命令

使用 Windows x64、Node.js 24 / npm 11，在仓库根目录运行以下 PowerShell 命令：

```powershell
npm ci
npm run bootstrap
npm run engine:build
npm run desktop
```

Java 21 与 Maven 使用 `.tools` 内的项目工具链，首次引导需要网络下载。工具脚本不修改系统 PATH、不注册 Windows 服务；Maven 脚本仅为本次运行设置环境。Maven 入口为 `mvnw.cmd` 或 `./scripts/mvn.ps1`。

`npm run desktop` 启动 Vite、真实 Electron 客户端与 Java 引擎，默认使用 `.local-data`。生产资料位于 Electron `userData` 下的 `data` 子目录；使用 `DATA_SYNC_HOME` 指定隔离资料目录。

仅验收界面时运行 `npm run dev`，访问 `http://127.0.0.1:4173/?preview=1`。该预览只使用内存中的虚构数据，不连接数据库、不执行真实同步、不持久保存。开发端口固定为 4173，不要同时启动占用该端口的桌面开发实例和预览实例。

| 命令                            | 用途                                                     |
| ------------------------------- | -------------------------------------------------------- |
| `npm run typecheck`             | 检查前端与 Electron TypeScript 类型                      |
| `npm test`                      | 运行前端与引擎单元测试；默认跳过真库验收                 |
| `npm run test -w desktop`       | 单独运行前端 Vitest 测试                                 |
| `npm run engine:test`           | 单独运行引擎 Maven 测试                                  |
| `npm run engine:build`          | 构建引擎并运行默认 Maven 测试                            |
| `npm run build`                 | 构建前端与 Electron；不构建 Java 引擎                    |
| `npm run format:check`          | 检查现有 Prettier 覆盖范围内的文件格式                   |
| `npm run qa:ui -w desktop`      | 使用生产构建与示例数据进行浏览器 UI 验收                 |
| `npm run qa:desktop -w desktop` | 使用隔离资料目录进行原生桌面验收                         |
| `npm run licenses`              | 更新第三方许可与依赖材料                                 |
| `npm run dist`                  | 构建两端、裁剪运行时、整理许可并生成 Windows NSIS 安装包 |

UI 验收前运行 `npm run build`，真实桌面验收还需可用的引擎构建。浏览器使用本机 Chrome / Edge，可通过 `DATA_SYNC_QA_BROWSER` 指定程序。验收结果与截图位置见 README。

## 4. 架构与数据安全约束

- 保持渲染进程 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，通过限定的 preload / IPC 接口访问主进程。生产加载本机打包资源，禁止新窗口；生产客户端与 Java 引擎不启动 HTTP 服务。
- Java stdin/stdout 使用 UTF-8 单行 JSON，请求响应按 `id` 关联。stdout 只输出协议消息，日志写 stderr；保持并发输出完整、中文编码正确。
- 密码由 Electron 主进程使用 Windows 系统加密保存，请求内部传递凭据；查询结果、计划和配置导出不得包含明文密码，备份不迁移密码材料。
- 先确定所选范围，再读取结构与数据；同一份源快照供各目标复用。只执行引擎保存的计划与已选变更，不接受渲染进程提供的可执行 SQL，不写入未选范围。
- 保留计划中的目标连接绑定；连接配置变化后拒绝使用失效计划。执行、核验、回滚使用已校验配置，并保留执行前状态复验、锁保护、完整备份与摘要核验。
- 保留实际提交结果及恢复证据，步骤先持久化 `IN_FLIGHT`，再依据实际结果写入完成状态。MySQL DDL 存在隐式提交，不能假设可用一个事务回滚所有结构变化。
- 未知、中断或执行范围不明的状态不能标为成功或自动回滚。核验追加证据，不改写原始执行事实；当前状态符合预期不能替代历史执行证明。
- 保持基础数据每表最多 20,000 行的限制。删除和高风险结构变更默认不选；不支持的复杂对象、缺少可靠恢复键、外键依赖风险等继续按现有规则阻止，不关闭外键检查绕过约束。
- 已有表字段定义或顺序变化时，阻止该表本轮数据同步，先同步结构，再重新比较数据。缺失表的数据同步依赖已选创建表变更，不自动补入未选范围。
- 回滚预览与执行均需验证实际执行后状态、恢复资料及外键影响；执行不能只相信预览结果。保留独立行冲突阻止、表级结构恢复和关联恢复记录。
- 保留旧模板、计划与记录已有的兼容读取和回退逻辑；修改兼容行为时共同核对读取、展示、执行、核验与回滚。
- 本地备份与恢复继续验证 SQLite、档案路径和解压范围，保留目录穿越防护、解压大小限制及暂存后切换流程。

具体支持对象和阻止条件以[支持范围与限制](docs/limitations.md)及对应实现为准。

## 5. 代码与界面约定

- 遵循 `.editorconfig`：UTF-8、空格缩进、默认 2 空格、LF、文件末尾换行；PowerShell 文件使用 CRLF。
- 前端与文档遵循现有 Prettier 配置：单引号、分号、100 字符行宽、尾随逗号。Java 使用 Google Java Format 1.28.0，工具可放在忽略的 `.tools` 中。
- UI 保持已确认的白 / 灰 / 蓝风格，复用公共 `DataTable` 和现有组件。保持浅色、深色、跟随系统主题，不用硬编码浅色背景覆盖深色主题；布局与按钮遵循[交互规范](docs/interaction-guidelines.md)。
- 编辑草稿与已保存模型持有独立副本，发送参数前转换为普通 JSON 对象。切换工作区、记录或修改参数后，过期异步响应不得覆盖当前状态。
- “执行并保存”和“仅保存记录”均需展示实际来源、目标、范围与已选 SQL，确认后才提交；取消不创建任务或记录，重复点击不重复提交。
- 比较取消保留真实停止查询、终态核验及旧接口兼容；取消确认前不解锁范围。浏览器预览保持明确提示，并与引擎的范围、风险和阶段规则一致。

## 6. 验证、文档与依赖维护

代码修改完成后按[贡献说明](CONTRIBUTING.md)运行 `npm run typecheck`、`npm test`，并按涉及的构建与交互执行相关检查。纯文档修改核对事实、命令、链接及格式，无需启动数据库、UI 验收或完整构建。

修改数据库比较、执行、归档或回滚时，必须运行三个版本的隔离真库回归，不用模拟对象替代：

```powershell
./scripts/mysql-test-server.ps1 -Version 5.7.44 -Port 33957
./scripts/mysql-test-server.ps1 -Version 8.0.45 -Port 33980
./scripts/mysql-test-server.ps1 -Version 8.4.8 -Port 33984
./scripts/mvn.ps1 test '-Ddatasync.mysql.versions=5.7.44,8.0.45,8.4.8'
./scripts/mysql-test-stop.ps1
```

测试仅使用 `.tools/mysql-test` 内、绑定 `127.0.0.1` 的隔离实例，不注册服务，只创建和清理自己的 `ds_it_*` 数据库。测试生成的随机凭据不得提交。SSL 回归需要 OpenSSL，脚本当前检测 `D:/Git/usr/bin/openssl.exe`；其他位置需调整测试脚本。

启用原生打包测试前先运行 `npm run dist`，再在已启动的隔离实例上运行：

```powershell
./scripts/mvn.ps1 test '-Ddatasync.mysql.versions=5.7.44,8.0.45,8.4.8' '-Ddatasync.electron.smoke=true'
```

原生测试使用独立资料目录，验证打包客户端的真实功能；不能替代干净 Windows 环境的安装验收。发布前按贡献说明完成安装验收，代码签名与远程发布由维护者配置。

- UI 变更更新相应截图与 [design-qa.md](design-qa.md)。浏览器预览中的虚构成功状态不能证明真实连接或执行通过。
- 协议、支持范围或业务交互变化时更新对应文档。记录实际执行的验证命令、版本、结果、跳过项及环境限制，不引用历史结果声称本次通过。
- 添加依赖时更新锁文件与[第三方说明](THIRD_PARTY_NOTICES.md)，运行 `npm run licenses`。MariaDB Connector/J 保持独立、未修改 JAR 分发，不打入引擎的单一 JAR，并保留匹配源码与 LGPL 材料；Java 运行时保留法律文件及对应源码地址。
- 项目代码采用 [Apache-2.0](LICENSE)，第三方代码保留来源与许可。
- 不提交真实连接会话、凭据、私钥、SQL 档案、SQLite、本地资料、测试工具资料、依赖目录或安装包。生产问题报告脱敏 SQL、数据库名与日志。
- 涉及疑似数据丢失时先保留原始记录与恢复资料，不反复执行同一任务掩盖未知状态。
