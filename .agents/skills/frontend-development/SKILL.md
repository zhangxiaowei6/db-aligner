---
name: frontend-development
description: 修改 React 页面、组件、状态、主题或浏览器预览时使用。
---

# 前端开发与交互规范

## 按需入口

从[交互规范](../../../docs/reference/interaction-guidelines.md)选择相关章节，业务流程再查[使用指南](../../../docs/guide/user-guide.md)。协议变化组合 `protocol-change`。

- 页面和状态入口：[App.tsx](../../../desktop/src/App.tsx)、[controller.tsx](../../../desktop/src/controller.tsx)、[model.ts](../../../desktop/src/model.ts)与[页面目录](../../../desktop/src/pages)。
- 公共能力：[shared.tsx](../../../desktop/src/components/shared.tsx)、[AsyncButton.tsx](../../../desktop/src/components/AsyncButton.tsx)、[copy.ts](../../../desktop/src/copy.ts)与[appearance.tsx](../../../desktop/src/appearance.tsx)。
- 预览与通信：[api.ts](../../../desktop/src/api.ts)、[preview.ts](../../../desktop/src/preview.ts)与[types.ts](../../../desktop/src/types.ts)。

## 修改流程

1. 从页面事件追到控制器、模型及接口，确定修改的是本地草稿、自动加载还是明确提交；核对现有测试后再修改。
2. 复用 `DataTable`、选择切换按钮和现有表单组件；后台请求按钮使用 `AsyncButton` 跟踪实际 Promise，刷新复用现有持久反馈。不要由处理函数用 `void` 丢弃请求。
3. 用 `copyModel` 分离已保存模型与编辑草稿，接口参数通过现有 `api` 转为普通 JSON；结合请求标识、工作区和编辑会话检查过期结果。
4. 修改范围与业务行为时同步核对浏览器预览；新比较保持结构或数据单一类型，数据模式按目标跳过缺表。旧混合模板的应用和编辑继续保留既有兼容提示。
5. 按受影响交互补充有意义的测试，更新交互文档、相关截图和设计记录，执行对应验证。

## 专项检查

布局检查浅色／深色、最小窗口、长内容及键盘操作；表单检查空值、默认值、已有密码、条件必填及具体中文提示；导航检查原页打开、取消、保存和失败保留草稿。资源变更核对所有关联选择，公共动效不重挂载草稿。

验证组合与命令统一见[测试指南](../../../docs/development/testing.md#检查组合)，按本次影响选择；实际结果与未覆盖项如实交付。
