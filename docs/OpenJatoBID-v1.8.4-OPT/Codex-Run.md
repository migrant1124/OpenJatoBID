# Codex一次性执行指令

把本目录放到项目根目录的`docs/v1.8.4-OPT/`。由用户创建并切换`v1.8.4-OPT`分支后，将下面整段粘贴给Codex。

---

你正在优化OpenJatoBID。实施分支必须是v1.8.4-OPT，客户端软件保持1.8.4；不是Pi依赖升版任务。先读根目录AGENTS.md、开发说明.md，以及docs/v1.8.4-OPT/中的README.md、v1.8.4-OPT-spec.md、Code-Audit.md、UI-Handoff.md、UI-State-Matrix.md、Acceptance-Test-Cases.md和ui/prototype.html及相关PNG。先理解全部合同再写代码。本轮用户最后的流程纠正优先于仓库旧D1.2和历史生成海报。

必须完成下面各阶段，除真正阻塞项外连续推进，不仅停留在分析或输出建议。每一步写清实际输入、输出、证据和未完成原因。不得把新增UI、静态原型或mock通过当作功能验收。

步骤1｜核对本地基线。
输入：当前仓库、Git分支/HEAD/status、AGENTS.md、实际package.json/锁文件、用户未提交修改。
输出：docs/v1.8.4-OPT/reports/preflight.md，记录本地与取证main@f866acc1d0be33ecbe73f5831bed21771389eaed的相关差异、当前两端软件版本、Pi与ppt-master锁定情况及复用点。
约束：当前分支不为v1.8.4-OPT则停止写入；不能替用户建/切分支或回退。保留用户变更和已完成精简。禁止git add/commit/push/pull/merge/rebase/reset/clean、打标签、发布、部署或Actions触发。不要把旧AGENTS中的过时入口名当依据全仓替换，以真实桥接为准。

步骤2｜建立需求追踪、失败证据和能力映射。
输入：ResourceCenterPage/resourceSyncService/resourceStore、PPT页面/服务/运行时、固定ppt-master 6.6.0完整route文档、可取得的脱敏ITEM_FAILED审计。
输出：requirement-traceability.md、resource-failure-diagnosis.md、ppt-capability-map.md、实施文件清单。每项需求关联源码、UI编号、测试和证据路径；说明14项失败的已知/未知边界。
约束：不能编造失败根因；不能声称“每次重试必增版”。逐条检查上游route到宿主工具与UI，不把“选择ppt-master”冒充完整接入。不自动升级固定依赖或放开shell/联网。

步骤3｜实现批量确认与持久队列。
输入：M1及规格第4节、既有来源数据和调度器。
输出：checkbox本地草稿、批量确认、原子保存+排队IPC、幂等requestId、来源去重、任务恢复、独立操作状态及单元/集成测试。
约束：checkbox和轮询不触发下载；只有确认后的有效来源进入队列；默认来源级FIFO1、文件准备最多2；提交立即返回accepted不冒充completed。保留固定7天锚点，手动检查/重试不移动周计划；取消、停用、重启不丢旧镜像、不碰授权与统计。

步骤4｜修复发布语义与状态统计。
输入：changesBetween/businessContent、prepare失败分支、客户端digest/history。
输出：稳定内容比较、失败条目重试、prepared/unchanged/reusedOld/failed/published分开统计、准确空时间文案、客户端去版本化更新记录。
约束：无变化/全失败/旧条目复用不增发布不弹更新；部分有效变化可发布。保留内部version/hash/兼容协议、已读游标及项目锁定。删除员工端资源版本按钮而不是删除项目历史恢复。真实失败只收纳到详情，不伪装成功。

步骤5｜统一管理端资源UI。
输入：UI-Handoff、A系列状态、现有mg令牌和组件。
输出：所有资源卡片统一Header/Body/Footer、字号/间距、来源表、紧凑摘要及“同步审计与只读计划”按钮与查看层。
约束：不在首页渲染原始log；审计按需分页，不随首页轮询传大量记录；镜像体积/可用空间用辅助字号且有padding；不全局改h2/p，不影响授权/统计/其他设置页。周期只读每周，无每天同步设置。

