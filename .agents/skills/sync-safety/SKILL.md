---
name: sync-safety
description: 修改本仓库的数据库比较、执行、归档、外部核验、回滚或本地备份恢复时使用，保持范围保护、连接绑定、执行事实、恢复证据和兼容读取。
---

# 数据库同步与恢复

## 适用任务

用于数据库同步逻辑、恢复证据、本地档案与备份流程的开发、分析和故障修复。
只读分析不执行同步或回滚；疑似数据丢失先保留原始记录与恢复资料。
涉及协议联动时同时使用 `protocol-change`，检查组合使用 `verification`。

## 阅读入口

- 先读[仓库约定](../../../AGENTS.md)、[架构与证据模型](../../../docs/architecture.md)、[支持范围](../../../docs/limitations.md)与[本地协议](../../../docs/protocol.md)。
- 比较与元数据：[Planner.java](../../../engine/src/main/java/io/dbaligner/Planner.java)、[Database.java](../../../engine/src/main/java/io/dbaligner/Database.java)、[Comparisons.java](../../../engine/src/main/java/io/dbaligner/Comparisons.java)与[ComparisonContext.java](../../../engine/src/main/java/io/dbaligner/ComparisonContext.java)。
- 执行与证据：[Jobs.java](../../../engine/src/main/java/io/dbaligner/Jobs.java)、[Archives.java](../../../engine/src/main/java/io/dbaligner/Archives.java)、[External.java](../../../engine/src/main/java/io/dbaligner/External.java)与[Store.java](../../../engine/src/main/java/io/dbaligner/Store.java)。
- SQL 与本地恢复：[Sql.java](../../../engine/src/main/java/io/dbaligner/Sql.java)、[Backup.java](../../../engine/src/main/java/io/dbaligner/Backup.java)及[宿主恢复流程](../../../desktop/src-tauri/src/host.rs)。
- [架构中的回滚流程](../../../docs/architecture.md#回滚)与[实现入口](../../../docs/architecture.md#实现入口)用于定位证据链；结论须与当前源码复核。

## 操作流程

1. 明确源库、目标、选表、同步类型及已选变更，沿比较、保存、执行、核验与回滚检查影响。只读取所选范围，并复用同一源快照。
2. 核对计划目标连接绑定、执行前状态复验、锁范围和依赖判断；配置变化后拒绝失效计划，不绕过不支持对象或可靠恢复键检查。
3. 对有损字段操作保持锁内采集、摘要生成、本地档案与 SQLite 持久化在变更之前完成；普通读取、序列化或持久化失败停止该目标。
4. 分别保存计划意图、实际完成步骤、当前状态验证和恢复资料；核验只追加证据，不能把当前状态符合预期改写成历史成功。
5. 回滚同时检查预览和执行入口，锁内重新核验执行后状态、资料摘要及外键影响，生成关联恢复记录。部分恢复后只认可剩余项的可信证据。
6. 本地备份恢复沿用 SQLite 快照、ZIP 路径及大小校验、恢复前备份、暂存验证、引擎切换和档案路径重写，不把系统密码文件加入可迁移包。

## 关键约束

- 新比较只允许结构或数据一种类型，不同表也不能混合；数据模式按每个目标跳过缺表，不创建表、不生成该表变更。旧混合计划与记录继续兼容读取。
- 数据同步每表最多 20,000 行，超限阻止；结构变更的原值采集同样有上限，但超限沿用跳过采集并保留人工恢复限制的逻辑，不能声称已具备自动恢复资料。
- 无可靠恢复键的有损字段操作、主键结构变化、复杂对象和外键风险按现有规则阻止。高风险变更默认不选，不关闭外键检查绕过约束。
- 目标库只写入所选同步变更，不创建辅助备份、收据或执行后快照对象；历史对象按兼容逻辑继续读取，不自动清理。
- 每步先持久化 `IN_FLIGHT`，再按实际提交结果记录完成；DDL 有隐式提交，不能用整体事务保证所有结构变化可撤销。未知、中断或范围不明不能标为成功或自动回滚。
- `LOCAL_V1` 的字段原值与摘要保存在记录和本地档案；存在表键且值为 `[]` 表示已采集完整空表，缺键表示未采集，两者不能混同。
- `04_rollback.sql` 保留原计划脚本，后续追加 `recovery.json` 与 `05_rollback_local.sql`；05 包含完整已选计划的逆向 SQL，不证明全部步骤已完成，部分失败或中断后不能直接整份执行。
- 数据回滚检查实际执行后完整行，冲突只阻止对应项；结构恢复按表组合并检查表级状态。回滚不能只相信上次预览，原执行事实与关联恢复记录必须保留。
- 外部声明范围、当前状态验证和恢复可用性分开保存；旧记录的备份、收据、快照及 `backupCompleted` 兼容规则不得被新格式覆盖。
- 本地存储保留 WAL／FULL、摘要列表与详情按需加载；备份和档案路径保留目录穿越、符号链接及解压大小防护，不扩大清理范围。

## 验证与交付

- 代码修改运行 `npm run typecheck`、`npm test`；比较、执行、归档或回滚变更必须运行 MySQL 5.7.44、8.0.45、8.4.8 的隔离真库回归，命令见 `verification`。
- 根据影响覆盖未选范围不写入、目标绑定变化、缺表跳过、超限、外键阻止、部分提交／中断、资料缺失或摘要不符，以及旧记录和部分恢复。
- 备份恢复变化验证合法包、损坏 SQLite、非法路径、展开超限、密码排除与切换失败的受影响分支，不访问用户真实资料目录。
- 交付具体行为、实际完成及未知状态、恢复限制和当前验证结果；同步更新架构、协议、支持范围或使用指南中的相关内容。
