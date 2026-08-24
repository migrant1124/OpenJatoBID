# Jato Agent 对话模式架构决策

## 决策

对话模式复用现有 Pi Runtime、全局 Agent 队列、文档解析、工作区 SQLite 和 Word Markdown 转换能力，只新增 Conversation 业务适配层。

```text
Renderer ConversationPage
  -> preload / Conversation IPC
  -> Conversation Service
     -> Conversation Store (SQLite v23)
     -> Attachment Service -> 文档解析 / 图片规范化
     -> Agent Service -> Pi conversation session
     -> exportService.exportStandaloneMarkdownWord
```

## 边界

- Renderer 只接收公开 DTO，不接收本机路径、Prompt、推理或工具诊断。
- `task` 模式行为保持不变；`conversation` 模式仅启用带 realpath/root 校验的 `read/find/ls`，不要求输出文件且不归档临时工作区。
- 流式 delta 只保存在 Main/Renderer 内存，完成、取消或失败时一次写入 SQLite。
- 原始附件只复制一次到 Conversation 工作区；文档向每轮 Agent 临时工作区提供解析后的 Markdown，图片由 Main 规范化后作为多模态内容随请求发送。
- 附件先完成整批数量、大小、格式和 SHA-256 预检，再返回可见占位并在 Main 串行复制解析；移除只改状态，物理文件按 24 小时/30 天维护策略清理。
- Conversation 诊断与 Analytics 只保留匿名状态和计数，不记录正文、文件名、路径或模型 Base URL。
- 不新增依赖、独立 AI 请求链路、视觉模型配置、第二套解析器、右侧工作台或模板选择器；当前文本模型不支持图片时复用既有 AI 错误弹窗提示更换模型。
