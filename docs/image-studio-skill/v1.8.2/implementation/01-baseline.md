# v1.8.2 实际基线（2026-09-29）

- 分支：`v1.8.2-modleOPT`；HEAD：`f8d787fe31f3b8172b426d57528ba744dc2ea6b9`。改前 `git status --short --branch` 仅显示 `?? docs/image-studio-skill/`。这些未跟踪资料保留。
- 规格参考的 `main/733dad0` 是上一轮基线；当前 HEAD 已不同，不回退。客户端 `client/package.json` 为 1.8.1；目标 1.8.2。管理端独立，不改其版本。
- 客户端实际脚本：`npm run build`、`npm run dev`、若干具名 `test:*`；无通用 `npm test`。现有聚焦测试包括 `imageStudioService.test.cjs`、`imageStudioSources.test.cjs`、`imageStudioRisk.test.cjs`。
- 创作 UI：`ImageStudioPage.tsx` 保存草稿/编排任务；`ImageStudioCreate.tsx` 包含优化、反推、参考图、画幅、张数、生成、局部修改和 PSD。当前优化在原工具行，完成后才显示对比弹窗。
- Main：`imageStudioService.cjs` 的 `preflight` 调文本模型评估风险，`decideRisk` 管确认，`submit` 查 `image_studio_risk_checks` 再 `start`。PSD `createLayerSet` 也调用 `preflight`，并硬编码 Sunburst 做补全。`imageStudioRisk.test.cjs` 依赖旧流程。
- IPC/preload/类型：`imageStudioIpc.cjs`、`electron/preload.cjs`、`src/shared/types/ipc.ts` 暴露上述风险接口。`image_studio_risk_checks` 的建表/迁移在 `sqliteDatabase.cjs`，历史记录应只读保留。
- 图像请求：`imageStudioService.start` 校验非空、10,000 字、张数、最多 4 图、受管资产、PNG 尺寸/总字节、选区和来源 SHA，经 `aiService.withQueueScope().generateImage` 入全局图像队列；`onSent` 记发送时间，重启时已发任务转 `unknown`，不自动重发。当前局部编辑仅按 `requestId` 查旧任务，普通/参考/PSD 无统一事务幂等。
- 配置：图像模型从全局 `configStore.load().image_model` 读取；`aiService` 支持现有金龙兼容图像 adapter。现有设置的图像配置返回 Renderer 包含 Key，不能直接当新模块脱敏连接状态。需新建本模块作用域且不复制其他渠道 Key。
- 来源：`imageStudioSources.cjs` 已有来源状态、七天检查、失败退避、整源事务刷新及个人库关联；尚无 YouMind 清单适配/完整离线快照/本地检索。`client/package.json` 打包 `dist/`、`electron/`、`assets/`；新知识资源必须纳入打包核查。
- 版本：客户端 package 与实际 npm 锁文件根版本需要联动；登录/关于/安装包版本读取链路后续验证。真实金龙鉴权、Nano 协议和计费出图均未在基线核实。
