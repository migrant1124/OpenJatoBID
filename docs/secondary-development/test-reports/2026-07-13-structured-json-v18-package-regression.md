# 结构化 JSON 二次校验与 SQLite v18 安装包回归报告

日期：2026-07-13

## 结论

- “本地数据库版本 18 高于当前客户端支持版本 17”来自旧的 1.2.0 构建产物；源码迁移逻辑本身已经是 v18。
- “投标文件格式要求”和“报价要求”此前会把业务字段校验失败统一显示成“不是有效 JSON”，并按默认策略重复提交完整招标文件。单项最多执行 3 次完整提取和 3 次修复。
- 两项现改为一次完整提取、JSON 对象解析、确定性严格二次校验；只有二次校验失败时才针对当前结果和完整字段契约执行一次修复，不再因语义错误重复提交完整招标文件。
- NSIS、ZIP、MSI 已重建，三种产物中的 `app.asar` SHA256 完全一致，均包含 SQLite schema v18 和本轮结构化二次校验代码。

## 根因证据

### 安装包数据库版本

- 旧安装目录、旧 NSIS 解包目录和旧 ZIP 中的 `app.asar` SHA256 均为 `48CECE46CAF66DF634FCDD38685E6BD8DACA128FFAC74390EA791FC85A71155A`。
- 旧 `app.asar` 内 `sqliteDatabase.cjs` 的 `schemaVersion` 为 17。
- 用户工作区 `yibiao.sqlite` 的 `PRAGMA user_version` 为 18。
- 当前源码 `sqliteDatabase.cjs` 的 `schemaVersion` 为 18；`electron-builder` 已正确包含 `electron/**/*`，故障由 v18 改造后未重新打包导致。

### 结构化解析耗时与失败

- 两个新任务使用严格 normalizer，但生成提示没有完整列出模板外层字段、限价、公式、报价表等必填结构。
- `requestJson` 默认 `max_retries=2`；每轮均执行“完整提取、通用修复、严格复验”。
- 本次现场元数据显示，每项出现 3 次约 77,455～77,700 prompt-token 的完整请求，以及 3 次约 12,087～31,366 prompt-token 的修复请求。
- 通用修复会截断待修复结果至 60,000 字符，且最终把 JSON 语法错误和业务 schema 错误统一改写成“不是有效 JSON”。

## 修改范围

- `client/electron/services/bidAnalysisTask.cjs`
  - 补齐两项完整字段契约，并由生成提示和修复提示共同复用。
  - 结构化首轮仅校验 JSON 对象，设置 `max_retries: 0`。
  - 首轮语法修复也使用专用修复器并保留完整当前结果，不再经过全局 60,000 字符截断。
  - 首轮结果进入 `parseJsonResponseContent`，使用原严格 normalizer 做二次校验。
  - 二次校验失败时，仅提交当前结果、精确校验问题和完整目标契约进行一次专用修复；不重复提交完整招标文件。
  - 二次修复仍不合格时返回“二次校验失败”，不保存为成功。
  - 空结构化 profile 不再被 7 项完成门禁误判为成功。
- `client/electron/services/bidAnalysisTask.test.cjs`
  - 覆盖两项一次提取、超过 60,000 字符的完整语法修复、二次严格校验、失败不落库、空 profile 门禁、专用修复提示和完整契约字段。
- `client/electron/services/outlineGenerationTask.format.test.cjs`
  - 将旧的非法空报价 profile fixture 更新为严格契约允许的全局 `not-specified` profile。
- `tasks/todo.md`
  - 新增并关闭 T62/T63。

## 自动化与构建

| 验证项 | 结果 |
| --- | --- |
| `node --check electron\services\bidAnalysisTask.cjs` | 通过 |
| `node --test electron\services\bidAnalysisTask.test.cjs electron\services\bidAnalysisResultSchemas.test.cjs` | 21/21 通过 |
| 全量 Electron CJS 测试 | 91/91 通过 |
| `npm run dist:win` | 通过，包含 `tsc --noEmit`、Vite build、NSIS 和 ZIP |
| `npx electron-builder --win msi --publish never` | 通过 |

Vite 仅输出既有大 chunk 警告，命令退出码为 0。

## 产物核验

| 产物 | SHA256 |
| --- | --- |
| `Jato AI BID Setup 1.2.0.exe` | `9745B448020340BC88C5272B7EE941091FD91E99D698688C0B9433A75E70B2B4` |
| `Jato-AI-BID-1.2.0-win-x64.zip` | `153A395E976445A804542FB4ACB3BFE3CC98E769BE88A91C967529E3D01D0485` |
| `Jato-AI-BID-1.2.0-x64.msi` | `2ABA2E77FBCAA0985944194D4808D02C8A420A18E8562DFCC826CB5C33B25859` |
| 三种产物内 `resources/app.asar` | `A495F1E6B1AD0C482D57D6777552D316672AFECE1D813B510CC4A94976E33D02` |

对 `app.asar` 反查结果：

- 版本：1.2.0
- `schemaVersion`：18
- 结构化首轮语义重试次数：0
- 首轮和二次校验均使用不截断当前结果的专用修复器
- 二次校验失败文案：存在
- 空 profile 完成门禁：存在
- 完整契约关键字段 `source_location`、`row_template`、`amount_or_rate`、`variables`、`file_formats`：全部存在

## 解包运行验证

使用新 `win-unpacked` 客户端、独立 `--user-data-dir` 和预置 `PRAGMA user_version=18` 的临时数据库启动：

- Electron Renderer 加载完成，未出现“本地数据库初始化失败”或“数据库版本高于当前客户端支持版本”。
- 初始化后 `PRAGMA user_version=18`。
- `PRAGMA integrity_check=ok`。
- 初始化表数量：44。
- 测试进程、调试端口和临时用户目录已清理；未覆盖正式用户数据，未停止用户当前开发实例。

## 尚需现场确认

- 本轮未自动消耗用户模型额度重新解析真实招标文件。安装新包并重新解析两项后，应确认正常路径只发生一次完整提取；若模型结果违反业务契约，应只追加一次专用修复。
- 已安装的旧 1.2.0 客户端仍需由用户运行本报告列出的新安装包覆盖；本轮没有直接修改系统安装状态。
