# v1.8.4-OPT 实施记录

实际分支 `v1.8.4-OPT`，HEAD `f866acc1d0be33ecbe73f5831bed21771389eaed`。客户端1.8.4、管理端1.4.2、两个Pi包精确1.0.0、ppt-master6.6.0/Python3.13.16保持。实际输入位于docs/OpenJatoBID-v1.8.4-OPT（用户所述短目录不存在）；原107份暂存交接资料不移动、不改写。用户授权十步范围内计划后连续实施，计划追加tasks/plan.md第30节，tasks/todo.md为唯一执行状态。

实现和可执行闭环已有本地证据；完整安装/外部模型/Office/UI人工确认与部分组合用例尚未完成。release_ready=false，不能宣称全部完成。会话页面、资源按钮均连接实际服务，不以原型按钮作功能交付。

| 步骤 | 实际输入 | 实际输出及证据边界 |
|---|---|---|
| 1 基线 | 真实分支、HEAD/status、根规则、开发说明、版本/锁、107份原输入 | preflight.md / preflight-baseline.json；用户源文件和index逐hash保护 |
| 2 追踪与审计 | 完整冻结规格/代码核对/UI/handoff/92 PNG、固定6.6.0全routes、脱敏正式审计 | requirement-traceability.md、resource-failure-diagnosis.md、ppt-capability-map.md；14原失败缺原字节，不冒称全恢复 |
| 3 队列 | 选择草稿、原子确认IPC、持久FIFO、来源去重及周锚点 | schema6加法迁移、revision/requestId、来源1/文件2、running恢复、取消不复活；管理89/89和真实双端 |
| 4 发布 | 稳定业务内容/资产角色hash比较、失败旧复用、分项计数 | 无变化不发布；同commit只重试失败；界面版本内部化，协议/游标/项目历史保留 |
| 5 管理UI | A系列、资源作用域CSS及既有Radix/Bridge | 审计按钮/按需分页、只读周计划、详情/网络/发布/申请真实查看层；字号16/14/12—13、卡片body20px |
| 6 Agent入口 | PPT首页与最后确认的同页流程 | 新增PptAgentConversation及SQLite会话/消息/问题；红标题留白，上传/默认技能/模板/整套单页同页，首次落盘才简洁目录确认 |
| 7 固定工具 | 真实Pi1.0.0/Proxy、固定ppt-master、AppContainer | 阶段1/2与三方向、用户question/gate/phase/fingerprint/request/scope绑定；单页Default、显式Quick、template实际工具；Image-to-PPTX完整路线BLOCKED |
| 8 工作区 | 既有源文件/hash/revision/candidate/journal和三栏 | 同会话接续、旧稿原生/美化新入口、四类型项目模板、当前页后插入、图表输入、讲稿/批注/历史/迁移/人工审阅/真实导出回执；不称全部复杂对象已验 |
| 9 分层验证 | 114个去重验收项、76 UI状态、真实SDK/Electron/Windows/WPS | acceptance-results.md、test-report.md、visual-diff-report.md；真实窗口三尺寸、进程125%；独立安装/Office/模型和全局125%分别记录 |
| 10 审查交付 | 独立只读Reviewer、实际差异、原始日志 | 范围内问题由主代理返回Debug修复复验；最终审查与本报告/迁移回退方案；本地未提交交付，非全部业务验收通过 |

## 本轮源码与测试文件

以下为实际未暂存源码、SQL及测试清单，逐文件hash在final-invariants.json。未改package/锁、依赖、运行包、管理端版本、CI/release/Worker/R2/Secret或已提交精简历史。

- `client/electron/ipc/pptIpc.cjs`
- `client/electron/preload.cjs`
- `client/electron/services/agentService.cjs`
- `client/electron/services/pptContractAudit.cjs`
- `client/electron/services/pptConversationStore.cjs`
- `client/electron/services/pptExportService.cjs`
- `client/electron/services/pptProjectStore.cjs`
- `client/electron/services/pptRuntimeService.cjs`
- `client/electron/services/pptService.cjs`
- `client/electron/services/pptTemplateService.cjs`
- `client/electron/services/resourceClientService.cjs`
- `client/scripts/opt-beautify-electron.cjs`
- `client/scripts/opt-contract.test.cjs`
- `client/scripts/opt-electron-smoke.cjs`
- `client/scripts/opt-ppt-fixture.cjs`
- `client/scripts/opt-ui-electron.cjs`
- `client/scripts/ppt-template.test.cjs`
- `client/scripts/resource-client-electron-smoke.cjs`
- `client/src/app/ResourceUpdateDialog.tsx`
- `client/src/features/ppt/PptAgentConversation.tsx`
- `client/src/features/ppt/PptPage.tsx`
- `client/src/features/ppt/PptPageEditTools.tsx`
- `client/src/features/ppt/PptTemplateActions.tsx`
- `client/src/shared/types/ipc.ts`
- `client/src/shared/ui/AgentQuestionDialogProvider.tsx`
- `client/src/styles/feature-ppt.css`
- `management/electron/ipc/resourceIpc.cjs`
- `management/electron/main.cjs`
- `management/electron/preload.cjs`
- `management/electron/services/databaseService.test.cjs`
- `management/electron/services/migrations.cjs`
- `management/electron/services/resourceCenterService.cjs`
- `management/electron/services/resourceOpt.test.cjs`
- `management/electron/services/resourcePreviewService.cjs`
- `management/electron/services/resourceStore.cjs`
- `management/electron/services/resourceSyncService.cjs`
- `management/src/App.tsx`
- `management/src/features/resources/ResourceCenterPage.tsx`
- `management/src/shared/browserDebugBridge.ts`
- `management/src/shared/ipc.ts`
- `management/src/styles/app.css`
- `sql/workspace_schema.sql`

## 迁移、权限与回退

详见config-and-migration.md。管理端持久任务/幂等操作加法迁移，客户端三张会话表进入既有SQLite；没有使用JSON作为权威流程缓存。迁移验证只在隔离副本/测试库，未对正式工作区运行。普通对话只读、runtime_id=pi、cacheWarming=off、既有Provider/Proxy/队列/业务Store/输出协议及统计不变。没有启用MCP/Codemode/外部Skill自动加载/额外shell/联网或收费重发。

只撤本轮须正常退出两端、备份完整数据及历史，按文件清单反向应用本轮差异；保留用户107输入和已提交精简/Pi成果，不通过Git reset/checkout/stash/clean、降schema或清库恢复。新表可留存，已用会话/资源任务不可静默丢弃。本轮未执行回退。

## 审查修复

独立只读审查的确认问题均由主代理返回Debug实施，Reviewer不改源码。最终补修：当前页后插入重映射内部跳转/页码且覆盖XML等号空白；Quick真实页面允许当前修订人工确认；审阅随页/修订/导出范围失效；回执文件与逐图hash变化不显示旧成品。真实SDK/Electron/双端UI均分别复验，原失败日志保留。

所有构建只在本地隔离目录并明确--publish never；管理端初始凭据使用单独合成测试文件，正式私有凭据/生产数据未改。未暂存、提交、推送、拉取/fetch、合并、变基、切分支、清理、打标签、上传或部署。

末次补执行原NOT_RUN的12项边界：实际源码/SQL/测试清单共42文件；生产源码已冻结，末次仅三份测试脚本变化。28份CJS语法退出0，新增真实SDK/Electron13/13、资源客户端10/10、双端supplement12/12退出0。最终81 PASS、29 NOT_RUN、4 BLOCKED，27/76状态已有actual；既有包的生产文件hash仍对应当前源码，测试脚本不作为软件功能发布。
