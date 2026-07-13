# 招标解析、格式驱动目录与受控写作测试报告

- 日期：2026-07-13
- 分支：`opt/jiexihemulu`
- 需求文件：`D:\download\OpenJatoBID_招标解析_格式驱动目录与写作改造_最终需求.md`
- 需求 SHA-256：`386F8FD5CD1A83A3BC1601061CA0C663186D6B9D2558904D879CC7ED5ABA365D`
- 数据库版本：SQLite v18

## 结论

本轮 T47-T60 的代码、数据迁移、自动化、构建、基础 Electron 运行和 DOCX XML 检查通过。独立复审未发现仍可复现的 P0/P1。

T61 与 CP11 尚未完成：仓库和 `D:\download` 未找到建行珠海、国网湖北、南网超高压、四川烟草四个真实样本，因此不能声明四样本端到端验收通过。

## 自动化证据

### CJS 语法

对本轮 16 个 Main/preload/IPC 核心文件执行 `node --check`，全部通过。

### 服务测试

执行：

```powershell
cd client
node --test electron/services/bidAnalysisResultSchemas.test.cjs electron/services/bidAnalysisTask.test.cjs electron/services/outlineFormatConstraints.test.cjs electron/services/outlineGenerationTask.format.test.cjs electron/services/fixedMarkdownTemplateService.test.cjs electron/services/contentResponseModes.test.cjs electron/services/contentGenerationTask.responseModes.test.cjs electron/services/technicalContextIsolation.test.cjs electron/services/contentIllustrationPlanning.test.cjs electron/services/contentIllustrationGeneration.protection.test.cjs electron/services/technicalPlanExport.test.cjs
```

结果：72 项通过，0 失败。覆盖：

- 19 项解析目录、7 项必选门禁和结构化 JSON；
- 多 profile、显式格式零匹配/并列阻断及全局 `none` 防回退；
- 格式骨架、评分映射、锁定字段、可选节点和编号策略；
- 六种 `response_mode`、固定承诺函、固定表格、证明材料和明确无内容；
- 最低字数补目录、Agent/配图隔离、Store 通用写入与换 ID 绕过；
- 权威 Store 导出、缺证据确认、标题去重和固定正文 DOCX XML 保真。

### SQLite 迁移与 Store 烟测

执行：

```powershell
cd client
.\node_modules\.bin\electron.cmd scripts\technical-plan-format-smoke.cjs
```

结果：通过。覆盖 v17→v18 备份/迁移、重复打开幂等、严格 JSON 失败关闭、旧字段默认、模板确认、专用槽位写入、Profile/Hash 失效及 Store 绕过阻断。

### 客户端构建

执行：

```powershell
cd client
npm run build
```

结果：`tsc --noEmit && vite build` 通过。仅有仓库既有的 chunk 大小警告，命令退出码为 0。

### 差异检查

执行：

```powershell
git diff --check -- . ':(exclude)client/doc/1.2.0.md'
```

结果：通过。排除项是用户原有、与本轮无关的 `client/doc/1.2.0.md` 空行修改，本轮未触碰。

## 运行时证据

使用 `npm run dev:inspect` 启动真实 Electron：

- Vite `http://127.0.0.1:5173/` 返回 HTTP 200；
- Electron 主窗口标题为“佳图智能投标助手”；
- `http://127.0.0.1:9222/json/list` 返回实际 Renderer 页面与 WebSocket 调试地址；
- Chrome 打开本地页面后可见员工登录/授权申请界面，页面标题正确，未捕获到 console error；
- 验收后关闭本轮启动的 Vite/Electron，5173 与 9222 端口均已释放。

由于缺少四个真实样本及对应业务数据，本轮没有伪造招标文件来代替 Step02→Step05 真实页面验收。

## DOCX 检查

`technicalPlanExport.test.cjs` 实际生成 DOCX buffer 并解压读取 `word/document.xml`，验证：

- Renderer 伪造目录不进入技术方案导出；
- `auto`、`preserve-source`、`none` 不重复编号且不截断“1号楼施工方案”；
- 固定承诺函原文、固定表格响应和固定说明进入 DOCX 后文字保持一致；
- `pending`、`needs-manual-input`、模板 Hash/结构错误硬阻断；
- 只有 `missing-required-evidence` 可在标准字段 `acknowledgeMissingEvidence` 明示确认后继续。

## 审查记录

中期审查发现的最低字数补目录、导出旁路、Profile 失效、字段契约、受控 Agent、Store 写边界、配图隔离、任务事件同步、全局 `none` 回退和标题截断问题均已修复并补回归测试。

修复后独立只读复审结论：未发现仍可复现的 P0/P1。

## 未完成项

- 建行珠海真实样本端到端验收；
- 国网湖北真实样本端到端验收；
- 南网超高压真实样本端到端验收；
- 四川烟草真实样本端到端验收；
- 基于上述四样本的 CP8A、CP9、CP10 页面证据汇总和 CP11 最终验收。

## T67 现场回归补充（2026-07-13）

现场日志 `2026-07-13T08-30-34-196Z-招标解析-格式要求-结构提取-8da1e7fa-57a2-4ca3-bca3-dc6c204f36b7.json` 证明：模型正确返回目录编号 `2.10` 和标题“禁止转包、分包承诺函”，但自行构造了请求中不存在的 `source-anchor-2.10`。同一响应在越过该错误后还存在三组分散规则来源，以及固定表格中漏选一个 `<tr>` 的连续性问题，因此本轮没有只修补截图中的单一错误。

修复后执行：

```powershell
cd client
node --check electron/services/bidAnalysisTask.cjs
node --test electron/services/bidAnalysisTask.test.cjs electron/services/bidAnalysisSourceAnchors.test.cjs electron/services/bidAnalysisResultSchemas.test.cjs
npm run build
```

结果：CJS 检查通过；34 项聚焦测试通过、0 失败；`tsc --noEmit && vite build` 退出 0，仅有既有 chunk 大小警告。

另使用上述现场原始响应和本地原始招标 Markdown 做无网络、无 Store 写入的第一阶段重放。修复前依次停在伪锚点、分散规则来源和固定表格漏行；修复后已完成全部第一阶段来源校验并进入固定模板第二阶段。未调用真实模型完成第二阶段、未启动 Electron 页面验收、未打包，最终真实解析结果由用户现场复测确认。