步骤6｜实现新的PPT Agent入口和持久会话。
输入：P1–P4、C系列Agent状态、现有PptPage、对话组件和PPT服务。
输出：首页点击开始直接进入红标题留白Agent页；上传、默认ppt-master技能选择、模板选择、整套/单页切换；持久消息/附件/选择；首次需要落盘时简洁目录确认；同一项目在Agent页和工作区共享会话。
约束：首页和一级导航基本不变；不先弹长配置表；无专业/极速/创意/自由模式栏、扳手、模型/运行时选择器或八宫格功能广告。删除必经大纲跳转但保留内部计划。普通对话模式不能获得PPT工具权限。

步骤7｜接通ppt-master两阶段确认及真实工具链。
输入：锁定SKILL_DIR、所选route、会话状态、现有ppt_ask与Agent问答事件、能力映射缺口。
输出：当前聊天内阶段1和阶段2确认、三种方案意图、模板准备、规格与执行锁、真实制作/检查/修复/预览/导出；问题精确投递、回答后原任务恢复；取消及checkpoint恢复。
约束：确认带questionId/gateId/phase/specFingerprint/范围，必须来自用户操作；waiting_user可回答，不能被全局busy/assertIdle堵死。单页不是Quick，严格一页且无必经大纲。新工具只按白名单和参数schema适配，保留完整性门禁、AppContainer、外部文件保护及费用授权。需要新增权限/付费服务/依赖升版时标BLOCKED，不擅自实施，也不把缺口藏掉。

步骤8｜保持后续工作区和辅助流程。
输入：既有PptPageEditTools/PptProjectTools/PptTemplateActions/PptSkillPanel及C系列工作区/导出/恢复状态。
输出：同一会话接续、三栏预览编辑、真实单页修改、图表表格输入、批注讲稿、模板管理、旧PPT导入/保留原文美化、个人模板、历史恢复、存储迁移和缓存操作。
约束：不大改后续布局；不删除已有功能；源文件权威、候选+写锁+revision/hash保护不减；未知收费结果不自动重发；不承诺原生编辑全部对象或静态视频保留动画。

步骤9｜分层测试并对照图稿。
输入：Acceptance-Test-Cases全部必测用例、每个UI状态、真实依赖和Windows安装环境。
输出：unit/integration/renderer/SDK-proxy/Electron/Windows-install/Office-WPS分层结果；actual截图与目标截图对照；修复全部可复现P0/P1。最少检查1600×1000、1366×900、1280×800及Windows125%缩放。
约束：先读取实际scripts再运行；客户端至少npm run build、npm run test:ci-upgrade及本轮测试，管理端npm test和npm run build。涉及Main/preload需node --check并做Electron联调。正式打包不得发布，可仅在独立本地临时目录构建测试安装包并遵守私有凭据要求；不能绕过许可证/初始管理员文件。没有Windows/真实模型/Office时分别标NOT_RUN或BLOCKED，不以mock替代PASS。

步骤10｜只交付，不提交或发布。
输入：所有改动、测试、截图、迁移及阻塞记录。
输出：implementation-record.md、test-report.md、visual-diff-report.md、配置说明、迁移回退方案、最终需求追踪表；报告真实文件列表、完成/部分/阻塞项及复现方式。
约束：不得只说“已按图实现”。每个需求必须能追到源码和证据；核心闭环未通不得宣称全部完成。报告结束后保持工作区供用户检查，不暂存、不提交、不推送、不合并、不打标签、不发布。

最终验收焦点：多选确认后才排队；固定每周；审计按钮化；资源版本只在内部；四类卡片统一；失败状态真实；PPT首页保留、Agent同页多轮沟通、单页不进大纲；后续工作区及数据安全不回退。

---

## 这段指令在做什么

先核对真实分支和已有代码，再分别修复资源任务与PPT会话，最后对照图稿做真实安装测试。它要求Codex把每个按钮接到真实业务，不允许仅“画出界面”；也不允许自动提交或发布你的仓库。
