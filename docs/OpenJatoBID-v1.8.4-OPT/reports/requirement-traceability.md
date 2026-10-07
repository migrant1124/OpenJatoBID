# 需求—源码—UI—测试—证据

以冻结规格及用户最后流程为准，不另造产品规格。实际输入目录为docs/OpenJatoBID-v1.8.4-OPT，原107个暂存交接文件不动。

| 需求及规格章节 | 源码 | UI编号 | 用例 | 实现及证据边界 |
|---|---|---|---|---|
| M1／§4 | resourceStore、resourceSyncService、resourceIpc/preload/ipc；ResourceCenterPage | A01—A04/A13 | M01—M19 | 原子事务、revision/requestId、持久FIFO、重启恢复；部分物理/组合验收待执行 |
| M2／§5 | resourceCenterService、resourceStore；ResourceCenterPage | A06/A07 | V03—V07、R01—R04 | 分页按需审计、只读固定周计划、脱敏；正式14失败边界独立记录 |
| M3／§6 | resourceClientService；ResourceUpdateDialog、PptPage | A10/C53/C54 | R05—R14 | 内部版本/hash/兼容协议保留，界面去版本；真实多次发布与忙碌组合未验 |
| M4／§7 | management/src/styles/app.css；ResourceCenterPage/App.tsx | A01/A08/A10/A11 | V01/V02/V08/V10 | 标题16、正文14、辅助12—13、卡片body20；真实computedStyle/多尺寸 |
| M5／§3/5/6 | resourceSyncService、resourceStore、resourcePreviewService | A05/A06 | R01—R09、M18 | 稳定内容比较、统计拆分、失败旧复用、无变化零发布；四格式真实解码，未称恢复全部正式原图 |
| P1／§8 | PptPage | C00/C01/C47 | P01/P04/P05 | 首页保留，开始直接Agent；首次落盘才目录确认 |
| P2／§8/9 | PptAgentConversation、feature-ppt.css | C01—C14 | P02/P03/P07—P14 | 红标题留白，上传、真实默认技能、模板/个人模板、整套/单页同页 |
| P3／§9/11 | pptConversationStore、pptService、pptContractAudit、pptRuntimeService、agentService | C15—C26/C41—C46 | D01—D14、K01—K10 | 真实SDK/Proxy/AppContainer/固定工具；两阶段/三方向/执行门禁；旧稿两路线、四类型模板；Image-to-PPTX完整路线BLOCKED |
| P4／§10 | PptService、PptPage/PptTemplateActions、ipc.ts | C14/C20/C28/C35/C52 | S01—S05 | 单页严格一页不Quick；无独立大纲；当前页后插入保留旧四页 |
| P5／§12—15 | PptPageEditTools、PptProjectTools；pptProjectStore/pptExportService/pptService | C27—C40/C50—C61 | W01—W10、E01—E12 | 三栏和同一会话、源/hash/写锁/journal/历史；审阅记录revision，真实导出回执；独立安装与人工全对象未验 |

114用例的独立状态、源码、测试与证据逐行见[acceptance-results.md](acceptance-results.md)；76个UI状态独立截图/缺口见[visual-diff-report.md](visual-diff-report.md)；实际命令退出码见[test-report.md](test-report.md)。不能把该追踪表的实现描述当作全部验收通过。
