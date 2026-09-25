# v1.7.4 项目理解增量分层测试报告

## 自动化结果

| 层级 | 命令/方法 | 结果 |
| --- | --- | --- |
| 新增单元与 DOCX 包 | `node --test electron/services/projectUnderstanding.test.cjs` | 25 项：24 通过、0 失败、1 跳过；跳过项仅为系统 Node 与 Electron 原生模块 ABI 不同 |
| 项目理解 + 正文引用保护 | `node --test electron/services/projectUnderstanding.test.cjs electron/services/contentGenerationTask.contentPlanV5.test.cjs` | 44 项：43 通过、0 失败、1 个 Node ABI 跳过 |
| Electron ABI + SQLite | `ELECTRON_RUN_AS_NODE=1 electron --test electron/services/projectUnderstanding.test.cjs` | 25/25 通过，包括 SQLite v25、人工缺口确认和用户排除记忆 |
| 相关目录/正文/导出回归 | 六个聚焦测试文件合并运行 | 71 项：68 通过、2 个既存失败、1 个 Node ABI 跳过 |
| 客户端构建 | `cd client; npm.cmd run build` | 通过：TypeScript 检查和 Vite production build 均成功 |
| Main/CJS 语法 | `node --check` 检查研究、项目理解、任务和导出服务 | 通过 |
| Electron 开发启动烟测 | `cd client; npm.cmd run dev` | Vite 在固定 `127.0.0.1:5173` 启动，Electron 进程启动后由测试主动终止；不等同于登录后页面操作验收 |
| DOCX 引用 | 构建真实 `.docx` buffer 并检查 `word/document.xml` 与关系文件 | 通过：`〔PU-1〕`、来源标题、HTTPS 超链接存在，内部 `PU:evidence_id` 不存在 |

两条既存失败均位于 `technicalPlanExport.test.cjs`：测试仍期待旧的 pending/manual 整本硬门禁和缺少证明材料硬门禁；当前产品基线已取消该全局门禁。本轮没有修改测试或恢复旧行为，符合项目理解规格第 12.5 节。

## 新增覆盖

- 等价章节复用、项目概况区分、安全位置、幂等补全和用户排除。
- 自然拆分规则复用、事实型/重叠主题保守不拆、人工正文及扩写引用标记保护。
- 稳定证据标识、孤儿标记与错误直接引语拒绝；直接关系要求逐字关系片段、类型关键词及同段双端点证明，背景/推导保持显式分类，并检查三段关联链缺口。
- 查询敏感字段拒绝、公开 HTTPS/DNS 固定、响应流 2MB 上限、GBK/UTF-8 HTML 正文和发布元数据提取。
- 授权内部来源路径脱敏、公开/内部混合预算、Brave 配置范围、整体预算/取消和 SQLite v25 兼容读取。
- 可人工确认缺口与阻断缺口分离；无研究版本、未通过内容审核或未绑定当前版本人工审核时只导出待复核稿。
- 整本及当前项目理解小节 Word 的独立重编号、参考依据裁剪、正文标记、来源标题、链接关系及内部身份隐藏。

## 未完成的真实验收

| 项目 | 状态 | 原因/下一步 |
| --- | --- | --- |
| Electron 页面人工操作 | 部分 | 开发进程启动烟测通过，并完成 Main/SQLite Electron ABI 自动测试；未在真实登录后的技术方案页面逐项点击 |
| 安装包内真实 Brave 联网 | 未验收 | 当前工作区没有用户提供的 Brave Search API Key，未调用付费/计量接口 |
| 真实政府页面/PDF 与模型证据链 | 未验收 | 依赖上项凭据及用户确认的公开研究主题；自动化只验证提取、逐字匹配和关系契约，不冒充真实资料核验 |
| Word/WPS 桌面打开 | 未验收 | 已验证 DOCX ZIP/XML 和超链接关系，但未由真实 Word/WPS 打开查看长链接、分页和章框样式 |
| 两个授权真实项目样本 | 未验收 | 未提供一个资料充分样本和一个来源不足/格式受限样本的授权副本 |

因此当前结论是：代码、SQLite 契约、自动化 DOCX 引用和客户端构建完成；真实联网、真实页面操作、Word/WPS 桌面显示及两个业务样本仍待验收，不能宣称完整产品验收通过。

整体预算和用户取消会把同一个 `AbortSignal` 贯通到模型 HTTP、JSON 修复和重试链；本地延迟 HTTP 测试确认传输关闭且没有第二次请求，旧结果也不会写回。

## 建议验收顺序

1. 用户配置 Brave Search API Key，并选择不含秘密信息的公开研究主题。
2. 在已登录客户端中对两个授权项目分别运行获取、刷新、应用和人工复核，确认正文没有被静默覆盖。
3. 分别导出普通和章框 Word，用 Word/WPS 打开核对链接、引用编号、长链接换行和待复核标识。
