# v1.8.1 局部修改 LE-R2 实施与验收记录

2026-09-27；分支 `v1.8.1-PSDopt`，开始时 HEAD `a682d9ba52669b3d1ba230cf01c9910a5ad4c812`。按已选 `LE-01-approved.png` 和 Handoff 实际查看后实施。未切分支、重置、提交、推送、合并或发布。所有 UI 截图来自隔离 `userData` 的真实 Electron 进程及受管猫图夹具，不是设计图、静态 HTML 或登录页。业务用户数据未用于探针。

## 改动

- 局部修改改为上工具栏、左侧大图、右侧宽卡、底部固定提交；删去补选、减选、手动新增区域。矩形、闭合画笔、既有离线 SAM 按一次选择生成一张输入卡；空白项只在离开、提交或明确撤回时结算。区域与意见用稳定 ID 保存，撤回/重做同时恢复遮罩、文字、顺序，视图操作不进历史。
- 图片原始坐标存遮罩；普通滚轮移动，Ctrl＋滚轮缩放，空格拖动，小地图导航。选区有透明填充、边缘和编号，双向选择卡片并自动聚焦。有效项关闭/清空有确认，失败后保留编辑内容。
- 编辑请求绑定打开时的 `workId` 和源图 SHA-256；每区独立意见、工具、遮罩进入任务快照并在 `aiService` 原队列中作为标注图发送。重复 `requestId` 返回原任务；不自动重试或多次计费；生成结果沿用原服务的选区外原像素合成及新版本记录。前后端均以至少 4 个共享内点判为实质重叠，1 像素接边允许。
- 原 PSD `refine` 独立保留。只读 Reviewer 最终复核未发现 P0/P1 代码阻断；其指出的空白候选撤回、SAM 晚到、焦点、小地图、重叠规则与逐字重算问题已修复。

## 证据层

| 层 | 结果 | 文件 |
| --- | --- | --- |
| 单元/模拟 | 局部会话、编辑请求、接边/重叠、像素保护、PSD 等聚焦 15/15 通过；CJS check、`npm.cmd run build`、`git diff --check` 通过 | `client/electron/services/imageStudioEditSession.test.cjs`、`client/electron/services/imageStudioService.test.cjs` |
| 真 Electron UI | 1536×1024 空态、选后聚焦、三处、删第二处、缩放；1440×900/1280×800/1024×768 无工具栏溢出，输入框 106px，提交区可见；空格拖动、撤回重做、清空后恢复、双向联动、关闭确认与焦点返回通过 | `result.json`、`extra-result.json`、`interactions-result.json`；`LE-S01-open.png` 至 `LE-S07-failure-recovery.png` |
| 真实 SAM | 隔离 Electron 调用已安装离线 SAM，在猫照片点选获得非矩形对象遮罩；选后卡聚焦 | `LE-S08-real-sam.png`、`sam-result.json` |
| 失败恢复 | 隔离配置设为模型不可用，真实 Main 拒绝发图；修改意见和选区仍在，任务增加数 0；脚本恢复配置 | `LE-S07-failure-recovery.png`、`failure-result.json` |
| PSD 细修回归 | 既有 12 层会话中打开 `refine`，无局部意见卡；在真实对象层用橡皮改变 alpha 114550→113683 像素并保存；重新经 IPC 读取后仍为 113683 | `LE-S08-psd-refine.png`、`psd-refine-result.json` |
| 全量 Node | 327 项，298 通过、28 失败、1 跳过。此前 321 项的 27 个失败标题仍在；新增 1 个失败是 `packages only target-platform Agent tools` 对既有 SAM 打包资源的断言，非局部修改代码引入。未把全量回归宣称通过 | `full-tests-final.txt`，旧基线 `../full-tests.txt` |
| 真实中转/物理系统 | 本轮未新增计费图片编辑请求；没有把旧版真实两区编辑、旧 PSD 样例当 LE-R2 的模型验收。Windows 物理 125% DPI、Photoshop 打开也未执行 | 旧版证据 `../report.md` 仅供历史对照 |

## LE-T01—LE-T48 逐项结论

“通过”只指表内注明的层；“部分”表示代码或较低证据层存在，但目标层未齐；“未执行”保留真实测试缺口。

