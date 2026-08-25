# Jato AI BID

`Jato AI BID` 是佳图数字科技有限公司内部使用的投标文件制作客户端，桌面标题为“佳图智能投标助手”。

- 开发名：`OpenJatoBID`
- 版权所有：佳图数字科技有限公司
- 英文名称：Jato Digital Technology Co., Ltd.

## 使用说明

### 软件用途

本软件用于公司内部投标文件制作、资料复用、文档生成与导出管理。

第一阶段保留以下主要入口：

- 标书生成：生成技术方案、已有方案扩写
- 模板设置：我的模板、新建模板
- 知识库：文档知识库
- 标书检查：标书查重、废标项检查
- 设置：模型、文件解析、智能体、更新与关于信息

商务标、图片知识库、AI 评标、投标机会、资源下载和使用文档入口在第一阶段隐藏，对应源码未删除。

### 技术文件生成流程

上传招标文件 -> 解析招标文件 -> 生成目录 -> 设定全局事实 -> 生成或编辑正文 -> 导出 Word。

第一阶段仅整理品牌与基础入口，不改变上述主流程。

### 安装与更新

Windows 正式发布制品统一命名为 `Jato-AI-BID-<version>-win-x64.exe`。客户端历史版本可从 [OpenJatoBID Releases](https://github.com/migrant1124/OpenJatoBID/releases) 由负责人获取。

客户端自动更新不直接访问 GitHub Release 或 R2：先向 Cloudflare Worker 提交本地许可证查询 `release/latest.json`，再携带 `X-Jato-License` Header 经 Worker 从私有 R2 下载 EXE，并在打开前强制校验文件大小和 SHA-256。GitHub Release 只作为客户端正式版本的长期归档。

客户端和管理端统一由 `.github/workflows/release.yml` 手动 `workflow_dispatch` 触发，不再因推送标签自动发布。四个输入分别是客户端稳定标签 `tag_name`、整次发布确认 `confirm_release`（必须精确等于 `PUBLISH <tag_name>`）、管理端独立版本 `management_version` 和来自 `main` 历史的管理端源码 `management_ref`。两个 Windows 2022 GitHub-hosted job 独立并行：客户端保持 Draft → 私有 R2 → `latest.json` → Worker 完整下载验证 → 正式 Release 的原流程；管理端使用一次性的 `management-v<version>` 独立标签，先上传并校验私有 R2 `management/<version>/` 中的 EXE、ZIP、`SHA256SUMS.txt`，再创建只含相同制品的 Draft Release。管理端不生成公共 Actions Artifact，不写 `latest.json`、不经过 Worker，也不自动公开 Release。

所需 GitHub Secrets 为 `JATOBID_BUILD_ATTESTATION_PRIVATE_KEY_JWK`、`JATOBID_RELEASE_FORBIDDEN_TERMS`、`MANAGEMENT_INITIAL_ADMIN_CREDENTIAL_JSON`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` 和用于客户端发布后验证的 `JATOBID_UPDATE_TEST_LICENSE_JSON`；所需 GitHub Variables 为 `R2_ACCOUNT_ID` 和 `UPDATE_WORKER_BASE_URL`。测试许可证必须是管理端签发的完整 ECDSA envelope，且 `offlineValidUntil` 尚未到期；到期后需在持有原签名密钥的管理端重新登录或续期测试设备，将新 envelope 更新到同名 GitHub Secret，不能直接修改 JSON 日期。

### 数据说明

- 用户配置保存在 Electron `userData/user_config.json`。
- 工作区数据保存在 Electron `userData/workspace/`。
- 招标文件、生成正文、导出结果和 API Key 不作为 analytics 埋点内容上报。
- 在线模型和解析请求仅发送给使用人员在设置中选择的服务商。

## 开发说明

### 代码范围

- `client/`：当前桌面客户端主体代码
- `analytics/`：独立的 Cloudflare Workers 埋点服务与统计看板
- `docs/secondary-development/prd/`：二开 PRD
- `docs/secondary-development/test-reports/`：二开测试报告

开始修改客户端前，必须先阅读 [`client/开发说明.md`](client/开发说明.md) 和根目录 [`AGENTS.md`](AGENTS.md)。

### 本地命令

客户端命令均在 `client/` 目录执行：

```powershell
cd client
npm ci
npm run dev
```

构建验证：

```powershell
cd client
npm run build
```

本地打包：

```powershell
cd client
npm run dist:win
npm run dist:mac
```

打包产物位于 `client/release/`。

### 产品识别配置

| 配置           | 值                                    |
| ------------ | ------------------------------------ |
| package name | `jatoaibid`                          |
| productName  | `Jato AI BID`                        |
| appId        | `com.jdt.jatoaibid`                  |
| 窗口标题         | `佳图智能投标助手`                           |
| Windows 安装包  | `Jato-AI-BID-${version}-win-x64.exe` |
| GitHub 归档仓库  | `migrant1124/OpenJatoBID`            |
| 自动更新通道       | 私有 R2 + Worker 许可证代理                 |

### 第一阶段技术边界

以下内部命名和机制保持不变：

- `window.yibiao`
- `yibiao.sqlite`
- 既有 IPC 通道名和 preload API 结构
- `technical-plan` 数据结构、缓存和业务流程
- Word 导出与 Mermaid 转换链路
- OpenCode Agent 运行机制
- analytics 数据采集与统计能力
