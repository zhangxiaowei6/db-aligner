---
name: protocol-change
description: 修改本仓库的 Rust 宿主命令、前端桥接、Java 路由、协议模型、响应或事件时使用，核对各层契约、凭据隔离、数值精度及旧接口兼容。
---

# 本地协议与进程边界

## 适用任务

用于增加、修改或修复本地请求、事件、桌面桥接、引擎生命周期与凭据处理。
仅修改页面布局无需使用；协议涉及数据库执行或恢复时同时使用 `sync-safety`。

## 阅读入口

- 先读[仓库约定](../../../AGENTS.md)、[本地协议](../../../docs/protocol.md)与[架构与证据模型](../../../docs/architecture.md)。
- 宿主与桥接：[main.rs](../../../desktop/src-tauri/src/main.rs)、[host.rs](../../../desktop/src-tauri/src/host.rs)与[tauri-bridge.ts](../../../desktop/src/tauri-bridge.ts)。
- 前端契约：[types.ts](../../../desktop/src/types.ts)、[model.ts](../../../desktop/src/model.ts)、[api.ts](../../../desktop/src/api.ts)与[preview.ts](../../../desktop/src/preview.ts)。
- 引擎契约：[EngineMain.java](../../../engine/src/main/java/io/dbaligner/EngineMain.java)、[Service.java](../../../engine/src/main/java/io/dbaligner/Service.java)、[Model.java](../../../engine/src/main/java/io/dbaligner/Model.java)与[Json.java](../../../engine/src/main/java/io/dbaligner/Json.java)。

## 操作流程

1. 列清修改的请求参数、返回值、错误、事件及旧数据缺省语义，确认处理归属是 Rust 宿主还是 Java。外观、窗口和文件对话框等原生能力不自动加入 Java 路由。
2. 逐层核对宿主允许方法、可信窗口和参数处理、前端桥接、前端调用与类型、Java 路由与模型，以及预览分支。无需变更的层也要确认其契约仍成立。
3. 保留内部凭据注入和输出脱敏，复用普通 JSON 参数转换与精确数值展示；新增字段不能影响原始归档、摘要或 SQL 的数值表示。
4. 长任务分别处理请求确认、进度事件和终态查询；以任务标识过滤事件，保留超时后的状态核验及旧接口行为。
5. 同步更新协议文档，按实际契约增加两端与预览验证，交付兼容说明和证据。

## 关键约束

- 渲染进程仅通过限定命令和事件访问 Rust 宿主；限定桥接和宿主接口，不暴露通用文件系统、进程或 SQL 执行入口。
- Java 使用 UTF-8 单行 JSON，请求响应按 `id` 关联，事件按任务关联；并发输出完整消息，stdout 仅用于协议，日志写 stderr。
- Windows 系统加密密码由宿主管理；`$secrets` 只在内部传递，查询、计划、配置导出不得泄露明文密码，备份不迁移密码材料。
- 导入文件内容和读取到的密码沿用宿主 token／凭据引用流程；连接测试使用当前测试参数，不因此保存连接或密码。
- BIGINT、DECIMAL 等精确文本转换只用于通信展示；保持原始计划、归档、摘要与实际 SQL 的精度。
- 执行只接收引擎保存的计划标识与已选变更，不接收渲染进程提供的可执行 SQL。原生保存文件的文本参数不能被转作数据库执行入口。
- 比较取消保留真实查询取消、清理和终态核验；不能为解决单任务超时而终止整个引擎。请求超时不能推断数据库任务已撤销。
- 保留旧接口、旧模板、计划和记录的现有读取及回退；新字段缺省语义由实际兼容需要确定，不能要求历史资料自动补齐新证据。
- 生产客户端和 Java 引擎不启动 HTTP 服务，生产只加载本机打包资源并禁止新窗口。

## 验证与交付

- 运行 `npm run typecheck`、`npm test`，检查成功／错误返回、中文编码、精确数值、新旧字段和事件清理等受影响行为。
- 桥接或宿主行为需真实桌面验证，浏览器预览不能证明原生权限与系统加密有效；相关命令及前置条件见 `verification`。
- 涉及数据库比较、执行、归档或回滚时，追加三版本隔离真库回归。
- 交付接口变化、兼容读取方式、实际验证及未覆盖边界；同步更新[本地协议](../../../docs/protocol.md)。
