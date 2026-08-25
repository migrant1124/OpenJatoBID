# Conversation IPC 契约

通道前缀统一为 `conversation:`，在工作区 SQLite 就绪后注册，并通过 `window.yibiao.conversation` 与 `window.jatoaibid.conversation` 暴露同一桥接对象。

## 请求

- `list-threads`、`create-thread`、`get-thread`、`rename-thread`、`delete-thread`
- `select-attachments`、`create-text-attachment`、`remove-attachment`
- `send-message`、`cancel-message`、`regenerate-message`、`quick-action`
- `export-message-word`

## 事件

统一事件 `conversation:event`：线程列表变化、消息 queued/start/delta/complete/canceled/error、附件 progress。

事件和返回 DTO 禁止包含本机路径、Prompt、推理、session/workspace、工具参数和附件正文。Renderer 发送消息时只传线程 ID、短文本和附件 ID；Word 导出只传线程 ID 与 Assistant 消息 ID。
