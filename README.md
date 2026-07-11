# Jato AI BID

`Jato AI BID` 是佳图数字科技有限公司内部使用的投标文件制作客户端，桌面标题为“佳图智能投标助手”。

- 当前版本：`1.0.0`
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

Windows 安装包名称为 `Jato AI BID Setup 1.0.0.exe`。内部发布版本可从 [OpenJatoBID Releases](https://github.com/migrant1124/OpenJatoBID/releases) 获取。

客户端仅使用 `migrant1124/OpenJatoBID` 的 GitHub Releases 检查和下载更新，不使用 Cloudflare R2 更新源。

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

打包：

```powershell
cd client
npm run dist:win
npm run dist:mac
```

打包产物位于 `client/release/`。

### 产品识别配置

| 配置           | 值                                  |
| ------------ | ---------------------------------- |
| package name | `jatoaibid`                        |
| productName  | `Jato AI BID`                      |
| appId        | `com.jdt.jatoaibid`                |
| 窗口标题         | `佳图智能投标助手`                         |
| Windows 安装包  | `Jato AI BID Setup ${version}.exe` |
| 更新仓库         | `migrant1124/OpenJatoBID`          |

### 第一阶段技术边界

以下内部命名和机制保持不变：

- `window.yibiao`
- `yibiao.sqlite`
- 既有 IPC 通道名和 preload API 结构
- `technical-plan` 数据结构、缓存和业务流程
- Word 导出与 Mermaid 转换链路
- OpenCode Agent 运行机制
- analytics 数据采集与统计能力

## 相关文档

- [第一阶段二开 PRD](docs/secondary-development/prd/openjatobid-phase1-branding-prd.md)
- [第一阶段测试报告目录](docs/secondary-development/test-reports/README.md)
