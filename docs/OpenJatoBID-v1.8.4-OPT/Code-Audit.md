# 代码核对与证据

日期：2026-10-05；只读远端：main@f866acc1d0be33ecbe73f5831bed21771389eaed。没有修改仓库或用户本地文件。

## 已确认与待确认

| 发现 | 证据位置/符号 | 结论边界 |
|---|---|---|
| checkbox触发enable | management/src/features/resources/ResourceCenterPage.tsx：source.enabled的onChange、act/busy | 已确认链路；没运行用户安装包 |
| enable立即同步 | management/electron/services/resourceSyncService.cjs：enable、check、jobs | 已确认；jobs按来源互斥，不等于跨来源持久FIFO队列 |
| partial仍可发布成功项 | resourceSyncService：completed/failures、publishSource | 已确认；失败旧条目会混入completed，需单独统计 |
| 空successAt显示“尚未检查” | ResourceCenterPage date工具与最后检查/成功列 | 已确认文案歧义 |
| 无变化不会新增发布 | resourceStore.cjs：businessContent、changesBetween、publishSource | 已确认现有保护；“每次重试都增版”尚待实际复现，不应推翻保护 |
| 审计仍在页面details里 | ResourceCenterPage底部details、status.audits | 已确认；应转按需查询的查看层 |
| 卡片body缺少一致padding | ResourceCenterPage裸p/技能申请无header；app.css的.settings-panel > header | 已确认DOM/样式不一致；实际安装截图需Codex补测 |
| 客户端版本按钮用于历史摘要 | client/src/app/ResourceUpdateDialog.tsx：history、digest({version,fromVersion}) | 不等于切换已应用快照；仍应去版本化 |
| PPT只有projects/workspace/templates三视图 | client/src/features/ppt/PptPage.tsx：View | 未独立实现新的Agent入口视图 |
| 制作为plan/confirm/generate按钮链 | PptPage：submitAgent、确认当前方案、最近一次完整答复 | 已有工具链但非完整聊天体验 |
| 已有可复用PPT保护 | client/electron/services/pptService.cjs：assertIdle、makeCandidate、commit、scanPages、agent | 保留候选、写锁、hash、局部修改保护 |
| 宿主已能提问 | pptService.cjs：ppt_ask、requestUserQuestion | 需核对PPT页面是否真实接收及作答，不能仅有工具定义 |
| 固定组件受控 | pptRuntimeService.cjs：SCRIPTS、AppContainer、verify | 不能开放shell实现所谓充分使用 |
| 锁定技能6.6.0 | client/electron/services/ppt-runtime-lock.json | 本轮不自动升级上游 |
| 客户端软件1.8.4 | client/package.json | 不是资源发布版本或Pi依赖版本 |

## “14项未完成”解释

条目prepare捕获异常时failures增加，逐项审计ITEM_FAILED。已有旧条目则放回completed供保留；其他已成功条目可发布。finish有error时不推进success_at。于是“检查有时间 / 成功为空 / 14项未完成”可以同时成立。

这些证据不足以判断14项具体为什么失败。实施时先从本地resource_audit取得对应任务的脱敏记录，建立按阶段错误分布，选择至少一个真实失败fixture复现。无法读取用户运行数据时保留“运行根因未验证”，但仍可实现已确定的交互和统计修复。

## 取证来源（固定提交）

下列源链接便于Codex核对；它们是代码证据，不是已运行功能证明。

- https://github.com/migrant1124/OpenJatoBID/tree/f866acc1d0be33ecbe73f5831bed21771389eaed
- https://github.com/migrant1124/OpenJatoBID/blob/f866acc1d0be33ecbe73f5831bed21771389eaed/management/src/features/resources/ResourceCenterPage.tsx
- https://github.com/migrant1124/OpenJatoBID/blob/f866acc1d0be33ecbe73f5831bed21771389eaed/management/electron/services/resourceSyncService.cjs
- https://github.com/migrant1124/OpenJatoBID/blob/f866acc1d0be33ecbe73f5831bed21771389eaed/management/electron/services/resourceStore.cjs
- https://github.com/migrant1124/OpenJatoBID/blob/f866acc1d0be33ecbe73f5831bed21771389eaed/management/src/styles/app.css
- https://github.com/migrant1124/OpenJatoBID/blob/f866acc1d0be33ecbe73f5831bed21771389eaed/client/src/app/ResourceUpdateDialog.tsx
- https://github.com/migrant1124/OpenJatoBID/blob/f866acc1d0be33ecbe73f5831bed21771389eaed/client/src/features/ppt/PptPage.tsx
- https://github.com/migrant1124/OpenJatoBID/blob/f866acc1d0be33ecbe73f5831bed21771389eaed/client/src/styles/feature-ppt.css
- https://github.com/migrant1124/OpenJatoBID/blob/f866acc1d0be33ecbe73f5831bed21771389eaed/client/electron/services/pptService.cjs
- https://github.com/migrant1124/OpenJatoBID/blob/f866acc1d0be33ecbe73f5831bed21771389eaed/client/electron/services/pptRuntimeService.cjs
- https://github.com/migrant1124/OpenJatoBID/blob/f866acc1d0be33ecbe73f5831bed21771389eaed/client/electron/services/ppt-runtime-lock.json
- https://github.com/migrant1124/OpenJatoBID/blob/f866acc1d0be33ecbe73f5831bed21771389eaed/client/package.json
- https://github.com/migrant1124/OpenJatoBID/blob/f866acc1d0be33ecbe73f5831bed21771389eaed/docs/OpenJatoBID-v1.8.4-PPT-UI/UI-Handoff.md
- https://github.com/hugohe3/ppt-master/blob/44c10ed0bc3a9e1df7a25aa179ae7c26db09469b/skills/ppt-master/SKILL.md
- https://github.com/hugohe3/ppt-master/blob/44c10ed0bc3a9e1df7a25aa179ae7c26db09469b/skills/ppt-master/workflows/generate-pptx.md

## 旧设计中不能沿用的内容

第一轮生成海报中每日同步、额外菜单/品牌、客户端资源版本选择、必经大纲步骤，均不能作为本轮需求。最近流程概览图中的宣传卡片和示例导航也不等同用户确认。用户最后的文字纠正才是业务权威。

本次没有取得可运行安装包环境、真实14条失败记录或分享链接页面；实际Windows视觉回归及失败根因复现留在验收报告中，禁止标成已通过。