| 编号 | 结论 | 本轮证据或缺口 |
| --- | --- | --- |
| T01 | 通过 E | `LE-S01-open.png`，左图右卡、上工具、固定提交 |
| T02 | 通过 E | `result.json` 初始卡数 0 |
| T03 | 通过 E | `LE-S01-open.png`，仅三种工具 |
| T04 | 部分 E | 正向框选松开出卡 `LE-S02-first-selection.png`；反向拖动未独立执行 |
| T05 | 部分 U | 小矩形面积门槛和边界裁切在代码；极小/边界实机样例未跑 |
| T06 | 部分 E | `brush-result.json` 闭合画笔内部 alpha 255、外部 0；未完全闭合样例未独立跑 |
| T07 | 通过 E/SAM | `LE-S08-real-sam.png`，真实离线分割猫 |
| T08 | 部分 R | SAM 晚到序号作废逻辑已审；关窗/撤回中途实机竞态未跑 |
| T09 | 通过 E | `LE-S02-first-selection.png`，空卡聚焦且缩放仍保留 |
| T10 | 通过 U/E | `brush-result.json`，第二次选择自动放弃上一空卡，仍为区域 1 |
| T11 | 部分 U | `trim()` 空白结算；仅空格/换行实机未跑 |
| T12 | 未执行 | Windows 中文输入法组合、Enter/Esc 实机未跑 |
| T13 | 通过 E | `LE-S03-three-regions.png`、`result.json` 三条对应文字 |
| T14 | 通过 E | `interactions-result.json` 图片编号与卡片双向激活 |
| T15 | 通过 E | `LE-S04-delete-middle.png`、`result.json` 剩余两条原文不变 |
| T16 | 通过 U/E | `extra-result.json` 删除后 undo 3、redo 2；会话测试核对 ID/文字/遮罩 |
| T17 | 部分 U | 会话测试覆盖清空再输入时保留；真实 textarea 连续输入未跑 |
| T18 | 通过 U | 会话测试覆盖离开空卡和一步撤回；实机未跑 |
| T19 | 通过 E | `extra-result.json` 清空 0、撤回 2 |
| T20 | 部分 R | 键盘处理不拦截 textarea 原生 Ctrl+Z；中文输入框实机未跑 |
| T21 | 通过 E | `interactions-result.json` 缩放后 redo 可用 |
| T22 | 部分 U | 新增区域清除 redo 的会话状态逻辑已审；独立样例未跑 |
| T23 | 通过 E | `result.json` 滚轮前后均 89%，scrollTop 91→182 |
| T24 | 通过 E | `result.json` Ctrl＋滚轮 89%→162%，DPR 保持 1 |
| T25 | 未执行 | 右侧列表/textarea 各自滚轮未单独采样 |
| T26 | 部分 E | `extra-result.json` 空格拖动 x 0→205、y 182→327；textarea 输入空格未单独采样 |
| T27 | 部分 E | fit、100%、按钮和滑块可操作，截图中比例正确；交替循环未量化 |
| T28 | 未执行 | 缩放/拖动后同点坐标误差未做逐像素测量 |
| T29 | 部分 E | 四档窗口布局及原图像素遮罩；Windows 物理 125% 未执行 |
| T30 | 部分 R | pointercancel/失焦取消逻辑已审，画布外松开竞态未实机测 |
| T31 | 部分 U | 接边 false、实质交叠 true 的服务测试通过；UI 重叠提示未实机截图 |
| T32 | 部分 R | SAM IoU > .9 的重复命中激活逻辑已审；重复点同对象未实机跑 |
| T33 | 部分 E | `interactions-result.json` 小地图点击导致 scrollTop 91→182；拖动未独立跑 |
| T34 | 部分 U | 提交时剔除空卡，3 区模拟请求通过；n＋临时空卡组合未实机发送 |
| T35 | 通过 U | 服务测试断言逐区意见出现在各自标注图请求中；本轮无 M |
| T36 | 未执行 M | 本轮未额外授权付费中转双区编辑及结果视觉判断 |
| T37 | 通过 U | 服务测试逐像素断言选区外原像素不变；本轮无 M |
| T38 | 部分 U | 同 requestId 返回同 taskId 且任务行数 1；快速连击实机未跑 |
| T39 | 部分 U | 已发送停止等待测试通过、无自动重发；当前 UI 未实机模拟网络未明 |
| T40 | 部分 U | 源 workId/hash 固定并在 Main 拒绝变更；另选主图时新结果归属未实机跑 |
| T41 | 部分 E/U | 失败保留截图和 taskDelta 0；成功模拟生成新 work，真实 LE-R2 模型完成未验 |
| T42 | 通过 E | `interactions-result.json` 取消确认、继续编辑保留原文 |
| T43 | 部分 E | 三项和 106px 输入高度、右栏独立滚动/固定 footer；500 字样例未跑 |
| T44 | 部分 E | 四档真实 Electron CSS 视口 `extra-result.json`，无工具栏横向溢出；物理 125% 未跑 |
| T45 | 部分 E | 开关窗焦点返回 true、Tab 约束代码已审；完整 Tab/减少动态效果实机未跑 |
| T46 | 通过 E/R | `psd-refine-result.json` 12 层、alpha 保存并经 IPC 回读一致，无意见卡 |
| T47 | 部分 R | 聚焦图片/提示词/PSD 测试通过；完整旧业务回归和全量 Node 未过 |
| T48 | 部分 U/R | 构建、CJS、聚焦 15/15、只读复核完成；全量 Node 28 失败如上 |

## 遗留与实际限制

当前 UI 和请求接通已完成，但 LE-R2 新版逐区编辑仍缺一次明确费用授权下的真实模型端到端视觉验收；无法据模拟结果声称猫和抱枕最终图像均被正确修改。物理 Windows 125% DPI、中文输入法、Photoshop 实机打开未测。全量 Node 的 28 个失败保持原状，本轮没有修改投标内容链路和打包规则来消除与局部修改无关的失败。PSD 背景补全的既有质量门问题仍见 `../report.md`，本轮只验证 `refine` 兼容。
