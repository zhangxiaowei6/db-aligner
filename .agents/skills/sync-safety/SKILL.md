---
name: sync-safety
description: 修改比较、执行、归档、核验、回滚或本地备份恢复时使用。
---

# 数据库同步与恢复

## 按需入口

从[架构](../../../docs/reference/architecture.md)读取相关比较、执行、核验、回滚或备份章节；能力判断查[支持范围](../../../docs/guide/limitations.md)。接口变化组合 `protocol-change`。只读分析不执行同步；疑似丢失先保留原始资料。

- 比较与元数据：[Planner.java](../../../engine/src/main/java/io/dbaligner/Planner.java)、[Database.java](../../../engine/src/main/java/io/dbaligner/Database.java)、[Comparisons.java](../../../engine/src/main/java/io/dbaligner/Comparisons.java)与[ComparisonContext.java](../../../engine/src/main/java/io/dbaligner/ComparisonContext.java)。
- 执行与证据：[Jobs.java](../../../engine/src/main/java/io/dbaligner/Jobs.java)、[Archives.java](../../../engine/src/main/java/io/dbaligner/Archives.java)、[External.java](../../../engine/src/main/java/io/dbaligner/External.java)与[Store.java](../../../engine/src/main/java/io/dbaligner/Store.java)。
- SQL 与本地恢复：[Sql.java](../../../engine/src/main/java/io/dbaligner/Sql.java)、[Backup.java](../../../engine/src/main/java/io/dbaligner/Backup.java)及[宿主恢复流程](../../../desktop/src-tauri/src/host.rs)。
- [架构中的回滚流程](../../../docs/reference/architecture.md#回滚)与[实现入口](../../../docs/reference/architecture.md#实现入口)用于定位证据链；结论须与当前源码复核。

## 检查证据链

1. 明确源库、目标、选表、同步类型及已选变更，沿比较、保存、执行、核验与回滚检查影响。只读取所选范围，并复用同一源快照。
2. 核对计划目标连接绑定、执行前状态复验、锁范围和依赖判断；配置变化后拒绝失效计划，不绕过不支持对象或可靠恢复键检查。
3. 对有损字段操作保持锁内采集、摘要生成、本地档案与 SQLite 持久化在变更之前完成；普通读取、序列化或持久化失败停止该目标。
4. 分别保存计划意图、实际完成步骤、当前状态验证和恢复资料；核验只追加证据，不能把当前状态符合预期改写成历史成功。
5. 回滚同时检查预览和执行入口，锁内重新核验执行后状态、资料摘要及外键影响，生成关联恢复记录。部分恢复后只认可剩余项的可信证据。
6. 本地备份恢复沿用 SQLite 快照、ZIP 路径及大小校验、恢复前备份、暂存验证、引擎切换和档案路径重写，不把系统密码文件加入可迁移包。

## 专项检查

- `LOCAL_V1` 的字段原值与摘要保存在记录和本地档案；存在表键且值为 `[]` 表示已采集完整空表，缺键表示未采集，两者不能混同。
- `04_rollback.sql` 保留原计划脚本，后续追加 `recovery.json` 与 `05_rollback_local.sql`；05 包含完整已选计划的逆向 SQL，不证明全部步骤已完成，部分失败或中断后不能直接整份执行。
- 数据回滚检查实际执行后完整行，冲突只阻止对应项；结构恢复按表组合并检查表级状态。回滚不能只相信上次预览，原执行事实与关联恢复记录必须保留。
- 外部声明范围、当前状态验证和恢复可用性分开保存；旧记录的备份、收据、快照及 `backupCompleted` 兼容规则不得被新格式覆盖。
- 本地存储保留 WAL／FULL、摘要列表与详情按需加载；备份和档案路径保留目录穿越、符号链接及解压大小防护，不扩大清理范围。

覆盖未选范围、连接变化、缺表、超限、外键、部分提交／中断、资料缺失／篡改、旧记录与部分恢复；备份另查损坏 SQLite、非法路径、解压超限、密码排除和切换失败。MySQL 与 PostgreSQL 分别核对其提交模型。

验证组合与命令统一见[测试指南](../../../docs/development/testing.md#检查组合)，按本次影响选择；实际结果与未覆盖项如实交付。
