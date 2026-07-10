# Jato AI BID 内部开发协作说明

本仓库用于维护佳图智能投标助手。提交修改前，请先阅读 `AGENTS.md`、`README.md` 和 `client/开发说明.md`。

## 问题记录

记录问题时至少包含：

- 软件版本和操作系统
- 问题描述与复现步骤
- 实际结果与预期结果
- 必要的日志或脱敏截图

不得提交 API Key、Token、账号密码、未脱敏招投标文件、客户资料或内部业务数据。

## 修改要求

- 只修改任务直接涉及的文件。
- 保持现有代码风格，不顺手重构无关模块。
- 不修改 `window.yibiao`、`yibiao.sqlite`、IPC 通道和数据库结构，除非有单独批准的方案。
- 不在普通功能修改中调整 technical-plan 主流程、OpenCode Agent 运行机制或 analytics 统计能力。
- 修改 Renderer 或 TypeScript 后执行 `cd client; npm run build`。
- 修改 Electron Main 或 preload 后先执行对应的 `node --check`，再执行构建。

## 变更说明

代码评审说明应包含：修改内容、影响范围、验证结果、未完成项和回滚方式。提交前确认没有把构建产物、密钥或本地用户数据加入版本库。

