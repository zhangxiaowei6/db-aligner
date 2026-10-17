---
name: protocol-change
description: 修改 Rust 命令、前端桥接、Java 路由、模型或事件时使用。
---

# 本地协议与进程边界

## 按需入口

从[本地协议](../../../docs/reference/protocol.md)读取相关接口、消息或兼容章节；进程问题查[架构安全边界](../../../docs/reference/architecture.md#进程与安全边界)。数据库执行或恢复组合 `sync-safety`。

- 宿主与桥接：[main.rs](../../../desktop/src-tauri/src/main.rs)、[host.rs](../../../desktop/src-tauri/src/host.rs)与[tauri-bridge.ts](../../../desktop/src/tauri-bridge.ts)。
- 前端契约：[types.ts](../../../desktop/src/types.ts)、[model.ts](../../../desktop/src/model.ts)、[api.ts](../../../desktop/src/api.ts)与[preview.ts](../../../desktop/src/preview.ts)。
- 引擎契约：[EngineMain.java](../../../engine/src/main/java/io/dbaligner/EngineMain.java)、[Service.java](../../../engine/src/main/java/io/dbaligner/Service.java)、[Model.java](../../../engine/src/main/java/io/dbaligner/Model.java)与[Json.java](../../../engine/src/main/java/io/dbaligner/Json.java)。

## 契约联动

1. 列清修改的请求参数、返回值、错误、事件及旧数据缺省语义，确认处理归属是 Rust 宿主还是 Java。外观、窗口和文件对话框等原生能力不自动加入 Java 路由。
2. 逐层核对宿主允许方法、可信窗口和参数处理、前端桥接、前端调用与类型、Java 路由与模型，以及预览分支。无需变更的层也要确认其契约仍成立。
3. 保留内部凭据注入和输出脱敏，复用普通 JSON 参数转换与精确数值展示；新增字段不能影响原始归档、摘要或 SQL 的数值表示。
4. 长任务分别处理请求确认、进度事件和终态查询；以任务标识过滤事件，保留超时后的状态核验及旧接口行为。
5. 同步更新协议文档，按实际契约增加两端与预览验证，交付兼容说明和证据。

## 专项检查

覆盖成功／错误、中文编码、精确数值、旧字段缺省和事件清理；导入内容与密码维持宿主 token／凭据引用，连接测试不保存配置。取消不终止整个引擎，超时不推断任务撤销；宿主权限与系统加密使用真实原生验证。

验证组合与命令统一见[测试指南](../../../docs/development/testing.md#检查组合)，按本次影响选择；实际结果与未覆盖项如实交付。
