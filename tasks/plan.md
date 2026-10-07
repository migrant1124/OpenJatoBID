# OpenJatobid 二次开发实施计划

> 历史依据：`docs/secondary-development/prd/openjatobid-phase2-ui-lan-management-prd.md`（v0.5 批准稿）
> 历史状态：管理员认证修订计划已批准并完成 T32—T36/CP7；T30/CP6 实体双机验收仍未关闭。
> 当前增量：T47—T61“招标解析、格式驱动目录与受控写作”计划已于 2026-07-13 通过 CP8；真实文件回归后批准 T65，以来源锚点修复格式解析并合并采购与报价任务。
> 历史范围：保留已完成的客户端 UI、局域网授权与统计成果，只重做独立 Windows 管理端的管理员认证、首次设置和交付验证。

## 1. 目标与完成标准

本轮交付必须同时满足以下结果：

1. 保持客户端现有菜单、页面结构、功能流程和主要布局，仅将视觉语言统一替换为 Ant Design System v6 风格；不引入 Ant Design React，不重写现有 Radix 组件体系。
2. 文本模型、生图模型的“金龙中转站”名称和 API 获取链接按 PRD 修改；“关于”页隐私声明全文按 PRD 落地。
3. 客户端启动后先进入登录页；已授权员工使用姓名、手机号登录，新用户通过左下角“授权申请”打开独立弹窗并填写姓名、手机号、服务器 IP。
4. 姓名 + 手机号 + 当前设备构成授权主体；每台设备单独审批，每名员工最多 3 台有效设备；授权期 1 年；本地授权可离线使用，但至少每 30 天成功连接管理端校验一次。
5. 客户端的授权请求和埋点完全改为连接登录页配置的局域网管理端，不再向 `analytics.agnet.top` 发送 `/track` 或授权请求；公告、资源、更新检查仍沿用现有公共服务。
6. 独立 Windows 管理端继续支持授权审批/撤销、客户端与 AI 用量统计；管理员认证改为私有构建配置注入内置初始凭据、首次登录强制改密、登录后主动改密，不提供注册、SMTP 或忘记密码。
7. 不迁移历史统计和授权记录；第二轮上线前的旧数据不导入管理端。
8. 客户端继续支持 Windows/macOS；管理端仅支持 Windows。
9. 所有授权规则、时间规则、设备上限、统计传输和管理员认证状态都有自动化测试；管理端重新构建和打包，并完成受影响的运行时验收。

## 2. 约束与不在范围内事项

- 不改变客户端现有信息架构、导航位置、页面内容组织和业务工作流。
- 不在客户端引入 `antd` 依赖；通过设计令牌、全局 CSS 和现有 Radix 基础组件实现 Ant Design v6 视觉语言。
- 不将管理端嵌入客户端，也不复用同一个安装包或用户数据目录。
- 不迁移 Cloudflare Analytics 中的历史数据、历史授权或离线激活记录。
- 不删除公告、资源、更新检查等仍需访问公共服务的能力。
- 不添加 PRD 未要求的组织架构、角色权限、多管理员、云同步或公网穿透能力。
- 不保留 SMTP、恢复邮箱、临时密码或忘记密码入口；不添加新的自助恢复或技术支持后门。
- 不实现公司网络识别、第二管理端检测或外部运行技术阻断；单管理端和禁止外带由公司负责人通过人防制度执行。
- 不执行 `git pull`、`git push`、`git merge`、`git rebase`、`git reset` 等受保护 Git 操作。

## 3. 当前代码基线

- 客户端位于 `client/`，Electron Main/preload 使用 CommonJS，Renderer 使用 React + TypeScript + Vite。
- 客户端 UI 使用全局 CSS 与 Radix；现有布局样式包含较多硬编码渐变、阴影和尺寸，需要先建立令牌，再按页面分批替换。
- 当前授权服务位于 `client/electron/services/licenseService.cjs`，包含公共授权接口、离线激活导入和本地签名授权文件。
- 当前埋点分散在 Renderer、AI 服务和 OpenCode Runtime 服务中，并直接调用公共 `/track` 地址。
- `analytics/` 是 Cloudflare Worker + Dashboard，不能直接作为离线 Windows 管理端打包；需保留其统计维度和查询含义，在新管理端中实现本地等价能力。
- 仓库没有客户端 lint/test 脚本；现有强制验证入口为 `client/npm run build`，Electron CJS 使用 `node --check`。
- 根目录已有旧的 `task_plan.md` 和 `progress.md`，本轮不覆盖，使用 `tasks/` 目录独立维护。
- 修订实施前的管理端曾实现被 PRD 0.5 否决的 SMTP 发件配置、固定恢复邮箱、邮件临时密码和仅密码登录；当时 `admin_auth` 没有用户名，系统设置入口仍禁用。
- 修订实施前 `nodemailer` 是正式依赖，SMTP 授权码保存在 SQLite 设置中；T32—T36 已同步清除代码、依赖、持久配置和 UI 中的旧方案，并仅在迁移清理与回归测试中保留旧字段名。
- 当前 LAN API、员工授权、统计、托盘和打包能力不因管理员认证修订改变；本轮不得重写这些已通过的链路。

## 4. 待确认的实施假设

以下选项用于把 PRD 中仍开放的设计点收敛为可编码方案。批准本计划即视为同意这些默认值；若需调整，请在批准前指出。

| 编号 | 默认方案 | 影响 |
|---|---|---|
| A1 | 管理端采用纯 Electron 托盘应用；Windows 用户退出登录或系统关机后不继续服务，重新登录后由开机自启动恢复。 | 若要求“用户注销后仍服务”，必须改为 Windows Service + 管理界面双进程，工作量和安装权限显著增加。 |
| A2 | 管理端产品名为“Jato AI BID 管理端”，内部目录 `management/`，建议 appId `com.jiatu.aibid.management`。 | 决定安装包、进程和配置目录命名。 |
| A3 | 登录/申请页的服务器地址使用单一“服务器 IP”输入框，兼容 `IP` 与 `IP:端口`；默认端口 `47821`，管理端首次设置可修改。 | 避免额外增加端口字段，同时支持非默认端口。 |
| A4 | 管理端首次启动生成本地 ECDSA P-256 签名密钥；客户端首次获得有效授权时绑定该管理端公钥，后续更换公钥必须清除本机授权并重新申请。 | 保留本地离线验签能力，避免内置所有企业共用私钥。 |
| A5 | 设备标识沿用“系统机器标识 + 网卡信息 + 客户端持久 ID”的组合；重装系统或清除客户端数据可能被视为新设备，管理员可撤销旧设备后重新申请。 | 不新增复杂设备迁移功能。 |
| A6 | 老版本公共授权、离线激活码在升级后不继续有效，员工需向局域网管理端重新申请；现有 `analytics_client_id` 保留，以减少同一安装实例被误识别为全新客户端。 | 符合“不迁移历史数据”，同时保留客户端本地连续性。 |
| A7 | 管理员续期行为为“从续期成功时起再授权 1 年”；拒绝申请无需填写原因。 | 决定授权状态机和管理端操作。 |
| A8 | 在线客户端定义为最近 10 分钟内有登录、校验或埋点心跳；离线埋点本地队列最多保存 30 天或 10,000 条，先达到任一限制即丢弃最旧记录。 | 控制统计口径和本地存储增长。 |
| A9 | 管理端统计数据默认保留 24 个月，管理员可手动清理指定日期之前的数据；授权主体和设备记录不随统计清理自动删除。 | 决定数据库清理能力与磁盘容量。 |
| A10 | 管理端 UI 与客户端使用同一套 Ant Design v6 视觉令牌，但代码与构建保持独立。 | 保持两套软件视觉一致。 |
| A11 | 单一管理员账号；内置初始凭据首次登录后强制改密，登录后可用当前密码主动改密；不提供注册、SMTP、忘记密码或自助恢复。 | 决定管理员认证状态与界面。 |
| A12 | 不单独采集定时“心跳”事件；在线状态由登录、授权校验和已有业务埋点共同刷新。 | 避免新增无业务价值的高频请求。 |
| A13 | 初始用户名和密码从被 Git 忽略的私有构建配置注入；生成模块只包含用户名、随机盐、密码摘要和凭据版本，缺失配置时开发启动和打包失败。 | 安装包内置凭据，但公开仓库不保存明文密码。 |
| A14 | 同一公司局域网只部署一个管理端；安装包、凭据和服务器由公司负责人保管，外部运行风险采用人防，不增加网络或设备技术封锁。 | 明确部署边界和已接受残余风险。 |

## 5. 目标架构

```mermaid
flowchart LR
    subgraph C["员工客户端 Windows / macOS"]
        UI["登录、授权申请、业务 UI"]
        LS["本地授权文件与离线统计队列"]
        CS["Main 侧局域网通信服务"]
        UI --> CS
        CS <--> LS
    end

    subgraph M["独立 Windows 管理端"]
        API["局域网 HTTP 服务"]
        DB["本地 SQLite"]
        ADM["管理员界面"]
        API <--> DB
        ADM <--> DB
    end

    CS -->|"申请、登录、校验、埋点"| API
    UI -->|"公告、资源、更新"| PUBLIC["现有公共服务"]
```

关键边界：

- 客户端 Renderer 不直接访问网络或 Node；登录、授权和埋点统一通过 preload/IPC 进入 Electron Main。
- 管理端 Renderer 不直接读写 SQLite、签名密钥或管理员密码摘要；全部由管理端 Main 服务负责。
- 局域网接口只承担健康检查、授权申请/查询/登录校验和埋点接收。
- 管理端私钥和管理员密码摘要只存放在管理端服务器本地，不返回客户端；私有构建配置不进入仓库和普通构建输出。
- 客户端只保存服务器地址、员工身份信息、管理端公钥、签名授权和有界离线埋点队列。

## 6. 局域网接口草案

接口最终在任务 T10 中形成独立契约文档并冻结；下表仅用于确定任务边界。

| 方法与路径 | 用途 | 主要结果 |
|---|---|---|
| `GET /api/v1/health` | 测试服务器可达性 | 管理端版本、服务状态、服务器时间 |
| `POST /api/v1/authorization/applications` | 新用户/新设备提交申请 | 申请 ID、当前状态 |
| `GET /api/v1/authorization/applications/:id` | 客户端查询审批状态 | pending/approved/rejected |
| `POST /api/v1/authorization/login` | 已授权员工登录当前设备 | 签名授权、到期日、下次最晚校验日 |
| `POST /api/v1/authorization/verify` | 定期或联网触发校验 | 有效/撤销/过期状态及新签名授权 |
| `POST /api/v1/analytics/events` | 批量提交埋点 | 已接收事件 ID 列表 |

所有请求使用 JSON；客户端只在输入层校验姓名、手机号、服务器地址，软件内部数据层遵循项目“本地层级相互信任”的约束。埋点事件携带客户端生成的唯一事件 ID，便于离线重试时去重。

## 7. 分阶段任务

### 阶段 0：决策冻结与基线

#### T00 确认计划与记录架构决策 — S

- 内容：历史阶段确认 A1–A12；PRD 0.5 追加确认 A13–A14，并修订管理员认证 ADR。
- 验收：PRD 与 ADR 无互相冲突的开放项；所有后续任务都能引用明确决定。
- 预计文件（≤3）：
  - `docs/secondary-development/prd/openjatobid-phase2-ui-lan-management-prd.md`
  - `docs/secondary-development/adr/phase2-lan-management.md`
  - `tasks/todo.md`
- 验证：人工逐项核对 A1–A14 与 PRD 0.5、ADR 和任务计划；检查 Markdown 链接有效。
- 依赖：人工批准本计划。

#### T01 建立可复现的视觉基线与令牌映射 — M

- 内容：记录当前关键页面固定尺寸截图；将 Figma Ant Design v6 参考中的颜色、字号、圆角、间距、阴影映射为项目 `--yb-*` 令牌；列出必须保留的布局尺寸。
- 验收：至少覆盖启动/主壳、模型配置、关于、技术方案、知识库；令牌表明确现值、目标值和适用组件。
- 预计文件（≤4）：
  - `docs/secondary-development/design/phase2-visual-baseline.md`
  - `docs/secondary-development/design/phase2-ant-v6-token-map.md`
  - `client/src/styles/tokens.css`
  - `tasks/todo.md`
- 验证：`cd client; npm run dev` 后按清单人工截图；`cd client; npm run build`。
- 依赖：T00。

### 阶段 1：低风险客户端内容与视觉基础

#### T02 修改模型配置文案、链接与隐私声明 — S

- 内容：更新文本/生图模型供应商名称、API 获取链接、隐私声明 01–04；删除关于页离线激活入口文案，但授权逻辑移除留到 T18。
- 验收：两类模型配置均显示“金龙中转站”；获取按钮跳转新链接；隐私声明逐段与 PRD 一致且排版可读。
- 预计文件（≤3）：
  - `client/src/features/settings/SettingsPage.tsx`
  - `client/src/styles/feature-settings.css`
  - `tasks/todo.md`
- 验证：`cd client; npm run build`；开发环境逐项点击链接并核对页面文案。
- 依赖：T00。

#### T03 实现客户端全局 Ant v6 视觉令牌与主壳样式 — L

- 内容：替换全局颜色、排版、圆角、阴影、控件状态和主壳视觉；保持现有侧栏宽度、菜单顺序、内容区结构和工具条位置。
- 验收：主壳无旧渐变/重阴影；所有页面继续保持内部滚动；键盘焦点和禁用态清晰；布局尺寸与 T01 基线一致。
- 预计文件（≤5）：
  - `client/src/styles/tokens.css`
  - `client/src/styles/layout-app-shell.css`
  - `client/src/styles/shared-components.css`
  - `client/src/app/AppShell.tsx`
  - `client/src/app/Sidebar.tsx`
- 验证：`cd client; npm run build`；在 1440×900 与 1920×1080 检查主壳、菜单、滚动、焦点态。
- 依赖：T01。

#### T04 统一共享弹窗、表单、提示与 Markdown 视觉 — M

- 内容：对现有 Radix Dialog/Select/Toast、表单控件、空状态、Markdown 展示应用统一 Ant v6 风格，不改变组件接口。
- 验收：共享控件在设置、知识库、检查页呈现一致；错误/警告/成功状态可区分；无 `alert`。
- 预计文件（≤5）：
  - `client/src/styles/shared-dialog.css`
  - `client/src/styles/shared-toast.css`
  - `client/src/styles/shared-markdown.css`
  - `client/src/styles/shared-components.css`
  - `tasks/todo.md`
- 验证：`cd client; npm run build`；逐类打开 Dialog、Select、Toast、长 Markdown 内容。
- 依赖：T03。

### 阶段 2：独立管理端基础

#### T05 创建管理端独立工程与构建配置 — M

- 内容：建立 `management/` 独立 package、TypeScript、Vite、Electron Builder 配置和入口，不引用 `client/` 构建产物。
- 验收：管理端可单独安装依赖、构建 Renderer 和启动 Electron；产品名/appId/用户数据目录与客户端不同。
- 预计文件（≤5）：
  - `management/package.json`
  - `management/package-lock.json`
  - `management/tsconfig.json`
  - `management/vite.config.ts`
  - `management/src/main.tsx`
- 验证：`cd management; npm ci; npm run build`。
- 依赖：T00。

#### T06 实现管理端窗口、preload 与托盘生命周期 — M

- 内容：创建 Main 窗口、托盘菜单、关闭到托盘、显式退出、单实例和 preload 最小 API；按 A1 配置 Windows 登录后自启动。
- 验收：关闭窗口后服务进程继续运行；托盘可打开/退出；二次启动聚焦已有窗口；Renderer 无 Node 权限。
- 预计文件（≤5）：
  - `management/electron/main.cjs`
  - `management/electron/preload.cjs`
  - `management/src/shared/ipc.ts`
  - `management/assets/tray.ico`
  - `management/package.json`
- 验证：`node --check management/electron/main.cjs`; `node --check management/electron/preload.cjs`; `cd management; npm run build`; 手工验证托盘生命周期。
- 依赖：T05。

#### T07 实现管理端本地数据库与迁移 — M

- 内容：建立 SQLite 连接、schema 版本、事务和迁移；包含管理员配置、服务配置、员工、设备、申请、授权、统计事件和去重键。
- 验收：空目录首次启动自动建库；重复启动迁移幂等；授权主体与最多 3 台有效设备规则具备数据库约束/事务保护。
- 预计文件（≤5）：
  - `management/electron/services/databaseService.cjs`
  - `management/electron/services/migrations.cjs`
  - `management/electron/services/databaseService.test.cjs`
  - `management/package.json`
  - `tasks/todo.md`
- 验证：`cd management; node --test electron/services/databaseService.test.cjs`; `npm run build`。
- 依赖：T05。

#### T08/T09 原管理员认证实现 — 历史记录，已被 PRD 0.5 否决

- T08/T09 曾实现 SMTP 配置、固定恢复邮箱、邮件临时密码和强制改密 UI。
- 该历史实现不再是目标状态；不得以其已完成状态证明 PRD 0.5 通过。
- 新认证方案由 T32—T36 完整取代，并要求删除旧服务、依赖、持久配置、IPC、界面和测试。

### 阶段 3：局域网授权纵向闭环

#### T10 冻结局域网 API 契约并实现 HTTP 服务骨架 — M

- 内容：形成请求/响应/错误码契约；实现 bind IP/端口、健康检查、JSON 路由、优雅停止和端口占用错误反馈。
- 验收：局域网另一台机器可访问健康检查；管理端界面显示真实监听地址和失败原因；接口契约可供客户端与管理端共同测试。
- 预计文件（≤5）：
  - `docs/secondary-development/api/lan-management-v1.md`
  - `management/electron/services/httpServerService.cjs`
  - `management/electron/services/httpRouter.cjs`
  - `management/electron/services/httpServerService.test.cjs`
  - `management/electron/main.cjs`
- 验证：`cd management; node --test electron/services/httpServerService.test.cjs`; `node --check` 相关 CJS；从第二台设备调用 `/api/v1/health`。
- 依赖：T07、T08。

#### T11 实现授权申请、审批、拒绝、撤销与续期领域服务 — L

- 内容：实现员工去重、设备绑定、3 台上限、申请状态机、1 年授权、撤销、续期、签名授权生成和事务一致性。
- 验收：并发审批不能突破 3 台；每台设备必须独立审批；撤销/过期/拒绝状态准确；签名载荷包含员工、设备、签发/到期/最晚校验时间和管理端标识。
- 预计文件（≤5）：
  - `management/electron/services/authorizationService.cjs`
  - `management/electron/services/signingService.cjs`
  - `management/electron/services/authorizationService.test.cjs`
  - `management/electron/services/signingService.test.cjs`
  - `management/electron/services/httpRouter.cjs`
- 验证：`cd management; node --test electron/services/authorizationService.test.cjs electron/services/signingService.test.cjs`; `npm run build`。
- 依赖：T10。

#### T12 实现管理端授权管理界面 — L

- 内容：实现待审批申请、员工、设备、授权状态、到期时间、批准、拒绝、撤销、续期和筛选；展示 3 台上限占用情况。
- 验收：管理员可完成全部授权操作并看到即时结果；危险操作有确认；拒绝不要求原因；无历史迁移入口。
- 预计文件（≤5）：
  - `management/src/features/authorization/AuthorizationPage.tsx`
  - `management/src/features/authorization/ApplicationTable.tsx`
  - `management/src/features/authorization/EmployeeDeviceDrawer.tsx`
  - `management/src/features/authorization/authorization.css`
  - `management/src/App.tsx`
- 验证：`cd management; npm run build`; 手工覆盖第 1–4 台设备、拒绝、撤销、续期和过期状态。
- 依赖：T09、T11。

#### T13 建立客户端局域网配置与授权 IPC 契约 — M

- 内容：在 Main 侧保存服务器地址、姓名、手机号和管理端公钥；定义 Renderer 可用的申请、查询、登录、校验、状态和服务器测试 IPC；不暴露 Node/文件系统。
- 验收：配置写入 Electron `user_config.json`；preload 与 TS 类型一致；服务器输入标准化兼容 `IP`/`IP:端口`。
- 预计文件（≤5）：
  - `client/electron/services/configStore.cjs`
  - `client/electron/ipc/licenseIpc.cjs`
  - `client/electron/preload.cjs`
  - `client/src/shared/types/ipc.ts`
  - `client/electron/services/lanServerAddress.cjs`
- 验证：对所有修改的 CJS 执行 `node --check`; `cd client; npm run build`；为地址标准化运行 `node --test`（测试文件在 T14 一并加入）。
- 依赖：T10。

#### T14 重写客户端授权服务与本地离线校验 — L

- 内容：用局域网申请/登录/校验替换公共授权与离线激活；验证管理端签名；保存授权和最后成功校验时间；实现 1 年到期、30 天离线、撤销与 3 台上限响应。
- 验收：只有管理端成功响应才刷新 `lastVerifiedAt`；断网 30 天内可用，超过 30 天暂停；撤销后下次成功联网立即失效；服务器不可达与未授权状态可区分。
- 预计文件（≤5）：
  - `client/electron/services/licenseService.cjs`
  - `client/electron/services/lanManagementClient.cjs`
  - `client/electron/services/licenseService.test.cjs`
  - `client/electron/services/lanServerAddress.test.cjs`
  - `client/electron/ipc/licenseIpc.cjs`
- 验证：`cd client; node --test electron/services/licenseService.test.cjs electron/services/lanServerAddress.test.cjs`; 对 CJS 执行 `node --check`; `npm run build`。
- 依赖：T11、T13。

#### T15 实现客户端启动登录页与授权申请弹窗 — L

- 内容：新增启动门禁；登录页显示姓名、手机号、服务器 IP 与“登录”；左下角“授权申请”打开同页独立弹窗，弹窗字段为姓名、手机号、服务器 IP，主按钮“提交授权申请”。
- 验收：未登录不能进入主应用；申请弹窗不跳转页面；登录和申请互不混用；手机号、必填和服务器地址错误在输入层提示；授权通过后可登录。
- 预计文件（≤5）：
  - `client/src/features/auth/StartupAuthPage.tsx`
  - `client/src/features/auth/AuthorizationRequestDialog.tsx`
  - `client/src/features/auth/startup-auth.css`
  - `client/src/App.tsx`
  - `client/src/styles.css`
- 验证：`cd client; npm run build`; 手工覆盖未授权登录、申请、待审批、拒绝、批准后登录、错误 IP 和手机号。
- 依赖：T03、T14。

#### T16 实现授权生命周期触发与状态提示 — M

- 内容：在登录、应用启动、网络恢复、系统休眠恢复时触发校验；展示离线剩余天数、即将到期、已过期、已撤销和服务器不可达状态。
- 验收：触发器不会并发重复请求；失败不错误延长离线期；在线校验成功后即时更新；暂停使用时仍可返回登录页修改服务器地址。
- 预计文件（≤5）：
  - `client/electron/main.cjs`
  - `client/electron/services/licenseService.cjs`
  - `client/electron/ipc/licenseIpc.cjs`
  - `client/src/shared/ui/LicenseStatusPrompt.tsx`
  - `client/src/App.tsx`
- 验证：对 CJS 执行 `node --check`; `cd client; node --test electron/services/licenseService.test.cjs`; `npm run build`; `npm run dev` 手工测试断网/恢复/休眠恢复。
- 依赖：T15。

#### T17 清除旧公共授权与离线激活界面/接口 — S

- 内容：删除 `importOfflineLicense`、`activateOffline` 及相关 UI/IPC；确保代码中不再出现公共授权 URL 和旧离线激活入口。
- 验收：Renderer 类型、preload、IPC、设置页均无离线激活；全仓搜索不再存在旧授权端点；保留新的本地签名授权文件机制。
- 预计文件（≤5）：
  - `client/src/shared/ui/LicenseStatusPrompt.tsx`
  - `client/src/shared/types/ipc.ts`
  - `client/electron/preload.cjs`
  - `client/electron/ipc/licenseIpc.cjs`
  - `client/src/features/settings/SettingsPage.tsx`
- 验证：`rg "activateOffline|importOfflineLicense|license/activate" client`; 对 CJS 执行 `node --check`; `cd client; npm run build`。
- 依赖：T16。

### 阶段 4：局域网统计等价迁移

#### T18 建立客户端 Main 侧统一埋点服务与离线队列 — L

- 内容：将端点、批量提交、事件 ID、失败重试、队列上限和 30 天清理集中到 Main 服务；Renderer 只经 IPC 发送事件。
- 验收：服务不可达不阻塞业务；恢复后按顺序批量补发且管理端可去重；队列边界符合 A8；不记录文档原文、文件名、路径、API Key 或用户输入。
- 预计文件（≤5）：
  - `client/electron/services/analyticsService.cjs`
  - `client/electron/services/analyticsQueueStore.cjs`
  - `client/electron/services/analyticsService.test.cjs`
  - `client/electron/ipc/analyticsIpc.cjs`
  - `client/electron/preload.cjs`
- 验证：`cd client; node --test electron/services/analyticsService.test.cjs`; 对 CJS 执行 `node --check`; `npm run build`。
- 依赖：T13、T14。

#### T19 迁移 Renderer 埋点到统一 IPC — M

- 内容：保留现有事件名、页面维度、配置维度和资源点击维度，将 `fetch /track` 改为 preload IPC；删除 Renderer 中公共统计端点。
- 验收：`app_open`、`page_view`、`config_usage`、`resource_click` 等维度保持；Renderer 无直接 `/track` 请求；公告/资源下载地址不受影响。
- 预计文件（≤4）：
  - `client/src/shared/analytics/analytics.ts`
  - `client/src/shared/types/ipc.ts`
  - `client/electron/preload.cjs`
  - `client/electron/main.cjs`
- 验证：`rg "analytics\.agnet\.top|/track" client/src`; 对 CJS 执行 `node --check`; `cd client; npm run build`；管理端查看页面访问事件。
- 依赖：T18。

#### T20 迁移 AI 与 Agent Runtime 埋点到统一服务 — M

- 内容：让 AI 请求与 OpenCode Runtime 复用 Main 侧埋点服务，保留模型、Token、成功失败、耗时、Agent Runtime 等现有统计字段。
- 验收：AI/Agent 不再直接访问公共 `/track`；失败不会影响模型调用；原统计维度可在管理端还原。
- 预计文件（≤5）：
  - `client/electron/services/aiService.cjs`
  - `client/electron/services/opencodeRuntimeService.cjs`
  - `client/electron/services/analyticsService.cjs`
  - `client/electron/services/analyticsService.test.cjs`
  - `client/electron/main.cjs`
- 验证：`rg "analytics\.agnet\.top|/track" client/electron`; 对 CJS 执行 `node --check`; `cd client; node --test electron/services/analyticsService.test.cjs`; `npm run build`；实际发起一次文本模型和 Agent 请求。
- 依赖：T18。

#### T21 实现管理端埋点接收、去重、聚合与清理 — L

- 内容：接收批量事件，按事件 ID 去重，保存原有非涉密维度，提供时间范围/客户端/IP/模型/配置/Agent 聚合查询和 24 个月清理。
- 验收：重复批次不重复计数；查询口径与现有 Analytics Dashboard 对齐；IP 使用管理端实际看到的局域网来源地址；无业务涉密字段落库。
- 预计文件（≤5）：
  - `management/electron/services/analyticsIngestService.cjs`
  - `management/electron/services/analyticsQueryService.cjs`
  - `management/electron/services/analyticsService.test.cjs`
  - `management/electron/services/httpRouter.cjs`
  - `management/electron/ipc/analyticsIpc.cjs`
- 验证：`cd management; node --test electron/services/analyticsService.test.cjs`; 对 CJS 执行 `node --check`; `npm run build`。
- 依赖：T10、T18。

#### T22 实现管理端统计总览与客户端/IP 页面 — L

- 内容：实现总览、在线客户端、客户端列表、局域网 IP、访问趋势与时间范围筛选；沿用现有统计含义。
- 验收：管理员可查看活跃频次、在线客户端总数、IP 和趋势；在线口径在界面说明为最近 10 分钟；空数据与加载失败状态明确。
- 预计文件（≤5）：
  - `management/src/features/analytics/AnalyticsOverviewPage.tsx`
  - `management/src/features/analytics/ClientAnalyticsPage.tsx`
  - `management/src/features/analytics/analytics.css`
  - `management/src/shared/ipc.ts`
  - `management/src/App.tsx`
- 验证：`cd management; npm run build`; 用固定测试数据核对总数、去重客户端、IP 和时间筛选。
- 依赖：T09、T21。

#### T23 实现管理端 AI、配置、Agent 与最新事件统计 — L

- 内容：实现 AI 请求数、Token、模型、配置使用、Agent Runtime 和最新事件页面；支持 PRD 要求的无业务内容统计。
- 验收：模型/Token 聚合结果与测试数据一致；最新事件不展示文档原文、文件名、路径、API Key、用户输入或业务产出。
- 预计文件（≤5）：
  - `management/src/features/analytics/AiUsagePage.tsx`
  - `management/src/features/analytics/ConfigUsagePage.tsx`
  - `management/src/features/analytics/AgentRuntimePage.tsx`
  - `management/src/features/analytics/LatestEventsPage.tsx`
  - `management/src/features/analytics/analytics.css`
- 验证：`cd management; npm run build`; 用固定事件集核对 Token、模型、配置、Agent 和敏感字段缺失。
- 依赖：T21、T22。

#### T24 验证公共统计/授权完全切断且公共内容服务保留 — S

- 内容：全仓审计并移除客户端对公共 `/track` 和授权接口的访问；明确保留公告、资源、更新检查的公共端点；记录“不迁移历史数据”的上线行为。
- 验收：抓包时客户端授权/埋点只访问配置的局域网地址；公告/资源/更新仍可用；升级后无历史导入任务。
- 预计文件（≤4）：
  - `client/electron/services/licenseService.cjs`
  - `client/electron/services/analyticsService.cjs`
  - `docs/secondary-development/phase2-migration-notes.md`
  - `tasks/todo.md`
- 验证：`rg "analytics\.agnet\.top" client`; 逐一判断剩余命中只能属于公告/资源/更新；使用网络面板/代理观察运行时请求。
- 依赖：T17、T19、T20、T21。

### 阶段 5：完整 UI 换肤

#### T25 迁移技术方案与工作区页面视觉 — M

- 内容：应用已冻结令牌，替换技术方案步骤、卡片、进度、编辑器和导出状态的旧视觉，不改变步骤流或数据权威来源。
- 验收：Step01–04 功能、滚动、生成进度、Markdown/Mermaid 预览和工具条位置不变；视觉与主壳一致。
- 预计文件（≤3）：
  - `client/src/styles/feature-technical-plan.css`
  - `client/src/styles/shared-markdown.css`
  - `tasks/todo.md`
- 验证：`cd client; npm run build`; 手工完成导入、生成、编辑、预览、导出主流程。
- 依赖：T04。

#### T26 迁移查重与废标检查页面视觉 — M

- 内容：统一上传区、检查结果、风险级别、筛选、详情和操作按钮视觉，不改变检查算法和内容。
- 验收：查重/废标结果层级清晰；颜色不仅作为唯一状态信息；长列表内部滚动正常。
- 预计文件（≤3）：
  - `client/src/styles/feature-duplicate-check.css`
  - `client/src/styles/feature-rejection-check.css`
  - `tasks/todo.md`
- 验证：`cd client; npm run build`; 使用已有样例覆盖空态、运行中、成功、警告、失败和长列表。
- 依赖：T04。

#### T27 迁移知识库、模板、资源、设置与开发者页面视觉 — L

- 内容：分区统一剩余页面的列表、表单、标签、表格、空态和详情视觉；保持模型配置和关于页内容修改。
- 验收：所有主菜单页面都使用同一令牌体系；无旧紫色渐变/玻璃拟态残留；页面布局和功能入口不变。
- 预计文件（≤5）：
  - `client/src/styles/feature-knowledge-base.css`
  - `client/src/styles/feature-resources.css`
  - `client/src/styles/feature-export-format.css`
  - `client/src/styles/feature-settings.css`
  - `client/src/styles/feature-developer.css`
- 验证：`cd client; npm run build`; 按菜单逐页检查表单、弹窗、空态、长内容与滚动。
- 依赖：T02、T04。

#### T28 完成客户端响应式、可访问性与视觉回归 — M

- 内容：修复换肤后在支持尺寸下的溢出、焦点、对比度和键盘操作问题；按 T01 固定视口做前后对比。
- 验收：1440×900 与 1920×1080 无非预期布局变化；登录页 1280×720 可完整操作；Tab 顺序和焦点环可见；主内容区无 body 滚动依赖。
- 预计文件（≤5）：
  - `client/src/styles/layout-app-shell.css`
  - `client/src/styles/tokens.css`
  - `client/src/features/auth/startup-auth.css`
  - `docs/secondary-development/design/phase2-visual-regression.md`
  - `tasks/todo.md`
- 验证：`cd client; npm run build`; 固定视口截图；键盘走查登录、申请、设置和至少一个业务主流程。
- 依赖：T15、T25、T26、T27。

### 阶段 6：集成、打包与交付

#### T29 管理端打包、安装与数据目录验证 — M

- 内容：完成 Windows NSIS 安装包、图标、版本信息、自启动、卸载行为和本地数据保留策略；不影响客户端打包配置。
- 验收：生成独立管理端安装包；与客户端可同时安装运行；升级保留数据库和配置；卸载行为在文档中说明。
- 预计文件（≤5）：
  - `management/package.json`
  - `management/assets/icon.ico`
  - `management/electron/main.cjs`
  - `management/README.md`
  - `tasks/todo.md`
- 验证：`cd management; npm run build; npm run dist:win`; 在干净 Windows 环境安装、升级、卸载并验证客户端共存。
- 依赖：T12、T23。

#### T30 完成局域网双机端到端验收 — L

- 内容：在一台 Windows 服务器运行管理端，另一台 Windows/macOS 运行客户端，覆盖管理员登录/改密、员工申请、审批、登录、离线、恢复、撤销、续期、3 台上限和埋点补发。
- 验收：PRD 第 13 节所有验收条件通过；断网 30 天边界用可控时钟自动测试，手工环境验证短时断网与恢复；没有公共 `/track`/授权流量。
- 预计文件（≤4）：
  - `docs/secondary-development/test-reports/phase2-integration-test-report.md`
  - `management/electron/services/authorizationService.test.cjs`
  - `client/electron/services/licenseService.test.cjs`
  - `client/electron/services/analyticsService.test.cjs`
- 验证：运行两端全部自动测试、构建和双机手工用例；保存关键截图与网络请求证据。
- 依赖：T24、T28、T29、T36。

#### T31 完成最终构建、代码审查与交付文档 — M

- 内容：执行客户端/管理端全量构建、CJS 语法检查、依赖审计、Windows 打包；按正确性、安全边界、性能、可维护性和 PRD 一致性进行代码审查；更新使用/部署说明。
- 验收：无 P0/P1 审查问题；所有验收项有证据；管理端部署、私有凭据构建、初始登录、主动改密、端口、防火墙、备份、恢复和员工使用流程有文档。
- 预计文件（≤5）：
  - `docs/secondary-development/test-reports/phase2-final-test-report.md`
  - `docs/secondary-development/phase2-client-guide.md`
  - `docs/secondary-development/phase2-management-guide.md`
  - `docs/secondary-development/prd/openjatobid-phase2-ui-lan-management-prd.md`
  - `tasks/todo.md`
- 验证：
  - `cd client; npm ci; npm run build; npm audit; npm run dist:win`
  - 对所有改动的 `client/electron/**/*.cjs` 执行 `node --check`
  - `cd management; npm ci; npm test; npm run build; npm audit; npm run dist:win`
  - 对所有改动的 `management/electron/**/*.cjs` 执行 `node --check`
- 依赖：T30。

### 阶段 6A：PRD 0.5 管理员认证修订（当前增量）

> T08/T09 的 SMTP 方案保留为历史实施记录，但已被 PRD 0.5 否决。T32—T36 已按批准范围实施完成，未修改客户端、LAN API、授权领域或统计口径。

#### T32 私有构建凭据注入与产物边界 — M / 高风险

- 目标：让负责人提供的初始用户名和密码在构建时进入管理端，但公开仓库、文档、普通日志和生成模块均不保存明文密码。
- 内容：新增被 Git 忽略的私有凭据文件入口和无真实值示例；准备脚本读取私有配置，生成用户名、随机盐、密码摘要和凭据版本；生成模块写入 `electron/generated/`，并由 electron-builder `files` 显式包含；根目录私有配置不进入 `files`；开发启动与 Windows 打包在缺失/无效配置时失败，不使用默认凭据回退；移除打包过程中可能输出凭据的日志。
- 预计范围：
  - `.gitignore`
  - `management/initial-admin.private.example.json`
  - `management/scripts/prepare-initial-admin-credential.cjs`
  - `management/scripts/prepare-initial-admin-credential.test.cjs`
  - `management/package.json`
- 验收：私有文件和生成模块均被 Git 忽略；生成模块不含明文密码；缺失、字段为空、密码不足 8 位时准备步骤失败；有效输入可供开发启动和打包；打包后的 ASAR 包含生成摘要模块但不包含私有配置文件。
- 验证：使用临时测试凭据运行脚本测试；`node --check`；`git status --short`；检查 electron-builder 文件清单/ASAR；对源码、文档、构建日志和打包清单扫描真实明文密码，结果为 0。
- 决策门：T32 通过前不得修改运行时登录流程或生成正式安装包。

#### T33 内置凭据接管与旧认证数据迁移 — L / 高风险

- 目标：空数据库和现有 SMTP 认证数据库都进入一次性初始凭据接管状态，同时保留员工、设备、授权、统计和签名身份。
- 内容：新增管理员用户名和凭据状态；认证服务接收生成的摘要材料；空库初始化为必须改密；旧认证数据首次升级时替换旧管理员摘要、清空临时密码并删除 SMTP 设置；负责人完成改密后标记为已接管，后续启动不得被安装包初始摘要覆盖。
- 预计范围：
  - `management/electron/services/migrations.cjs`
  - `management/electron/services/databaseService.cjs`
  - `management/electron/services/adminAuthService.cjs`
  - `management/electron/services/adminAuthService.test.cjs`
  - `management/electron/services/databaseService.test.cjs`
- 验收：用户名错误、密码错误均拒绝；初始凭据正确时返回强制改密；改密后初始密码与旧密码均失效；当前密码校验和主动改密正确；迁移重复执行幂等；业务数据和签名设置不丢失。
- 验证：固定时钟/内存数据库测试覆盖空库、旧 SMTP 数据库、已接管数据库、重复启动和改密；相关 CJS `node --check`。
- 恢复：执行迁移前备份完整管理端 `userData`；迁移失败时停止启动，不创建第二套数据库、不清空业务表。

#### T34 首次登录—强制改密—服务器设置纵向流程 — L

- 目标：公司负责人首次启动时先用内置用户名和密码登录，完成强制改密后才能设置服务器并进入管理界面。
- 内容：调整 setup/auth IPC 和 preload 类型；登录输入改为用户名 + 密码；拆分“凭据已接管”和“服务器已配置”状态；首次强制改密只接受新密码/确认密码；首次设置页只保留监听地址和连通性，不再包含管理员密码或 SMTP。
- 预计范围：
  - `management/electron/ipc/adminIpc.cjs`
  - `management/electron/preload.cjs`
  - `management/src/shared/ipc.ts`
  - `management/src/App.tsx`
  - `management/src/features/auth/AdminLoginPage.tsx`
  - `management/src/features/setup/SetupPage.tsx`
- 验收：未登录、未改初始密码时不能进入设置或业务页；强制改密成功后进入服务器设置；服务器设置成功后进入管理端；重启后使用当前用户名/密码登录；没有忘记密码入口。
- 验证：管理端服务/IPC 聚焦测试、`npm run build`、Electron 开发运行逐步操作并记录状态截图和控制台结果。
- 依赖：T32、T33。

#### T35 登录后主动改密与 SMTP 全量移除 — M

- 目标：负责人可在系统设置主动修改密码，且旧 SMTP/找回密码方案在产品、依赖和持久状态中完全消失。
- 内容：启用“系统设置”并加入修改密码表单；要求当前密码、新密码、确认密码；成功后旧密码立即失效；删除 forgot-password IPC、SMTP 服务/测试和 Renderer 类型；删除 `nodemailer` 依赖与锁文件记录；迁移/启动清理旧 `smtp_config`。
- 预计范围：
  - `management/src/features/settings/SystemSettingsPage.tsx`
  - `management/src/App.tsx`
  - `management/electron/ipc/adminIpc.cjs`
  - `management/electron/services/smtpService.cjs`（删除）
  - `management/electron/services/smtpService.test.cjs`（删除）
  - `management/package.json`、`management/package-lock.json`
- 验收：错误当前密码不能改密；新密码不足 8 位或两次不一致不能提交；成功后旧密码不能登录、新密码可以；源码、IPC、UI、依赖和数据库设置中不再有 SMTP、恢复邮箱、临时密码或忘记密码能力。
- 验证：认证服务/IPC 测试、`npm test`、`npm run build`、`npm audit`；目标 `rg` 扫描；Electron 运行时主动改密后退出并重新登录。
- 依赖：T34。

#### T36 认证修订交付、打包与回归证据 — M

- 目标：用私有构建配置生成新的管理端安装包，并证明管理员认证改动没有破坏 LAN 授权、统计、托盘和数据。
- 内容：更新管理端 README、部署/备份说明、迁移说明和测试报告；重跑管理端全部测试、构建、依赖审计、CJS 检查、Windows 打包和解包运行；更新产物哈希；回归真实本机 HTTP 集成链路。
- 预计范围：
  - `management/README.md`
  - `docs/secondary-development/phase2-management-guide.md`
  - `docs/secondary-development/phase2-migration-notes.md`
  - `docs/secondary-development/test-reports/phase2-integration-test-report.md`
  - `docs/secondary-development/test-reports/phase2-final-test-report.md`
  - `tasks/todo.md`
- 验收：两套软件仍独立；管理端新安装包通过解包运行；LAN 申请—审批—登录—埋点—撤销链路通过；打包产物不含私有明文密码文件；工作树无生成凭据、测试数据库或 SMTP 凭据。
- 验证：`cd management; npm ci; npm test; npm run build; npm audit; npm run dist:win`；全部相关 CJS `node --check`；打包运行时冒烟；SHA-256；`git diff --check` 和凭据/SMTP 静态扫描。
- 依赖：T35。

## 8. 依赖顺序与检查点

主路径：

历史主路径：`T00 → … → T29/T31`。PRD 0.5 当前路径：

`T32 → T33 → T34 → T35 → T36 → T30 → CP6`

建议检查点：

- CP1（T00）：需求和架构冻结，允许开始编码。
- CP2（T04 + T09）：客户端视觉基础与管理端首次设置可演示。
- CP3（T17）：申请—审批—登录—离线校验—撤销形成授权闭环。
- CP4（T24）：统计迁移闭环且公共内容服务边界验证完成。
- CP5（T28）：客户端所有页面 UI 换肤与视觉回归完成。
- CP6（T30）：在 CP7 后完成实体双机验收、安装/升级/卸载验证、抓包和最终发布确认。
- CP7（T36）：管理员认证修订、SMTP 全量移除、迁移、管理端新打包和本机回归完成，允许进入实体双机最终验收。

每个检查点完成后才进入下一高风险阶段；若验收失败，只修复该阶段相关文件，不顺带重构。

## 9. 风险与应对

| 风险 | 应对 |
|---|---|
| 管理端纯托盘应用在 Windows 用户注销后停止 | 在 T00 明确 A1；若必须持续运行，先改架构计划，不在实现中临时加 Service。 |
| 客户端首次绑定错误或伪造的管理端公钥 | 首次登录/批准时显示管理端标识；服务器变更和公钥变更必须重新申请，不静默替换。 |
| 同一员工并发审批突破 3 台 | 在 SQLite 事务内完成计数与审批，使用并发测试验证。 |
| 离线时钟被修改导致 30 天校验错误 | 签名载荷保存服务端时间与本地最后成功校验时间；自动测试覆盖回拨/快进，具体策略在 ADR 固定。 |
| 埋点补发导致重复计数 | 客户端生成事件 ID，管理端唯一索引去重；测试重复批次。 |
| UI 全量替换引入布局回归 | 先固定基线和令牌，分页面迁移，每阶段固定视口截图与业务流程走查。 |
| 私有凭据文件误入仓库或构建日志 | `.gitignore` + 构建前检查 + 明文扫描；生成模块只保留随机盐和摘要。 |
| 旧 SMTP 数据库升级后重复覆盖负责人密码 | 一次性凭据状态迁移；负责人接管后后续启动不得重新播种初始摘要。 |
| 负责人忘记修改后密码 | 不提供技术后门；执行前建立凭据保管和完整 `userData` 备份制度，重新初始化必须提示数据与签名影响。 |
| 管理端被复制到外部网络或重复部署 | 用户已选择人防；由负责人保管安装包、凭据和指定服务器，软件不作无法兑现的技术阻断承诺。 |
| 管理端数据库损坏或服务器迁移 | 文档化关闭应用后备份整个管理端数据目录；本轮不增加云备份或自动迁移工具。 |

## 10. Definition of Done

本轮只有同时满足以下条件才算完成：

- PRD 0.5 所有必须项和批准后的 A1–A14 均实现，无未说明偏差。
- 客户端布局/流程不变，全部主页面完成 Ant v6 风格统一并通过固定视口回归。
- 管理端和客户端是两个可独立安装、运行、升级、卸载的软件个体。
- 授权与统计只连接配置的局域网管理端；公告、资源、更新公共能力保留。
- 自动化测试覆盖授权状态机、3 台上限、1 年期、30 天离线、撤销、签名、埋点队列/去重、内置凭据接管、首次强制改密和主动改密。
- 客户端和管理端构建、相关 CJS 语法检查、依赖审计、Windows 打包全部通过。
- 局域网双机验收报告、客户端使用说明、管理端部署说明齐全。
- 最终代码审查无 P0/P1 问题；工作树中没有本任务生成的私有凭据、生成凭据模块、测试数据库、密钥或 SMTP 配置。

## 11. 阶段 6B：第三轮调试、关于页与图标优化

#### T37 两端浏览器调试入口与真实 Electron 调试命令 — M

- 目标：浏览器可独立检查两端登录页及指定页面，真实 Electron 可从授权门禁开始调试。
- 内容：客户端增加开发预览入口和关于页直达参数；管理端增加开发态内存桥接；两端增加 `dev:browser`、`dev:inspect`，客户端增加 `dev:licensed`。
- 验收：5173 不再无限读取授权；5174 不再报告桥接缺失；浏览器模拟不进入生产数据链路；Electron 远程调试端口可用。

#### T38 关于页登录账号与退出登录 — S

- 目标：员工可在关于页查看当前账号和授权期限，并退出当前界面会话。
- 内容：增加第三张账号卡片，贯通 App—Router—Settings 的退出回调。
- 验收：退出后返回登录页，不删除、不撤销本机授权。

#### T39 隐私声明响应式横向布局 — S

- 目标：消除三列换行导致的失衡留白。
- 内容：宽屏四列、中屏两列、小屏一列，卡片顶部对齐。
- 验收：正文不变，固定视口布局符合 PRD。

#### T40 Windows 应用身份与托盘图标 — S

- 目标：任务栏、窗口和托盘使用公司 Logo。
- 内容：设置 AppUserModelID；管理端托盘改读 ICO；管理端构建包含运行时图标。
- 验收：开发运行和打包运行均显示正确图标。

#### T41 构建与运行验收 — M

- 目标：为第三轮改动形成可复核证据。
- 验证：两端构建、CJS 语法检查、浏览器页面检查、Electron 授权门禁检查及图标截图。

## 12. 招标解析、格式驱动目录与受控写作增量计划

> 历史计划：本节记录 T47—T69 的原结构化格式、来源锚点和固定模板实现。CHG-001 已于 2026-07-13 替代其目标行为；本节不再作为后续 Build 的执行依据。当前计划见第 13 节。

### 12.1 需求基线与阶段边界

- 冻结需求：`D:\download\OpenJatoBID_招标解析_格式驱动目录与写作改造_最终需求.md`
- SHA-256：`386F8FD5CD1A83A3BC1601061CA0C663186D6B9D2558904D879CC7ED5ABA365D`
- 子系统：仅 `client/`。
- 当前模式：Build。CP8 已于 2026-07-13 批准；后续实测修订 T65 已获批准，完成后仍由四个真实样本约束 T61/CP11。
- 架构决策：`docs/secondary-development/adr/format-driven-technical-plan.md`。
- 数据/IPC 契约：`docs/secondary-development/api/technical-plan-format-contract-v1.md`。
- UI 基线：`docs/secondary-development/design/format-driven-technical-plan-ui.md`。

本计划不修改依赖、`package-lock.json`、管理端、Analytics、发布工作流、自动更新或 Word/OOXML 编辑能力。

### 12.2 当前代码基线

1. Main 与 Renderer 各维护 18 项/5 必选的解析清单和 Prompt，已经发生实际漂移。
2. JSON 解析结果只做非空判断；现有 `aiService` 已有可复用的 JSON 解析、normalizer、validator 和修复链路。
3. `technical_plan_bid_items.content` 可继续保存规范化 JSON；v17 目录表没有格式约束、模板或响应状态。
4. 生产目录任务只读取项目概述和技术评分，完整树会被 Main 与 Renderer 按位置重编号。
5. 目录 UI 和 Store 对所有节点开放改名、删除、排序和加子节点，Agent 与知识库补目录也可改写整棵树。
6. Step05 的所有叶子节点进入同一自由 Markdown 生成及后处理链；固定正文和表格没有任何绕过保护。
7. 技术方案导出信任 Renderer payload，并只根据 `item.id` 编号。
8. 当前分支为 `opt/jiexihemulu`；工作树已有用户修改 `client/doc/1.2.0.md`，本轮不触碰。

### 12.3 审批口径

批准 CP8 即同时批准 ADR 中的七项口径：

1. SQLite v18 使用解析项 `normalized_hash`、`format_constraints_json`、`response_state_json` 和模板表；
2. 格式任务读取全部原始招标文件以输出多 profile；“采购与报价”读取当前投标范围工作副本；
3. profile 不唯一时用户选择，禁止猜测；
4. 已有方案扩写也服从格式优先；
5. 未确认模板可进入 Step03，但阻止对应写作和导出；
6. 缺少强制证明材料可在明确确认风险后导出，其他完整性错误硬阻断；
7. 证明材料 v1 只生成 Markdown 索引和知识条目引用，不嵌入附件。

若任一口径需要改变，应先修订 ADR、契约和本计划，再进入 Build。

### 12.4 Phase A：解析层

#### T47 冻结运行时契约并完成 SQLite v18 基础 — L / 高风险

- 需求：第 5—8、14—15 节；为 Phase A—D 提供唯一持久化契约。
- 目标：旧 v17 工作区无损升级，新结构能保存 profile 选择、节点约束、响应状态和固定模板。
- 主要范围：
  - `client/electron/services/sqliteDatabase.cjs`
  - `client/electron/services/technicalPlanStore.cjs`
  - `client/src/shared/types/outline.ts`
  - `client/src/features/technical-plan/types.ts`
  - `client/src/shared/types/ipc.ts`
  - `sql/workspace_schema.sql`
- 实现边界：
  - 新增 v18 migration、节点两个 JSON 字段、模板表、profile ID/Hash；
  - `technical_plan_bid_items` 增加 `normalized_hash`，格式任务 Hash 覆盖完整 result + templates；
  - 旧节点按 `auto + freeform-markdown + 无锁` 计算默认值；
  - 非空损坏 JSON 失败关闭；
  - Main 保存时不得因 Renderer 漏字段清空既有约束；
  - 不新增第三方依赖。
- 验证：
  - 纯 normalizer/序列化测试；
  - Electron native smoke 构造 v17 数据库并升级；
  - 检查升级备份、重复打开幂等和 schema 文件一致性；
  - `node --check` 相关 CJS；`npm run build`。
- 验收：旧目录标题、正文、任务状态无损；新字段可往返；旧节点不被误判为模板。

#### T48 建立 Main 单一任务目录与 18/7 完成门禁 — M

- 需求：第 2.1、4.2、12.1、13.1、15.1 节。
- 目标：Main、Store、Renderer、UI 和完成判断严格使用同一套 18 项/7 必选定义。
- 主要范围：
  - `client/electron/services/bidAnalysisTask.cjs`
  - `client/electron/services/technicalPlanStore.cjs`
  - `client/src/features/technical-plan/services/bidAnalysisWorkflow.ts`
  - `client/src/features/technical-plan/pages/BidAnalysisPage.tsx`
  - `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
  - `client/src/features/developer/pages/DeveloperTestPage.tsx`
- 实现边界：
  - `loadTechnicalPlan()` 返回只读任务元数据；
  - Renderer 删除生产任务和 Prompt 副本；
  - 关键项顺序为项目概述、技术评分要求、格式要求、采购与报价、项目信息、甲方信息、交货和服务要求；
  - `bidDocumentFormatRequirements` 只改 UI 名称，不改代码 ID；`quotationRequirements` 从活跃目录移除；
  - 所有 JSON 项统一进入 `requestJson` / `parseJsonResponseContent`；
  - 非法 JSON 不得通过 Renderer 代码块降级为成功；
  - 保留现有任务组、中断恢复、预热后并发和单项重试能力。
- 验证：任务总数、顺序、必选集合、Main/Renderer 门禁、失败恢复和单项重试的纯逻辑测试；CJS 检查与构建。
- 验收：7 项未成功且合法前，任何入口都不能进入新目录生成。

#### T49 格式要求纵向切片 — XL / 高风险

- 需求：第 2.2—2.8、3、4.2、5、8—9、12.1、15.1 节。
- 目标：从全部原始招标文件产生可追溯的多 profile、固定目录节点和模板注册表，并在 Step02 可视化。
- 主要范围：
  - 新增 `client/electron/services/bidAnalysisResultSchemas.cjs`
  - `client/electron/services/bidAnalysisTask.cjs`
  - `client/electron/services/technicalPlanStore.cjs`
  - `client/src/features/technical-plan/pages/BidAnalysisPage.tsx`
  - `client/src/features/technical-plan/types.ts`
- 实现边界：
  - 读取全部原始招标 Markdown，不使用已裁剪工作副本代替多 profile 输入；
  - Main 先将普通 Markdown 内容与 HTML 表格 `<tr>` 行生成为稳定来源锚点；第一阶段模型只返回锚点 ID，Main 再确定性回填源文件、1-based 行区间和原始片段；
  - 第一阶段提取 profile、递归树、响应模式和模板描述；只有固定承诺函或固定表格存在时，才用对应锚点原文启动小上下文第二阶段模板编译；
  - Main 复核 locked segments、表头、固定单元格和固定说明均由锚点原文支持；
  - normalizer 生成稳定 profile/node/template ID；
  - 强制“如有/其他”必留和必响应；
  - 无明确格式返回合法 `none` profile；
  - 模板与格式结果同事务落盘；
  - Step02 显示 profile、递归树、来源和模板“待核对”状态；确认/重确认操作在 T55 随模板服务落地；
  - 相同完整分析 Hash 保留已确认模板和下游；模板正文、slot 或表结构变化会改变 Hash、重置确认并按 ADR 清理。
- 验证：strict、fixed-roots、none、多包、未知/跨文件锚点、普通 Markdown 锚点、单物理行 HTML 表格的 `<tr>` 锚点、确定性来源回填、非法 response mode、空模板、如有/其他、仅固定模板触发第二阶段、固定内容不受锚点支持时拒绝、模板注册去重与未确认状态、固定正文标点/slot/表结构变化导致 Hash 变化和确认重置测试；Electron Store smoke；UI 运行检查。
- 验收：结构不合法或来源不可追溯时该项为 error；合法结果可完整恢复。

#### T50 采购与报价纵向切片与技术正文隔离 — M

- 需求：第 2.9、6、13.1、15.1、16 节。
- 目标：用一个必选 Markdown 项合并采购清单和报价要求，同时证明其中的价格信息不会默认进入技术目录、全局事实或正文 Prompt。
- 主要范围：
  - `client/electron/services/bidAnalysisTask.cjs`
  - `client/src/features/technical-plan/pages/BidAnalysisPage.tsx`
  - 目录/正文上下文构建函数的隔离测试
- 实现边界：
  - `procurementList` 改为必选关键项，UI 名称为“采购与报价”，继续输出 Markdown；
  - 覆盖采购清单、规格数量、交付验收，以及报价方式、范围、限价、税务、发票、价格组成、精度/舍入、公式、表单、平台、一致性、优先级、无效报价、异常低价、结算和外部依赖；
  - `quotationRequirements` 从活跃目录删除；旧 SQLite 行隐藏保留，不迁移、不映射成采购结果。
- 验证：任务元数据、采购与报价提示词、历史报价行隐藏、缺失采购项补跑，以及“采购与报价内容不进入技术 Prompt”的回归测试；CJS 检查、构建和 UI 展示。
- 验收：“采购与报价”为合法 Markdown 结果；除固定格式节点自身明确要求外，不影响技术正文。

#### T51 旧工作区补跑、步骤恢复与解析失效闭环 — L / 数据风险

- 需求：第 14 节。
- 目标：保留旧成功结果，只补跑当前 7 个关键项中的实际缺失项；旧工作区不会停留在一个可绕过 7 项门禁的后续页面。
- 主要范围：
  - `client/electron/services/technicalPlanStore.cjs`
  - `client/electron/services/bidAnalysisTask.cjs`
  - `client/electron/services/taskService.cjs`
  - `client/src/features/technical-plan/pages/BidAnalysisPage.tsx`
  - `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
- 实现边界：
  - 旧 `responseFileRequirements` 不冒充新格式结果，也不破坏性删除；
  - 旧 `quotationRequirements` 不冒充“采购与报价”结果，也不破坏性删除；
  - 仅旧 5 项成功时，默认 task IDs 只包含“格式要求”和“采购与报价”；其他工作区按实际缺失项补跑；
  - 旧工作区从 Step03/05 回到 Step02；
  - 补充格式解析可能清空旧目录/正文前明确确认；
  - 格式 Hash 变化事务性失效下游，相同结果保留；
  - 保留中断恢复的可重试 error 行为。
- 验证：构造旧 5 项、旧后续步骤、旧目录正文、无效历史 JSON、失败重试和异常关闭 fixtures；Electron smoke。
- 验收：旧结果不丢、缺失项不漏跑、后续状态不与新格式结果并存。

#### CP8A Phase A 验收门

- T47—T51 的纯逻辑测试、Electron smoke、CJS 检查、`npm run build` 和 Step02 真实窗口检查全部通过。
- 本门只要求固定模板已注册并以“待核对”只读展示；确认、重确认、locked Hash 和专用 IPC 属于 T55/CP10，不在 CP8A 提前宣称完成。
- 在 Phase B 完成前，本切片不得作为可发布功能，因为生产 Step03 仍可能是评分驱动。
- 四个真实样本尚未提供时，只能记录 fixtures 通过，不能勾选四样本验收。

### 12.5 Phase B：格式驱动目录

#### T52 profile 解析与格式优先目录纵向切片 — XL / 高风险

- 需求：第 2.2—2.4、4.3、7、11、13.2、15.2、16 节。
- 目标：唯一/人工选定 profile 驱动固定骨架；只有 `none` 才走评分回退。
- 主要范围：
  - 新增 `client/electron/services/outlineFormatConstraints.cjs`
  - `client/electron/services/outlineGenerationTask.cjs`
  - `client/electron/services/globalFactsTask.cjs`
  - `client/electron/services/technicalPlanStore.cjs`
  - `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
- 实现边界：
  - 无明确格式时自动选择唯一全局 technical/none profile；显式格式按 ID 优先与 specificity 匹配，零个或最高分并列多个时要求用户选择；
  - 格式 profile 只允许 technical，商务/报价/资格 profile 在 Schema 门禁失败；
  - 复制完整 strict/fixed-roots 骨架，保留“如有/其他”；
  - `format_node_id` 稳定，内部 ID 仍可重排；
  - 评分项映射到固定节点，只有 `allow_ai_children` 处可新增子目录；
  - 默认不读取“采购与报价”结果；
  - `globalFactsTask.cjs` 可读取选中格式 profile 中的项目名、标段、包号和招标人等固定字段，但不注入具体报价；
  - 已有方案扩写也服从格式优先。
- 验证：无明确格式全局回退、strict、fixed-roots、显式 scope 的 none、唯一/多/零匹配、通配与 specificity、非法非技术 profile、国网式完整骨架、南网式多 profile、四川烟草式固定根可展开 fixtures。
- 验收：明确格式不会被评分大类替代，也不会混入其他标包或采购报价目录。

#### T53 格式门禁、评分门禁与受控修复 — L / 高风险

- 需求：第 4.3、15.2 节。
- 目标：任何 AI、Agent、知识库或已有方案修复都不能破坏固定骨架。
- 主要范围：
  - `client/electron/services/outlineFormatConstraints.cjs`
  - `client/electron/services/outlineGenerationTask.cjs`
  - `client/electron/services/contentGenerationTask.cjs` 的补目录入口
- 执行顺序：
  1. 复制骨架；
  2. 应用评分映射与允许的子目录；
  3. 格式门禁；
  4. 评分覆盖门禁；
  5. 必要时应用受控 Agent patch；
  6. 再执行两道门禁；
  7. 通过后才保存。
- 验证：Agent 删除、改名、重排、换层级、改源编号、向禁用节点加子目录均被拒绝；合法可变区 patch 成功；评分覆盖不足不落盘。
- 验收：不存在“修复后绕过门禁”路径。

#### T54 目录 Store 锁定、编辑器状态与编号预览 — L

- 需求：第 7、11、12.2 节。
- 目标：UI 可见并禁止非法操作，直接 IPC 绕过同样失败；预览按三类编号策略一致显示。
- 主要范围：
  - `client/electron/services/technicalPlanStore.cjs`
  - `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
  - `client/src/shared/utils/outlineNumbering.ts`
  - `client/src/styles/feature-technical-plan.css`
- 实现边界：
  - Main 依据数据库约束比较保存前后树，不信任 Renderer 回传锁字段；
  - 拒绝删除必留、改锁定标题/顺序/层级/源编号和非法子节点；
  - 未锁定节点保留现有操作；
  - 内部 ID 改变后正文映射仍正确；
  - `preserve-source` 只显示源编号一次，`none` 不显示。
- 验证：纯 Store 绕过测试、Renderer 行为测试、ID 映射测试、固定视口运行检查。
- 验收：锁定节点在 UI 和 Main 两层都不可破坏。

#### CP9 Phase B 验收门

- Phase A—B 自动化、构建和真实 Electron Step02→Step03 运行链路通过。
- 目录生成后的固定骨架、评分覆盖、编号和编辑门禁均有可复核证据。

### 12.6 Phase C：受控写作

#### T55 固定模板服务与承诺函纵向切片 — XL / 高风险

- 需求：第 8、12.3、13.3—13.4、15.4 节。
- 目标：固定承诺函只允许核对原文和填写 slot，完整 Markdown 始终由 Main 确定性生成。
- 主要范围：
  - 新增 `client/electron/services/fixedMarkdownTemplateService.cjs`
  - `client/electron/services/technicalPlanStore.cjs`
  - `client/electron/ipc/technicalPlanIpc.cjs`
  - `client/electron/preload.cjs`
  - `client/src/shared/types/ipc.ts`
  - `client/src/features/technical-plan/pages/BidAnalysisPage.tsx`
  - `client/src/features/technical-plan/pages/ContentEditPage.tsx`
- 实现边界：
  - Main 确认模板、计算 locked Hash、保存模板版本；
  - 专用 `saveLockedTemplateValues` 只接收 slot；
  - 未确认或缺必填 slot 为 `needs-manual-input`；
  - 普通保存和任何完整 Markdown 回写均拒绝；
  - UI 固定正文只读、slot 表单可写，无扩写/改写/润色入口。
- 验证：标点、条款顺序、固定片段、Hash、未知 slot、缺必填 slot、Renderer 伪造全文和重复保存测试。
- 验收：只有 slot 值能改变，导出的固定正文与确认基线逐字一致。

#### T56 固定 Markdown 表格纵向切片 — XL / 高风险

- 需求：第 9、12.3、15.3 节。
- 目标：固定表头、列、说明和锁定单元格不变，只编辑允许区域。
- 主要范围：T55 的模板服务、Store、IPC/preload/type 与 `ContentEditPage.tsx`。
- 实现边界：
  - 专用 `saveFixedTableValues`；
  - repeatable region 才能增删行并遵守行数；
  - Main 根据结构化值渲染 Markdown；
  - 无偏差仍保留完整表格；
  - 不允许切换自由 Markdown。
- 验证：列数、列顺序、固定单元格、说明、未知 slot、非法重复行、多个重复区的确定插入位置、固定尾行/尾注前插入、零行、最大行数、空响应和普通保存绕过测试。
- 验收：全局“不要表格”和其他后处理不能把固定表格改为正文。

#### T57 response_mode 调度、证明材料和明确无内容 — XL

- 需求：第 4.5、10、15.3 节。
- 目标：正文任务先分流，再只把自由正文送入现有 AI 流程。
- 主要范围：
  - `client/electron/services/contentGenerationTask.cjs`
  - `client/electron/services/fixedMarkdownTemplateService.cjs`
  - `client/electron/services/technicalPlanStore.cjs`
  - 知识库服务的既有读取接口
  - `client/src/features/technical-plan/pages/ContentEditPage.tsx`
- 实现边界：
  - 分区 freeform、commitment、table、evidence、explicit-none、container；
  - commitment/table 的 Agent 分支只返回专用契约中的 slot、cell 和 repeatable row 值，并交给模板服务渲染；
  - 证明材料 Agent workspace 只提供所选知识库索引/内容，返回已知 ID；
  - 证明材料 Agent 与自由正文批量生成串行分阶段执行，不和大批量正文争抢运行资源；
  - Main 丢弃未知 ID 并确定性生成材料索引；
  - 无材料写“无。”并设置 `missing-required-evidence` 与风险；
  - `explicit-none` 确定性写入；
  - 执行成功与合规待处理分开统计并恢复。
- 验证：未知知识 ID、无材料、强制/非强制风险、container、explicit-none、暂停恢复和两个工作流测试。
- 验收：不虚构证明材料，待处理节点不会被静默当成合规完成。

#### T58 受保护节点的全链路绕过封堵与缓存失效 — L / 高风险

- 需求：第 8.5、14.3、15.3—15.4 节。
- 目标：固定节点不进入任何普通生成或后处理，所有内部写入路径都经过 Store 约束。
- 主要范围：
  - `client/electron/services/contentGenerationTask.cjs`
  - `client/electron/services/technicalPlanStore.cjs`
  - `client/electron/services/taskService.cjs`
  - 配图计划/生成上下文入口
- 必查路径：
  - 全量与单小节重新生成；
  - 原方案恢复、替换与扩写；
  - 最低字数补写和补目录；
  - 普通/Agent 一致性修复；
  - 表格清理；
  - 全文图片编排与回写；
  - `updateTechnicalPlan({ outlineData, contentGenerationSections })`。
- 验证：逐路径证明固定承诺函和固定表格未被选中、未被写回；模板/profile/response mode 变化按规则失效。
- 验收：不存在 IPC-only、UI-only 或任务内部的锁定绕过。

#### CP10 Phase C 验收门

- 六种 response mode 均有自动化证据和真实 Electron 页面证据。
- 两个技术方案入口均能启动、恢复、保存和显示合规状态。

### 12.7 Phase D：导出、回归与审查

#### T59 权威导出、编号和风险确认 — L / 高风险

- 需求：第 11、13.5、15.3—15.4 节。
- 目标：技术方案导出回读 Store，重新渲染/校验模板，并按编号策略复用现有 DOCX 链路。
- 主要范围：
  - `client/electron/services/exportService.cjs`
  - `client/electron/ipc/index.cjs`
  - `client/electron/ipc/exportIpc.cjs`
  - `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
  - `client/src/shared/types/ipc.ts`
- 实现边界：
  - `source = technical-plan` 时忽略 Renderer 替代 outline，回读 Store；
  - 硬阻断模板/slot/结构/待人工问题；
  - 仅缺证据允许 Radix 风险确认；
  - `auto/preserve-source/none` 与 Renderer 预览一致；
  - 通用导出预览保持原路径。
- 验证：伪造 Renderer payload、Hash 变化、固定表损坏、缺 slot、缺证据确认；解压 DOCX 检查 `word/document.xml` 的标题与固定原文。
- 验收：源编号只出现一次，固定正文逐字一致，旧 Markdown → Word 能力无回归。

#### T60 自动化、迁移与真实运行验收 — L

- 需求：第 16、18 节。
- 目标：形成可重复的纯逻辑、SQLite/Electron、构建和 UI 证据。
- 命令基线：

  ```powershell
  cd client
  npm ci
  node --test electron\services\bidAnalysisResultSchemas.test.cjs electron\services\outlineFormatConstraints.test.cjs electron\services\fixedMarkdownTemplateService.test.cjs electron\services\contentGenerationTask.responseModes.test.cjs
  node --check electron\services\bidAnalysisResultSchemas.cjs
  node --check electron\services\outlineFormatConstraints.cjs
  node --check electron\services\bidAnalysisTask.cjs
  node --check electron\services\outlineGenerationTask.cjs
  node --check electron\services\globalFactsTask.cjs
  node --check electron\services\contentGenerationTask.cjs
  node --check electron\services\fixedMarkdownTemplateService.cjs
  node --check electron\services\technicalPlanStore.cjs
  node --check electron\services\taskService.cjs
  node --check electron\services\exportService.cjs
  node --check electron\ipc\index.cjs
  node --check electron\ipc\exportIpc.cjs
  node --check electron\ipc\technicalPlanIpc.cjs
  node --check electron\preload.cjs
  npm run build
  .\node_modules\.bin\electron.cmd scripts\technical-plan-format-smoke.cjs
  npm run dev:inspect
  ```

- 运行证据：Vite 200、Electron 进程/窗口、Step02—Step05 操作、IPC、Store 状态、日志和 DOCX 输出共同证明，不以单一 build 代替。
- 报告：`docs/secondary-development/test-reports/format-driven-technical-plan-test-report.md`。
- 验收：所有已具备输入的自动化与运行检查无未解释失败。

#### T61 四样本验收与独立 Review — L / 外部输入门

- 需求：第 16、18 节。
- 样本：建行珠海、国网湖北、南网超高压、四川烟草。
- 前置：用户提供四个实际样本文件；当前仓库和 `D:\download` 未找到这些文件。
- Verify：
  - 按冻结矩阵完成真实 AI 解析、profile、目录、固定模板、采购与报价隔离、正文和导出人工回归；
  - 将文件标识、命令、运行证据、失败和残余风险写入 T60 测试报告。
- Review：
  - 使用只读 `openjatobid_reviewer` 或独立 Reviewer 对需求、ADR、契约、计划、diff、测试与运行证据做 findings-first 审查；
  - 必查数据迁移、锁定绕过、Agent 越权、“采购与报价”价格信息泄露和导出前校验。
- 验收：四样本全部达到冻结预期；无新增 P0/P1；P2 有明确处理结论。

#### T65 实测修订：来源锚点、采购与报价合并及配置布局 — L / 高风险

- 触发：真实招标 Markdown 中存在整张 HTML 表格位于单个物理行的情况，模型返回的可见文本摘录无法在带 HTML 标签的原文中唯一定位，既有行号二次校验与无源修复均不能解决。
- 目标：让“格式要求”不再依赖模型反推原文行号和摘录；删除重复的独立报价任务，并修复 7 个关键项下配置 Dialog 的分组叠字。
- 主要范围：
  - `client/electron/services/bidAnalysisTask.cjs`
  - `client/electron/services/bidAnalysisResultSchemas.cjs`
  - 来源锚点辅助服务及相关纯逻辑测试
  - `client/src/features/technical-plan/pages/BidAnalysisPage.tsx`
  - `client/src/styles/feature-technical-plan.css`
- 实现边界：
  - 活跃任务 18 项、关键项 7 项；`procurementList` 为“采购与报价”必选 Markdown 项，`quotationRequirements` 退役为隐藏历史行；
  - `bidDocumentFormatRequirements` 代码 ID 不变，UI 名称为“格式要求”；
  - 普通 Markdown 内容和 HTML `<tr>` 生成稳定锚点，模型返回锚点 ID，Main 确定性回填持久化来源；
  - 仅固定承诺函/固定表格使用锚点原文执行小上下文第二阶段模板编译；不以缺少原文的通用修复请求改写来源；
  - 配置 Dialog 由内容自然撑高关键项分组，“其他项”位于关键项网格之后，超出时在 Dialog 内滚动；
  - 不迁移或删除历史 SQLite 行，不修改依赖、管理端、Analytics、打包与发布流程。
- 验证：来源锚点及单行 HTML 表格/同一行 HTML 段落 fixture、标题层级保留、连续锚点约束、任务目录/历史行回归、固定模板二阶段触发条件、canonical evidence 固定内容覆盖、承诺函 slot 与留空位一一对应、表格逐格 slot 绑定及 rowspan/colspan 展开、CJS 检查、Renderer 构建与配置 Dialog 运行检查。未执行的检查不得写为已通过。
- 验收：格式结果来源由 Main 可重复定位；固定模板只由锚定原文编译；7 个关键项与“其他项”无叠字；旧工作区不会把历史报价行误判为当前关键项完成。

#### T67 现场回归：格式来源职责收敛 — M / 高风险

- 触发：真实模型在正确提取目录编号 `2.10` 和标题后，将编号拼成不存在的 `source-anchor-2.10`；同一原始响应还把分散规则来源聚合到一个引用，并漏选固定表格中的一行。逐类放宽错误会在下一道确定性校验继续失败。
- 根因：当前第一阶段同时要求模型理解业务结构并复写长上下文中的不透明锚点 ID，模型身份字段被错误当作业务输出；`upstream-main` 原“响应文件要求”只让模型提取业务语义，不存在这类身份耦合。
- 实现边界：
  - 普通目录节点以 `source_number + source_title` 为业务定位键，Main 从全部真实锚点中选择唯一目录行；模型锚点只用于无编号或同名候选消歧；
  - `result.sources` 只作为规则来源集合，Main 按源文件与真实锚点顺序拆成连续来源记录；未知锚点继续失败；
  - 固定模板仍严格使用模型选择的真实来源范围，只允许补齐同一 HTML 表格内部被跳过的 `<tr>` 行，不跨表格、不补普通正文；
  - 不恢复旧 Markdown 任务，不改变 Step03/Step05、Store、导出和模板确认契约，不打包。
- 验证：现场伪锚点、目录来源缺省、分散规则来源、HTML 表格漏行、未知汇总来源和跨正文模板来源回归；最新现场原始响应离线重放必须进入第二阶段；CJS 检查、相关测试和客户端构建。
- 验收：最新现场响应不再在第一阶段确定性来源校验失败；无法唯一定位的目录、未知模板来源和跨正文模板来源仍阻断。

#### CP11 最终验收门

- T47—T61 与 T65—T67 全部完成；
- `cd client; npm run build` 退出 0；
- 相关 CJS、纯逻辑测试、Electron smoke、真实窗口、DOCX 和四样本证据齐全；
- 独立 Review 通过；
- 未执行未经授权的 Git 同步、提交、推送、发布或部署。

### 12.8 依赖顺序

```text
CP8（本计划审批）
  → T47 → T48 → T49 → T50 → T51 → CP8A
  → T52 → T53 → T54 → CP9
  → T55 → T56 → T57 → T58 → CP10
  → T59 → T60
  → T65 → T66 → T67
  → 四样本到位 → T61 → CP11
```

原计划首个可执行任务为 T47；当前现场修订已推进至 T67。T49 与 T50 在原计划中可于 T48 后按共享契约并行，但同一文件有重叠时应顺序落地，避免冲突。四样本缺失不阻止 T65—T67，但仍阻止 T61/CP11。

### 12.9 风险与回滚

| 风险 | 处理与回滚 |
| --- | --- |
| v18 migration 破坏旧工作区 | 沿用升级前数据库备份；Electron smoke 先验证 v17 fixture；失败不得继续打开写入。 |
| 格式结果变化清空已有正文 | 启动前明确提示；同 Hash 不清；清理在事务中完成。 |
| Renderer 或后台任务绕过锁定 | 门禁放在 Store 写入缝，不只放 UI/IPC。 |
| Agent 修改完整固定树或正文 | 只接受受控 patch/结构化值；Main 应用并复检。 |
| 固定表格被表格清理改写 | 特殊模式在进入通用目标集合前过滤。 |
| “采购与报价”中的价格信息泄露到技术标 | 上下文构建 allowlist + 回归测试证明未注入。 |
| profile 误选 | 唯一才自动；零/多匹配阻断并要求用户选择。 |
| 四样本缺失 | fixtures 只用于开发；T61 保持未完成，不宣称 E2E 通过。 |

### 12.10 非目标

- Agent 直接编辑 Word；
- DOCX OOXML 模板复制、修改或视觉复刻；
- 把 Word 标题样式当业务目录；
- 自动虚构业绩、合同、发票、证书、人员或评价；
- 自动删除“如有”或“其他”；
- 把“采购与报价”默认写入技术正文；
- 让 Agent 返回固定承诺函完整正文；
- 嵌入或复制知识库原附件；
- 新增依赖、测试框架、发布流程或管理端能力。

## 13. CHG-001：格式要求、一级目录来源与人工填写简化计划

### 13.1 已批准需求与阶段边界

- 需求变更：`docs/secondary-development/changes/format-requirements-simplification-change.md`。
- 架构决策：`docs/secondary-development/adr/format-driven-technical-plan.md`。
- 数据/行为契约：`docs/secondary-development/api/technical-plan-format-contract-v1.md`。
- UI 基线：`docs/secondary-development/design/format-driven-technical-plan-ui.md`。
- 子系统：仅 `client/`。
- 当前模式：Plan。CP12 批准前禁止修改生产业务逻辑。
- 不修改依赖、SQLite schema 版本、管理端、Analytics、发布流程、自动更新或 Word/OOXML 编辑能力。
- 当前工作树已有 T68/T69 未提交代码和测试改动；Build 时必须按 CHG-001 外科手术式退役，不使用 `git reset`、`git checkout` 或整提交回退覆盖其他成果。

### 13.2 目标调用链

```text
当前投标范围 Markdown
  → responseFileRequirements（UI：格式要求，关键项，Markdown）
  → 读取首行“技术文件目录状态：明确/未明确”
  → 明确：格式要求生成一级目录
  → 未明确：所选知识库文档目录生成一级目录
  → 技术评分项只映射/补充二级及以下
  → 固定表格/承诺函标记 manual_input_required
  → AI 正文跳过人工节点
  → 用户用普通 Markdown 编辑器填写
  → 空白人工节点阻止导出
```

### 13.3 保留与退役边界

保留：

- Main 单一解析任务目录与 Renderer 元数据消费；
- 7 个关键项 UI、“采购与报价”和配置 Dialog 布局修复；
- 后台任务生命周期、当前任务防旧响应覆盖、Store 权威状态；
- 当前投标范围工作副本、多标段选择、知识库选择；
- 普通目录生成、正文生成、Markdown 编辑和 Word 导出；
- SQLite v18 列、表和旧记录，避免破坏性迁移。

退役：

- 活跃 `bidDocumentFormatRequirements` 任务、结构化格式 Schema 和专属 JSON 请求；
- AnchorCatalog、来源锚点验证、格式重放与固定模板第二阶段；
- profile 选择、格式 Hash、固定目录锁定和新目录的旧 `response_mode` 分流；
- 固定模板确认、slot/cell/repeatable region、模板 Hash 和专用保存 UI/IPC；
- 无明确格式时评分大类或通用目录作为一级目录来源。

### 13.4 T70 需求与规划重基线 — M

- 状态：完成后等待 CP12。
- 范围：CHG-001、ADR、契约、UI 基线、`tasks/plan.md`、`tasks/todo.md`。
- 目标：让业务规则、技术边界和任务状态只有一套当前口径；原 T47—T69 保留为历史记录但明确不再驱动 Build。
- 验收：文档不再要求 profile、来源锚点、固定模板编译或评分大类一级目录回退；明确记录无格式/无知识库阻断和人工填写节点。

### 13.5 T71 恢复 Markdown“格式要求”关键项 — M

- 目标：恢复 `responseFileRequirements` 代码 ID、Markdown 请求和关键项状态，删除格式专属运行分支。
- 主要生产范围：
  - `client/electron/services/bidAnalysisTask.cjs`
  - `client/src/features/technical-plan/pages/BidAnalysisPage.tsx`
  - `client/src/features/technical-plan/pages/TechnicalPlanHome.tsx`
  - `client/src/features/technical-plan/services/bidAnalysisWorkflow.ts`
  - `client/src/features/technical-plan/types.ts`
- 实现边界：
  - Main 任务 ID 为 `responseFileRequirements`、名称“格式要求”、`required: true`、`output: markdown`；
  - Prompt 沿用 upstream 原响应文件要求范围，增加稳定首行 `【技术文件目录状态】：明确/未明确`；
  - 只读取当前投标范围工作副本；
  - 首行缺失或非法时该项失败，不猜测；
  - 移除 `runBidDocumentFormatAnalysis`、source catalog、模板编译和格式专属 diagnostic 运行分支；
  - Step02 使用通用 Markdown 结果视图，删除 profile/模板核对和格式重跑清理专属 UI；
  - 历史 `bidDocumentFormatRequirements` 行隐藏保留，不迁移为成功结果。
- 测试：任务目录顺序、7 项门禁、Markdown 首行、当前投标范围输入、单项重试、历史行隔离、模型调用次数为 1。
- 验收：真实格式项不再出现 JSON、锚点或固定模板编译错误。

### 13.6 T72 重建一级目录来源与评分下级映射 — L / 高风险

- 目标：一级目录只来自明确格式或所选知识库文档，技术评分项只能生成二级及以下。
- 主要生产范围：
  - `client/electron/services/outlineGenerationTask.cjs`
  - `client/electron/services/outlineFormatConstraints.cjs`（删除或缩减为新目录纯逻辑）
  - `client/electron/services/technicalPlanStore.cjs`
  - `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
  - `client/src/features/technical-plan/types.ts`
- 实现边界：
  - 读取 `responseFileRequirements` 和稳定状态首行；
  - 明确格式：一级目录由格式要求生成，知识库只能参考二级及以下；
  - 未明确：目录请求前确认至少选择一份知识库文档，并只加载已选文档的目录结构；
  - 未明确且知识库为空：在任何目录 AI 请求前返回批准错误，调用次数为 0；
  - 多份知识库由一个目录请求综合；
  - 评分分组、知识库补充、Agent 修复和最终审查都只能返回一级目录内部 patch；
  - “生成技术方案”和“已有方案扩写”执行相同一级目录规则；原方案只能补充下级目录和正文；
  - 删除 profile 选择器、`selectedFormatProfileId/Hash` 活跃读写和 `original-only` 的格式 profile 特例。
- 测试：明确格式、未明确单知识库、未明确多知识库、未明确无知识库、评分项企图新增一级目录、未选知识文档隔离、两个工作流。
- 验收：不存在评分大类一级目录回退，也不读取未选知识库。

### 13.7 T73 人工填写节点与正文/导出门禁 — L

- 目标：固定表格和承诺函保留目录但完全由用户人工填写，不再建立固定模板。
- 主要生产范围：
  - `client/electron/services/technicalPlanStore.cjs`
  - `client/electron/services/contentGenerationTask.cjs`
  - `client/electron/services/exportService.cjs`
  - `client/src/shared/types/outline.ts`
  - `client/src/features/technical-plan/types.ts`
  - `client/src/features/technical-plan/pages/OutlineEditPage.tsx`
  - `client/src/features/technical-plan/pages/ContentEditPage.tsx`
  - 必要的 preload/IPC 类型删除，不新增专用 IPC
- 实现边界：
  - 新目录节点只使用 `manual_input_required?: boolean`；
  - 复用 `format_constraints_json` 持久化该布尔值，不新增 migration；
  - 目录生成默认标记固定表格和承诺函，用户可在 Step03 修正；
  - AI 编写目标、单节重生成、扩写、一致性修复、最低字数、表格清理和配图改写均过滤人工节点；
  - 人工节点使用普通 Markdown 编辑和现有保存接口；
  - 移除活跃模板确认、slot/cell 编辑和专用保存入口；
  - 导出只检查人工节点内容是否非空，不比较招标原文和模板 Hash。
- 测试：人工节点各 AI 入口调用次数 0、普通保存、状态恢复、空内容阻断导出、非空导出、普通节点无回归。
- 验收：用户可以完成固定表格/承诺函内容，系统不生成、不改写、不做逐字校验。

### 13.8 T74 旧架构退役与兼容清理 — M

- 目标：删除不再可达的旧格式业务代码和测试，保留数据库兼容，不留下两套活跃行为。
- 候选删除或收缩范围，以引用审计为准：
  - `client/electron/services/bidAnalysisSourceAnchors.cjs`
  - `client/electron/services/fixedMarkdownTemplateService.cjs`
  - 格式专属 replay fixtures/tests、template tests、旧 response mode tests
  - `client/electron/services/bidAnalysisResultSchemas.cjs` 中仅属于旧格式的 Schema/normalizer
  - preload、IPC、Renderer 中固定模板专用接口和类型
- 必须保留：
  - 其他 JSON 解析项 normalizer/validator；
  - 通用任务 stale response 保护；
  - SQLite v18 schema 与旧数据加载容错；
  - “采购与报价”、UI 布局及其他非格式功能。
- 验收：全仓库生产引用中不存在活跃 `bidDocumentFormatRequirements`、AnchorCatalog、profile 选择或固定模板编译入口；历史文档和迁移字段可保留。

### 13.9 T75 聚焦验证与现场验收 — M

- 自动化只运行相关最小测试文件，不调用真实模型：
  - 任务目录与 Markdown 状态首行；
  - 两种一级目录来源；
  - 无格式/无知识库零目录调用；
  - 评分项只能补充二级及以下；
  - 人工节点 AI 调用次数为 0；
  - 旧 v18 工作区兼容。
- CJS：对实际修改的 Main/preload/IPC 文件执行 `node --check`。
- Renderer：`cd client; npm run build`。
- 运行验收：重启 Electron Main，分别验证明确格式、无格式+知识库、无格式+无知识库、人工填写和导出阻断。
- 真实模型：仅在用户提供样本并明确开始现场验收后执行；不得用自动重试掩盖失败。
- 不打包、不提交、不推送，除非用户另行明确要求。

### 13.10 CP12 实现审批门

CP12 批准后才进入 Build，并按顺序执行：

```text
T71 → T72 → T73 → T74 → T75
```

批准 CP12 即确认以下技术口径：

1. Markdown 首行使用固定“明确/未明确”状态，不引入 JSON；
2. 无明确格式且未选知识库时在目录 AI 请求前阻断；
3. 技术评分项在两个分支都不能创建一级目录；
4. 人工填写使用 `manual_input_required` 和普通 Markdown 保存；
5. SQLite v18 保留，不降级、不删列；
6. 旧 profile/模板数据不迁移、不驱动新流程；
7. Build 可删除确认无生产引用的旧锚点和固定模板代码，但不得回退其他有效成果。

### 13.11 风险与回滚

| 风险 | 处理 |
| --- | --- |
| AI 未按格式要求正确生成一级目录 | 明确状态首行只负责选分支；使用 fixture 和真实样本校验目录 Prompt，失败回到 Prompt/目录逻辑，不恢复锚点体系。 |
| 多份知识库目录冲突 | 只综合用户选中的文档并在 UI 明示来源；不隐式读取全部知识库。 |
| 评分补充产生新一级目录 | 所有评分 patch 只接受已有一级目录 ID，Main 拒绝根级 addition。 |
| 人工节点被自动处理 | 在目标集合入口统一过滤，并为每个自动处理入口建立零调用测试。 |
| 旧 v18 数据影响新流程 | 任务 ID 和新目录字段作为活跃判定；旧 profile/template 只读保留。 |
| 大范围回退覆盖有效功能 | 不回退整个提交；逐文件引用审计后使用外科手术式删除。 |

## 14. v1.5.0：目录、重点章节与人工编制规则实施计划

> 权威需求：`docs/v1.5.0-spec.md`。本计划只实现规格的 R1—R6 和第 6 节删除项；不改两段式提示词、解析、图片、知识库、管理端、更新或发布能力。

### 14.1 T136 目录与重点标签

- 目录生成时不再自动产生人工编制责任。
- 保留招标格式优先的一级目录来源；技术规范书和知识库不得覆盖已明确的一级目录。
- 以实际目录为目标，标记服务方案、最高可解析分值和下一档不同可解析分值对应章节；同一节点只保留最高优先级。
- 删除评分主承载、增值锚点、深度写作、第五级目录和人工/重点互斥的有效业务规则。

### 14.2 T137 人工编制确认

- 使用既有 `manual_input_required` 表示最终编制责任，不新增平行责任字段。
- 目录完成后默认全部为 AI 编制；一级至三级提供人工编制复选框。
- 勾选或取消一级、二级时，对整个子树同步应用相同责任；正文阶段只读取结果。

### 14.3 T138 正文与导出收敛

- 保留正文两段式生成；AI 只生成最终叶子节点。
- 删除旧响应模式对正文、配图、状态与导出的分流；人工叶子跳过所有自动写入。
- 人工叶子未填写时导出其编制说明；AI 节点不输出编制说明作为正文。

### 14.4 T139 验证

- 为重点优先级、人工子树切换、正文零调用和人工说明导出补充聚焦回归。
- 对实际修改的 CJS 文件执行 `node --check`，并运行相关 Node 测试和 `cd client; npm run build`。
- 完整重启 Electron 后人工验证目录确认、正文跳过和 Word 导出；未执行真实模型调用、打包、提交或远程 Git 操作。

## 15. 图片编排确认与生成上下文 P0

> 权威需求：[技术方案配图规划与生成优化 Spec](../docs/secondary-development/prd/image-illustration-optimization-spec.md)。本阶段只实现 Spec 2.1—2.5；P1 的视觉节奏、模板、图文衔接和 AI 视觉复核不得提前实施。

### 15.1 当前基线与约束

- 图片计划由 `contentIllustrationPlanning.cjs` 生成并持久化到 `contentIllustrationPlan`；正文任务保存计划后直接进入图片生成。
- 图片生成的现有执行上下文只带计划项和章节正文，未完整传入视觉作用、目的、比例、评分项、价值锚点与全文风格。
- 计划、正文任务状态和运行期相位均由 Main 侧 SQLite Store 权威持久化；Renderer 通过既有 preload/IPC 访问。
- 不新增 SQLite migration、依赖、Analytics 字段、管理端、发布或导出改动。旧计划在重新编排时按新版本生成；旧工作区不能绕过确认直接进入新图片生成。

### 15.2 T157 图片计划确认状态与保存契约 — M

- 范围：`contentIllustrationPlanning.cjs`、`technicalPlanStore.cjs`、`technicalPlanIpc.cjs`、`preload.cjs`、`ipc.ts`、技术方案类型与聚焦测试。
- 目标：在现有 `contentIllustrationPlan` 中持久化确认状态、AI 推荐/用户选择的视觉风格，以及用户筛选、标题/类型修改后的计划；不保存“最小图片比例”。
- 规则：图片计划生成后状态为待确认；保存计划不启动任务；只允许 HTML/AI 类型及该类型允许的 `image_type`；确认后仍按现有有效锚点、人工节点保护和事实约束执行。
- 验收：保存后重新加载仍保留修改；旧计划或无确认计划不能作为新图片生成输入。

### 15.3 T158 正文任务确认停点与恢复 — H

- 范围：`contentGenerationTask.cjs`、`taskService.cjs`、`contentGenerationGuard.cjs` 及相邻聚焦测试。
- 目标：全文图片编排完成后，将正文任务持久化停在 `illustration-confirmation`，不调度 HTML/AI 生成；确认后只继续已保存计划的图片生成。
- 规则：取消确认不写正文；取消全部图片时允许任务完成且不插图；重新配图必须重新编排并再次确认；暂停/恢复、失败重试和原有人工节点保护保持有效。
- 验收：确认前图片模型、HTML Agent 和本地渲染调用次数均为 0；确认后只运行勾选项目。

### 15.4 T159 图片编排确认界面 — M

- 范围：`ContentEditPage.tsx`、`TechnicalPlanHome.tsx`、技术方案类型、`feature-technical-plan.css`。
- 目标：按已选高保真基线，在正文生成阶段展示内部滚动、固定操作区的“图片编排确认”弹窗。
- 内容：只读汇总（预计图片、HTML、AI、配额剩余、目录最低字数阈值）；可编辑图片标题和 HTML/AI 类型；可取消图片；展示章节/锚点、具体类型、视觉作用、评分项/价值锚点、比例、优先级；不显示最小图片比例。
- 视觉风格：不设默认；由 AI 根据全文与计划推荐七种预设之一，用户可改选；保存与确认均持久化最终选择。
- 验收：用户可保存、关闭、重新打开、取消全部、确认继续；长计划只在弹窗内容区滚动。

### 15.5 T160 受确认计划驱动的 HTML/AI 提示词 — M

- 范围：`contentIllustrationGeneration.cjs`、必要的计划/生成聚焦测试。
- 目标：让 HTML、普通 AI 和 HTML Agent 提示词均接收最终计划的视觉作用、目的、比例、评分项、价值锚点、锚点上下文、具体类型和全文视觉风格。
- 规则：渐变不作为生成限制或质量检查项；不加入 P1 模板、图号/图注、图后说明或 AI 视觉复核。
- 验收：聚焦提示词测试证明确认后的字段进入两类生成上下文，且原 HTML 布局质检规则不变。

### 15.6 T161 P0 验证与用户测试门 — M

- 自动化：计划确认持久化、确认停点/恢复、取消全部、类型约束、提示词字段与既有 HTML 保护测试。
- 静态：受改 CJS `node --check`、Renderer `npm run build`、`git diff --check`；`npm audit` 仅报告，不自动修复。
- 运行：完整重启 Electron，在正文生成完成后的真实界面确认计划弹窗、保存后恢复、取消全部与确认生成；记录控制台/任务状态/截图。
- 用户门：P0 通过用户测试后，才将 P1 加入新的计划与 `tasks/todo.md`；本次不实现 P1。

## 16. 图片生成质量优化 P1 实施计划

> 权威需求：[技术方案配图规划与生成优化 Spec](../docs/secondary-development/prd/image-illustration-optimization-spec.md)。用户已完成 P0 测试并要求进入 P1。本计划只实现 Spec 2.6—2.9：视觉节奏诊断、HTML 图表模板、图号/图注与图后说明、条件式 AI 图视觉复核；不恢复 Mermaid，不增加市场经验知识库，不实现 P2，也不把“渐变”作为限制或检查项。

### 16.1 当前基线与技术结论

- 图片计划已经是 Main 侧持久化 JSON，P1 可在既有计划中增加版本化的诊断、图后说明和视觉复核结果，不需要 SQLite migration。
- 现有 HTML/AI 生成提示词已经接收确认后的图片计划和全文视觉风格；P1 只补充七类 HTML 图表的类型化模板约束，继续沿用既有本地截图、布局诊断和修复链路。
- 现有插图 Markdown 会写入一条“为便于理解……如下图所示”的引导句，图注为斜体“图：标题”；P1 将移除该引导句，并由稳定排序产生章节内图号，图注仅包含图号和标题。
- 现有模型配置只区分文本模型与生图模型，没有可验证的视觉理解模型配置或图片输入调用链。因此 P1 不猜测某个生图模型具备视觉理解能力：只有既有文本模型实际支持图片输入时才执行复核；否则明确写入“待人工复核（未配置视觉模型）”，不阻断图片生成，也不新增模型设置、依赖或外部服务。

### 16.2 T162 视觉节奏诊断与确认页建议 — M

- 范围：`contentIllustrationPlanning.cjs`、`ContentEditPage.tsx`、技术方案类型、`feature-technical-plan.css` 与聚焦测试。
- 目标：图片计划生成后，根据正文长度、评分/价值锚点覆盖、图片角色重复和章节位置，生成只读的视觉节奏诊断；提示“高价值章节无有效图”“长段纯文字”“视觉作用重复”“开篇/核心实施/保障环节覆盖不足”等可行动建议。
- 规则：诊断只建议，不自动新增、删除、移动或勾选图片；不改变用户已确认的数量、标题、类型和视觉风格。确认弹窗在汇总区下方显示紧凑建议列表，长文本仍仅在弹窗内部滚动。
- 持久化：计划版本升级，旧计划进入重新编排路径，避免诊断结果与旧正文/锚点混用。

### 16.3 T163 七类 HTML 图表模板约束 — M

- 范围：`contentIllustrationGeneration.cjs`、必要的 HTML Agent 提示词与聚焦测试。
- 目标：为流程图、时间轴、矩阵图、鱼骨图、组织架构图、循环图、金字塔图提供类型化布局契约：层级方向、节点数量与标签长度、留白、对齐、连线、色彩分组和最小可读字号。
- 规则：仅当计划项为对应 HTML 图表类型时注入该模板；其他 HTML/AI 图片继续使用现有通用质量规则。渐变是否使用由模型按内容判断，不新增禁止、偏好或验收检查。既有文字倒置、叠压、截断、裁切、溢出、固定/粘性定位等 HTML 质检与两轮修复保持原样。
- 验收：聚焦测试断言每类图表只收到其模板约束，且原有 HTML 质量提示和修复触发条件仍存在。

### 16.4 T164 稳定图号、图注与必要图后说明 — M

- 范围：`contentIllustrationGeneration.cjs`、必要的导出聚焦测试。
- 目标：按目录章节和插入稳定顺序为成功图片生成图号；重新生成同一计划时图号稳定。图注只输出“图 {章节号}-{序号} {图片标题}”，不写真实来源、不重复标题、不使用前置引导句。
- 图后说明：在图片计划阶段由模型仅在图表不能自明、需解释阅读顺序/关键结论时生成一条基于已有正文事实的简短说明；无必要时为空。插入正文的说明作为普通 Markdown 正文，因而自然计入既有字数统计；不得重复图中文字、编造事实或添加套话。
- 导出：复用既有 Word 图片/图注样式；仅在现有 Markdown 导出解析不能保持图注独立段落时做最小修正，不改导出格式配置。
- 验收：覆盖同章多图、跨章、锚点回退、重新应用和无图后说明的 Markdown 快照；人工节点仍零写入。

### 16.5 T165 条件式 AI 图片视觉复核 — M

- 范围：`contentIllustrationGeneration.cjs`、`aiService.cjs` 的既有调用边界、计划结果类型与聚焦测试。
- 目标：图片生成完成后，只有当前已配置且实际支持图片输入的文本模型可用时，按项目既有 AI 队列对 AI 图片做一次非阻断视觉复核：异常中文、虚假 Logo、虚构人员/证书/设备/客户、风格不一致、主体裁切和构图失衡。
- 规则：复核只标记 `passed / needs-manual-review / unavailable` 及简短原因；不自动篡改图片、不重新生成、不扩大到 HTML 图，也不将“允许竖排文字”作为异常。当前没有视觉模型能力时写入 `unavailable`，保留已有人工复核状态，图片生成正常完成。
- 验收：以 mock 覆盖可用、无视觉能力、模型失败三条路径；确认没有视觉模型时不发送图片请求、不影响正文与图片落盘。

### 16.6 T166 P1 验证与用户测试门 — M

- 自动化：视觉节奏仅建议、七类模板提示词、图号/图注稳定性、图后说明字数计入、人工节点保护、视觉复核三条能力路径。
- 静态：受改 CJS `node --check`、Renderer `npm.cmd run build`、`git diff --check`；既有 `BidAnalysisPage.tsx:402` 的 TypeScript 基线错误单独记录，不借 P1 修改。
- 运行：完整重启 Electron，使用一个含多章节、多图片的技术方案验证确认页建议、风格选择保留、HTML 图表、图号/图注、图后说明及视觉模型不可用时的非阻断提示。
- 不运行真实模型、不打包、不提交、不推送；视觉模型真实复核仅在用户另行配置兼容模型并授权现场验收后执行。

### 16.7 CP13 实现审批门

确认本计划后，按顺序执行：

```text
T162 → T163 → T164 → T165 → T166
```

批准 CP13 即确认：视觉节奏诊断只建议；图号采用“章节号-章节内序号”；图注只包含图号和标题；图后说明只在必要时生成并计入正文；未配置可验证视觉模型时不新增设置或模型调用，只保留非阻断人工复核状态。

### 16.8 T167 HTML 图片本地渲染故障修复 — H

- 现象与证据：现场计划的 30 张 HTML 图片均在本地截图前以 `pathToFileURL is not defined` 失败，未生成 `asset_url`，故没有正文插图可供 Word 导出；Word 导出不是根因。
- 范围：`localImageRenderService.cjs`、本地渲染与图片编排聚焦测试。
- 修复：补齐 `node:url` 的 `pathToFileURL` 导入，通过单一文件 URL 帮助函数供临时 HTML 文档加载使用；不修改图片计划、导出协议或资产目录。
- 人工保护：人工编辑章节继续不进入图片计划、覆盖统计和视觉节奏诊断，并以回归测试锁定。
- 验收：本地文件 URL 测试、图片计划测试、HTML 图片生成测试和 Electron 实际生成一张 HTML 图片后导出 Word。

### 16.9 T168 图片数量语义与正文完成统计修订 — M

- 范围：图片规划服务、正文生成配置、技术方案类型/Store、正文统计 UI 与聚焦测试。
- 规则：删除 AI/HTML 图片数量字段和 20/30 硬上限；图片数量仅由模型按正文价值决定，程序不填满也不压缩。AI/HTML 候选不因另一类图片数量、跨类型优先级或程序配额被挤占。
- UI：按已确认高保真稿删除数量行，保留一致性修复方式原有选项文案、生图开关和图表类型；增加“图片由系统根据正文价值自动规划，生成前可在图片编排确认中筛选和调整。”说明。
- 正文：人工章节计入完成统计而不计入 AI 已生成；任务成功后显示“重新生成正文”。
- 验收：旧数量配置清理、AI/HTML 独立候选保留、人工完成统计、成功按钮文案与 Vite/Electron 回归。

## 19. 上游局部扩写与 HTML 质检性能优化

> 来源：用户确认吸收 `OpenBidKit_Yibiao` 的 `f04eabc` 与 `7cb3512`，但仅按本项目已确认的人工编制保护、字数控制、HTML 质量 Gate 和 Word 导出链路实施，不直接复制上游行为。

### 19.1 T170 局部精确扩写 — H

- 范围：`contentGenerationTask.cjs` 与既有 `contentGenerationTask.contentPlanV5.test.cjs`。
- 目标：最低字数补足的 AI 小节可一次返回多个局部 insert/replace 操作，按精确、唯一锚点以范围编辑方式写入；继续使用既有章节目标字数驱动扩写，不引入整节覆盖式扩写。
- 保护：人工编制节点不进入候选；图片、代码块、表格和其他受保护 Markdown 范围不得作为插入锚点或替换范围；锚点不精确唯一命中、操作重叠或无有效改动时拒绝整批修改并进入现有 JSON 修复链路。
- 兼容：保留当前单操作 JSON 的解析兼容；原方案覆盖修复继续使用其当前单 patch 契约，不扩大改动范围；不改 SQLite、IPC、模型配置、图片计划或 Word 导出。
- 验收：多插入/替换的稳定顺序、重复或未命中锚点拒绝、受保护范围拒绝及人工章节排除的聚焦测试；受改 CJS 语法检查、完整客户端构建和 Electron 真实扩写验收。

### 19.2 T171 HTML 质检与最终截图分离 — M

- 前置：T170 的用户测试通过后开始。
- 范围：`localImageRenderService.cjs`、`contentIllustrationGeneration.cjs` 与既有本地渲染/HTML 图片聚焦测试。
- 目标：每轮 HTML 修复只运行不落盘的布局探测；仅在诊断通过后生成一次最终 PNG，减少重复截图和临时图片开销。
- 保护：探测必须覆盖当前文字倒置/变形、叠压、遮挡、截断、裁切、溢出和固定/粘性布局诊断；两轮修复后仍不合格时继续保留 HTML 源文件、拒绝保存 PNG 和标记失败，绝不吸收上游“达到次数直接成功”的行为。
- 验收：修复一次时探测两次、最终 PNG 一次；连续失败时 PNG 零保存；HTML 图片实际生成、Word 导出及现有人工章节排除逻辑回归。

## 20. CHG-002：目录叶子归类与可选五级正文节点

> 权威需求：[CHG-002](../docs/secondary-development/changes/outline-leaf-grouping-change.md)。本阶段只改变模型新增目录的层级归类；格式要求和知识库来源既有下级层级、人工编制节点与已保存目录均不自动重组。

### 20.1 T173 目录来源边界、重点章与首次生成归类 — H

- 范围：`outlineGenerationTask.cjs`、目录生成聚焦测试。
- 目标：首次目录生成在保留来源骨架的前提下，要求模型自行补充的同主题或同评分点内容采用“三级主题 + 四级叶子”；重点章节可选择性增加五级叶子。
- 规则：同一二级目录下新增的无子节点三级目录最多 5 个；第 6 个触发结构修复。新增三级主题必须包含至少两个四级叶子，且不得使用空泛兜底标题。四级仅在重点章节中可继续展开为至少两个五级叶子；重点章节沿用现有服务方案、最高分档和次高分档标识。来源节点按现有来源骨架校验原样保留。
- 验收：来源下级节点不移动；模型新增的归类结构、6 个并列三级叶子拒绝/修复、重点章节五级允许与非重点章节五级拒绝、评分点优先落到叶子节点均有聚焦测试。

### 20.2 T174 字数规划、知识库与正文补目录保持归类 — H

- 范围：`outlineGenerationTask.cjs`、`contentGenerationTask.cjs` 及相邻聚焦测试。
- 目标：目录字数规划、知识库补目录和正文最低字数补目录均不能绕过 T173 的归类规则。
- 规则：在二级目录下新增内容时，模型只能新增带四级叶子的三级主题；在三级主题下仅新增四级叶子；仅重点章节的四级主题可新增五级叶子。不得移动来源节点、人工节点或已有正文节点；模型新增目录最大五级。
- 验收：三条补目录路径分别覆盖“新增三级主题并带四级叶子”“重点章节新增五级叶子”“非重点章节五级被拒绝”“新增第六个并列三级叶子被拒绝/修复”“人工或已还原正文节点不变”。

### 20.3 T175 目录保存、正文、图片与导出回归 — M

- 范围：`OutlineEditPage.tsx`、`technicalPlanStore.cjs`、`contentGenerationTask.cjs`、`contentIllustrationPlanning.cjs`、`exportService.cjs` 与必要测试。
- 目标：限制模型新增目录不超过五级，并确认四级或五级叶子继续是正文、字数、图片和 Word 的最小生成单位。
- 规则：不对用户手工目录强制主题归类；手工编辑最多新增至五级，不改变已有目录。目录重新生成后继续按既有规则清空正文、正文计划和图片计划。
- 验收：四级和五级叶子均可生成正文并计入完成/字数；人工叶子不进入 AI 正文或图片计划；Word 保留三级主题、四级子主题和五级正文标题；第六级手工新增被阻止。

### 20.4 T176 验证与用户测试门 — M

- 自动化：T173-T175 的目录结构、来源保留、字数补目录、人工保护、正文/图片叶子选择和 Word 导出回归。
- 静态：受改 CJS `node --check`、`npm.cmd run build`、`git diff --check`。
- 运行：完整重启 Electron，使用含明确格式来源、同主题评分细项和最低字数控制的样本，确认三级主题、四级正文、图片编排和 Word 导出。
- 不执行既有目录迁移、真实模型批量回填、打包、提交或推送。

### 20.5 CP14 实施审批门

确认 CP14 后按顺序执行：

```text
T173 → T174 → T175 → T176
```

## 21. Pi Agent 韧性与受控目录交互

> 用户已确认选择性吸收源项目的 Pi Agent 能力。主项目保留现有格式驱动目录、人工编制保护、来源骨架锁定、评分映射、字数规划和确定性质量 Gate；不直接替换为上游 `outlineGenerationTaskV2.cjs`，不吸收上游删除业务校验的提交。

### 21.1 T183 运行时韧性与可观测性

- 在 `app:open-external` 失败时复制经过既有白名单校验的 URL，并返回可操作提示。
- 启用 Pi SDK 原生 Provider 重试，新增对当前网关短暂不可用错误的规范化；原生网络重试事件单独上报，不能计入既有输出校验/修复重试。
- 监视器记录每轮工作流输入和上一轮输出，并展示阶段与原生重试事件。

### 21.2 T184 Pi 互动和结构化工具

- 增加 `ask-user` 工具：仅用于实质影响结果的单一问题，Renderer 全局 Dialog 返回答案；不暴露内部文件名或字段名。
- 增加 `json-validation` 工具：JSON.parse 与 Ajv Schema 校验；只能读取当前工作区的相对文件路径，任务可预置 Schema。
- 同步 Pi Session、自检工具清单、Agent IPC/preload、共享类型和 App Provider；不新增独立状态库。

### 21.3 T185 目录确认和只读语义审查

- `outlineGenerationTask.cjs` 在生成来源一级目录后持久化 `waiting-outline-confirmation` 状态，页面显示只读目录确认 Dialog；继续后复用原有生成、字数调整和确定性验证。
- 最终目录通过既有 `validateSourceDrivenOutline()` 和 `applyOutlineQualityRules()` 后，Pi 仅输出结构化语义审查结果；结果写入 `outlineQualityReview`，不得由 Agent 修改最终目录。
- 任务异常关闭时，未完成确认状态标记为“请重新生成目录”，不得用 Agent 工作区 JSON 覆盖 SQLite Store。

### 21.4 T186 验证门

- 自动化：JSON 路径边界/Schema、提问选项约束、目录确认等待/继续/取消、语义审查只读、来源骨架与评分映射保护。
- 静态：受改 CJS `node --check`、`npm.cmd run build`、`git diff --check`。
- 运行：完整重启 Electron，验证监视器多轮记录、提问 Dialog、目录确认和最终审查结果；不调用真实模型、不打包、不提交、不推送。

## 22. v1.7.0 Jato Agent 对话模式

> 权威需求：`D:\download\OpenJatoBID-v1.7.0-spec.md`。本阶段仅修改员工客户端及页面访问中文映射；不修改管理端、授权、发布、更新或打包流程，不新增依赖。

### 22.1 T187 数据与附件

- SQLite 升级到 v23，新增线程、消息、附件三表及 schema health 修复。
- Main 侧 Store 管理事务、软删除、启动恢复和公开 DTO；附件服务复用现有解析链路，限制 5 个/200MB/500MB，并支持 10001 字符完整转换为 UTF-8 TXT。

### 22.2 T188 Agent 对话链路

- Pi 新增不影响 task 默认行为的 `conversation` 模式：仅 `read/find/ls`，请求最高可用非 `off` 思考档位，不要求输出文件且不归档临时工作区。
- Conversation Service 负责全局队列、多轮上下文、附件 manifest、流式事件、停止、快捷操作和重新生成；Renderer 不直接调用 Agent。

### 22.3 T189 IPC 与 Word

- 新增 Conversation IPC/preload/TypeScript 契约，依赖工作区数据库就绪后注册。
- 复用现有 Markdown 转 Word 基础能力新增单条回答导出，不进入技术方案 Store、outline 完整性检查或“内容由 AI 生成”链路。

### 22.4 T190 工作台 UI

- 在“标书生成”和“模板设置”之间新增“对话模式”，实现线程列表、消息流、附件托盘、输入与停止、图标快捷操作、删除确认和响应式双栏/抽屉。
- 复用 `MarkdownRenderer`、Radix Dialog/Tooltip、Toast 和全局 CSS；不显示模式、模型、推理、内部路径或右侧栏。

### 22.5 T191 验证门

- 聚焦 Node 测试覆盖 Prompt、Store、附件、会话服务、IPC 与单条 Word；受改 CJS 执行 `node --check`，Renderer 执行 `npm.cmd run build`。
- 完整重启 Electron 后验证入口、历史恢复、10000/10001 边界、附件、流式/停止、快捷操作和单条 Word；真实模型和文件解析依赖当前本机配置。
- 不打包、不提交、不推送、不发布。

### 22.6 T195 图片附件

- 文件选择支持 PNG、JPG/JPEG、WebP、GIF、BMP；Main 复用 Pi 现有图片转换与压缩能力规范化，不增加依赖。
- 当前文本模型即多模态模型，图片以独立多模态内容随当前问题发送；模型明确返回不支持图片时复用既有 AI 错误弹窗。

## 23. v1.8.0 生图模式：T180-00 技术计划

> 权威输入：`docs/v1.8.0-spec.md`、`docs/v1.8.0-ui-handoff.md`、`docs/v1.8.0-codex-tasks.md`。需求已确认，H01–H09 具体高保真图尚未确认。本节仅为 plan，未执行 T180-01–12、计费调用或客户端运行验收。这里的 `T180-00` 系列与既有 `T180` Agent runtime 任务不同。

### 23.1 本地基线和可复用能力

- 2026-09-26 只读基线：分支 `v1.8.0-Image-generation`，HEAD `428506f725e2bfc5868710ef8f3e8e1eec28f8f0`；仅三份 v1.8.0 输入文档未跟踪，未修改它们。`origin` 指向 `migrant1124/OpenJatoBID`，`upstream` 指向 `FB208/OpenBidKit_Yibiao`；未同步远端。本地 `client/package.json` 版本为 1.7.5。
- 导航：`client/src/App.tsx` 的启动/退出默认仍为 `bid-generation`；`Sidebar.tsx` 点击父项传父 ID，`AppRouter.tsx` 对所有有 `children` 的父项先渲染 `SecondaryMenuPage`。新增生图父项若直接沿用该分支，会先出现入口卡片，与默认进入 AI 生图冲突。拟为生图父项做模块内定向，保留其他父项行为及原启动默认；三个二级入口留在主内容区。`SectionId`、`menuConfig.ts`、`AppRouter.tsx`、`Sidebar.tsx` 的图标映射均需同步。
- UI：`client/src/styles.css` 汇入 `styles/tokens.css`、布局和模块样式；可沿用 `--yb-*` 颜色/间距/字号/圆角、Radix、Toast、内部滚动，不新建全局设计体系。具体高保真尺寸必须对照运行截图。
- AI：`aiService.cjs` 已有文本队列和独立图片队列，`withQueueScope()` 与 `pauseQueueScope()` 可复用；图像请求限额读 `image_model.concurrency_limit`。现有 `generateImage()` 是以 prompt/size 为主的单图结果路径，OpenAI 兼容分支请求 `/images/generations`，Google 分支另有实现；当前不能据此声称支持多参考图、mask、视觉理解、张数/质量参数或拆层。现有请求内部重试与队列重试都要先核对，未知结果不能盲目业务重发。生成文件目前写入 `generated-images` 并返回 `yibiao-asset` URL/路径；作品长期元数据尚无生图工作台专用 Store。
- 数据：`sqliteDatabase.cjs` 当前 `schemaVersion = 32`；按版本事务迁移，升级前备份 DB/WAL/SHM，schema health 与 `sql/workspace_schema.sql` 须同步。`prompt_groups`/`prompt_items` 和 `promptLibraryStore.cjs` 已提供分组、收藏、软删除及导入；`prompt_items.source` 的 CHECK 只允许 `manual/single-import/batch-import`，不能直接写新的来源枚举。对话模式已有提示词 UI/IPC，必须保持旧条目和接口可用。
- 桥接：`preload.cjs` 将同一个 `bridge` 同时暴露为 `window.yibiao` 与 `window.jatoaibid`；`client/src/vite-env.d.ts` 两者共用 `YibiaoBridge`。新增 imageStudio API 拟沿现有 `window.yibiao` 调用，保留别名，不做全仓改名。`electron/ipc/index.cjs` 在工作区 DB 就绪后注册 Store 相关 IPC；业务放 Main service，Renderer 不直连模型或文件系统。
- 埋点：`App.tsx` 对 `activeSection` 调用 `trackPageView`，`analytics/dashboard/public/src/pages/traffic.js` 提供中文名。新增稳定、低基数的三页映射；不上传 prompt、图片、文件名、路径或密钥。现有 `promptLibrary.test.cjs`、`conversationIpc.test.cjs`、`conversationStore.test.cjs`、UI 测试及 Electron native smoke 可作为相邻回归入口。仓库无统一 `npm test`/lint 脚本。

### 23.2 实施选择及批准门

| 决策 | 可选路径 | 本计划建议及验证条件 |
| --- | --- | --- |
| 父菜单默认页 | 改所有父菜单规则；在生图父项定向；模块内部页面宿主 | 仅对生图父项定向至 AI 生图，三子页共用模块宿主；验证旧父菜单仍显示原入口卡片。若高保真要求不同布局，回到 plan 决策。 |
| 图片任务 | 扩展技术方案专属 `taskService.cjs`；建生图模块 Main 任务服务 | 后者更符合业务隔离，仍复用 `aiService` scope/队列；先验证关闭窗口、恢复、取消与未知结果状态，再固定细节。 |
| 个人提示词元数据 | 改 `source` CHECK；给旧条目增加可空用途字段/关联记录 | 优先可空用途扩展，保留旧 `source` 值与原导入合同；迁移测试后再确定字段和索引。常用风格可用独立表，不复制个人提示词正文库。 |
| 拆层/PSD | 已配置的真实分层服务；经验证的等价服务；本地模型 | T180-01 比较真实输出、分辨率、费用/运行条件和 PSD 写入可行性后选择。没有真实非空差异层就阻塞 PSD 交付；不默认要求员工安装 GPU/Python。 |

计划批准只允许进入下一任务的验证准备；付费模型调用、依赖增改、数据迁移落地及大范围 UI 编码各自遵守任务书门槛。高保真 H01/H02 批准前不得进入 T180-02 的视觉落地；H03、H09 分别约束 T180-09、T180-11。

### 23.3 拟改文件与责任（均未修改）

| 任务 | 必需位置/候选文件 | 理由 |
| --- | --- | --- |
| T180-01 | `client/electron/services/aiService.cjs` 与相邻探针测试；必要时独立验证脚本 | 基于现有队列验证真实模型合同；是否扩展服务取决于探针，不预建空适配层。 |
| T180-02/03/08/09 | `client/src/shared/types/navigation.ts`、`client/src/app/menuConfig.ts`、`client/src/app/AppRouter.tsx`、`client/src/components/Sidebar.tsx`、`client/src/features/image-studio/`、`client/src/styles/feature-image-studio.css`、`client/src/styles.css` | 导航、三页宿主、创作和局部涂抹；不改通用二级菜单。 |
| T180-02/03/09/10/11 | 新增 `client/electron/ipc/imageStudioIpc.cjs`、最小 `client/electron/services/imageStudio*.cjs`，接入 `client/electron/ipc/index.cjs`、`client/electron/preload.cjs`、`client/src/shared/types/ipc.ts` | Main 负责任务、资产、版本与导出；IPC 只转发、事件带任务身份。具体服务文件数随首个纵向闭环定。 |
| T180-02/06/07/10/11 | `client/electron/services/sqliteDatabase.cjs`、`sql/workspace_schema.sql`，相应 Store/测试 | 草稿、任务、作品、远程缓存、个人用途及图层元数据的版本迁移和恢复。图片像素放模块受管磁盘目录。 |
| T180-04/05/06/07 | `client/src/shared/prompts/`、`client/electron/services/promptLibraryStore.cjs`、`promptLibraryService.cjs`、`client/electron/ipc/promptLibraryIpc.cjs`，以及 preload/共享类型中既有 promptLibrary 合同 | 统一个人库，保存/优化/反推/中文参考串联，维持原对话导入行为。 |
| T180-02/12 | `analytics/dashboard/public/src/pages/traffic.js`；仅当既有管理端有独立页面名映射时补对应文件 | 新页面中文名和回归；不改变收集字段或统计能力。 |
| T180-11/12 | 经能力验证后确定 PSD 写入器及必要依赖；`client/package.json`/锁文件仅在另获依赖批准时 | 真分层 PSD、真实 Photoshop 检查；当前未安装 `ag-psd`/`sharp`，不预设新增依赖。版本源/锁文件只在 T180-12 获批后改。 |

### 23.4 接口和数据合同草案（T180-01 后冻结）

- Renderer → Main：`imageStudio.getCapabilities()` 返回逐能力 `verified/status/limits`；`loadDraft/saveDraft({revision, ...fields})`；`start({kind, draftRevision, sourceAssetIds, referenceRoles, settings})` 返回内部任务 ID；`cancel({taskId})`、`getTask/getWork/listWorks`；`exportImage/exportPsd`。选择图片、落盘和导出路径由 Main 处理。事件至少含 `taskId/kind/stage/status/resultIds/error`，取消订阅返回清理函数；不传像素大数组或密钥。名称和字段是草案，先以 T180-02 最小闭环定稿。
- 请求快照：冻结原文、用户明确应用的优化稿、实际发送文本、参考资产 ID/角色、模型配置引用、能力版本、父作品 ID、时间；结果记录实际尺寸/编码/哈希和每张成功失败。草稿用 revision 防旧异步结果覆盖新输入；优化/反推/保存均不自动调用付费生图。
- 持久化：SQLite 中独立命名的草稿、任务、作品/版本、资产引用、来源缓存/翻译、风格及拆层元数据；磁盘中保留输入、原图、结果、图层和 PSD 文件。保存文件成功后再标记结果完成；关联资产删除先查引用，父版本元信息不因子版本存在而消失。迁移保持幂等，先备份再升级，旧版数据可读取；失败恢复和回滚以备份副本为依据，不就地清空旧库。
- 能力矩阵逐项记录：文字优化/翻译、单图理解、文生图、1–4 参考图、原生 mask/替代方式、拆层。每项区分文档声称、代码适配、模拟返回、真实调用四级；记录端点、输入格式、角色是否实际传达、尺寸/比例/张数/质量、返回方式、超时/查询/取消、费用与部分失败。普通生成接口与拆层接口分别取证；未验证参数不得出现在可用 UI。
- PSD 合同：源版本与尺寸、真实透明层文件、层序/位置/alpha、合成预览和尺寸差异；至少两个非空且内容不同的层。逐层隐藏、合成一致性及 Photoshop 打开属于独立验收，不把像素文字标成可编辑文本。

### 23.5 顺序、逐项验收与阻塞

| 顺序 | 任务/需求覆盖 | 核心验收和门槛 |
| --- | --- | --- |
| 0 | T180-00，Spec 全部范围 | 本地基线、拟改文件、合同草案与取证清单完成；停在本计划批准门。 |
| 1 | T180-01，US-01/02/03/04/06 的外部能力 | 先离线核配置/响应与样本，再经授权做真实端点小样本；记录单图、1–4 图、视觉、mask、拆层及 PSD 结果，不能用模拟冒充真实。付费请求/依赖需明确授权。 |
| 2 | H01/H02 代表性设计确认；T180-02，US-01 | 一级入口默认 AI 生图、真实文生图、持久化、真编码 PNG/JPG/WEBP 下载；重启/切页、部分成功和原功能回归。 |
| 3 | T180-03，US-02；T180-04，US-01/04/05；T180-05，US-04 | 参考角色进入请求且版本不覆盖；优化对比人工应用；识图结果与来源绑定、可编辑/复用。各能力未通过时只阻塞依赖的任务。 |
| 4 | T180-06/07，US-05；T180-08，简单模式 | 远程中文参考增量同步失败保留缓存；个人库兼容/风格应用；八类预设与三条流程，无专业入口。来源/许可和 H06/H07 须核对。 |
| 5 | T180-09，US-03；T180-10，US-01/02/03/06 | H03 批准后验证原图坐标、选区外像素保护和新版本；作品恢复、引用安全删除、未知任务不盲重发，H08 对照。 |
| 6 | T180-11，US-06 | 拆层真实能力与 H09 批准后，真差异图层、分辨率/损失显示、PSD 写入及三类样本真实 Photoshop 人工验收。 |
| 7 | T180-12，Spec 第 10 节 | `node --test` 聚焦测试、受改 CJS `node --check`、`npm.cmd run build`、Electron 全链路、v1.7.5/对话/提示词/授权/埋点/更新回归；只读 Review 与分层证据。版本准备另按任务书，不等于发布。 |

当前阻塞：T180-01 待计划、渠道/测试素材与必要调用授权；T180-02 待能力及 H01/H02；T180-09 待 mask/标注方案与 H03；T180-11 待真拆层/PSD 写入验证与 H09；其余 T180-03–08/10/12 按表中前置项未启动。若外部拆层不可用，应保留 US-06 未完成，不用假层或隐藏入口宣称 v1.8.0 完成。

### 23.6 高保真与现有页面取证清单

- 在后续获准的 Electron 运行取证中保存同一版本、窗口尺寸、显示缩放及截图时间：现有展开/收起的一级侧栏、带子项父菜单的 `SecondaryMenuPage`、对话模式提示词库/保存操作、结果/下载或导出弹窗、设置页模型配置、Toast/Dialog 与窄窗口状态。当前未启动客户端，以上均为待取证，不填造截图路径。
- 先做 H01（默认创作/三子入口/空状态）、H02（1–4 参考图角色/结果/操作）、H03（原图坐标遮罩/工具/缩放）、H05（原文/优化稿/变化/取消应用）的代表性设计；每张附布局、复用组件、内部滚动、最长中文文案、键盘与错误状态说明。确认后再做 H04/H06/H07/H08/H09；未确认图片只作设计讨论，不作验收基线。
- 视觉核对 1440×900、1280×800、实际最窄窗口及 Windows 100%/125%/150%；检查 S01–S12、按钮可读名、焦点恢复与 Esc 不隐性取消任务。设计图和真实 Electron 运行截图分目录、分状态记录。

## 24. v1.8.0 R3 连续实施补充

> 本节承接第 23 节已落地的最小闭环。R3 权威改为 `docs/v1.8.0-spec-final.md`、`docs/v1.8.0-ui-handoff-final.md`、`docs/assets/v1.8.0-r3/design-assets.json` 及 11 张独立图；第 23 节的旧审批门与未实施描述仅作为历史基线，不再限制本轮已授权的连续 build。执行状态只记 `tasks/todo.md`。

1. 保留 v33 数据和现有导航、图像队列、编码导出、PSD 写入器。v34 向前迁移增加草稿参数/参考资产、任务请求快照与子结果、提示词用途元数据、常用风格、来源配置/快照、图层派生数据；隔离副本先验备份、幂等和旧数据保留。
2. `aiService` 为新模块提供提交时的配置冻结、可控单次请求、真实视觉消息与图像编辑适配；无合同的参数禁用并说明。限额内真实调用按独立证据计数，不把超时自动重提。
3. 来源按固定 commit/manifest/hash 验证，逐源记录中文覆盖与再分发条件；不能合法打包的来源保持配置/在线同步能力，但 AC25 必须标阻塞，不能塞假数据。默认配置、用户覆盖/删除、远程快照和个人副本独立。
4. 页面按 H01–H11 拆为创作、提示词中心、作品与业务弹窗；三个入口与现有壳一致。提示词优化与反推只产生候选，主动应用/保存不生图。局部修改与 PSD 使用实际像素层和受管资产。
5. 验证分层记录 U/I/E/R/F，关联 AC01–AC60；先聚焦测试与构建，再隔离 Electron、真实小样本、视觉尺寸和独立只读审查。真实外部阻塞只隔离相关 AC，未通过必达项不称整版完成。版本源/锁文件最终对齐 1.8.0，不执行发布 Git 操作。

## 25. v1.8.0 生图模式 R4 修正

> 权威输入：`docs/v1.8.0-image-studio-fixes-spec.md`。R4 覆盖冲突的 R3 约束，其余 R3 UI/数据合同保持。当前基线 `v1.8.0-Image-generation` / `3cc44c9100593b7ee9190e24dc99dd7468695a95`，仅 R4 规格未跟踪；8 项聚焦测试通过。禁止任何 Git 状态变更、发布及超预算模型请求。

1. W01：先备份真实 SQLite，核对已有草稿、任务、作品、来源及 PSD schema；在隔离库上测迁移和数据保留。
2. W02/W06 风险前置：参考图与编辑统一通过 `aiService` 队列，主进程读取受管图片与选区；保留原文、角色、尺寸、父版本、真实请求/结果。PSD 复用 `ag-psd` 写入器，增加本地像素分割、图层会话/预览/细修与 IPC。真实中转小样本计数，拒绝/不可用只隔离外部验收，不锁用户功能。
3. W03：来源分页返回同过滤条件的总数；封面图经 Main 安全下载、本地受管缓存与单条重试；来源收藏采用唯一来源键的事务个人副本，并保持个人编辑、来源、封面关联。
4. W04：仅生图创作局部 CSS 控制输入框与按钮尺寸；同排张数/画幅和草稿恢复；图片预览缩放/切换/独立操作；风格说明、幂等应用及撤销。
5. W05：Main 后台七天自动同步已启用内置来源；可注入时钟、持久化成功/尝试/退避时间、同源合并；无变化推进检查时间，增量中文化不覆盖用户内容。
6. W07：V01–V65 按 U/I/E/R/F 分层记录，聚焦/全量测试、构建/打包、真实 Electron 与真实中转分别取证，PSD 样本及 Photoshop 单列；审查只读、修复后复测。状态仅在 `tasks/todo.md`。
# v1.8.1 生图模式增量计划（2026-09-27）

依据 `docs/v1.8.1-image-mode-optimization-spec.md`，在当前分支保留 v1.8.0 R4 实现。按以下顺序完成并以 `tasks/todo.md` 记录状态：

1. 核对并修正创作页、统一预览、提示词中心与来源更新；沿用已有 Store、IPC 和缓存。
2. 将局部修改从单遮罩升级为逐区域遮罩及提示词；任务仍由 Main 发出，失败保留前台输入，新结果另存作品。
3. 用真实 SAM 对象遮罩生成多对象透明像素层，使用现有生图队列调用 GPT Image 2.5 补全背景，复用 PSD 写入器；预览和导出共享图层数据。
4. 分层运行聚焦测试、构建、隔离 Electron、真实中转与 Photoshop 可用性验收；只读审查当前 diff。真实环境无法执行的项目保留未完成状态，不以模拟结果代替。

## v1.8.1 局部修改 LE-R2（2026-09-27）

按已选 LE-01 和 `docs/v1.8.1-local-edit-{redesign-spec,ui-handoff}.md` 连续实施。只读基线：`v1.8.1-PSDopt` / `a682d9ba52669b3d1ba230cf01c9910a5ad4c812`；四份 LE 输入资料未跟踪，均保留。当前 `ImageStudioRegionEditor` 预置空区域、补减选、粗笔刷及图下输入；`ImageStudioPage.start` 从当前 `selectedWork` 取编辑源，存在窗口打开后切图窜源风险。Main 已有逐区遮罩、一次编辑任务、标注参考、选区外原像素合成及独立作品保存；PSD refine 用独立组件。

1. 建立局部编辑会话的稳定 ID、完整内容快照历史、临时空项结算及可重复逻辑测试；避免改 SQLite 模式。
2. 在 `ImageStudioRegionEditor.tsx` 和局部作用域 CSS 中实现 LE-01 布局、自由闭合圈选/矩形/SAM、右侧卡片、导航图、单一视图比例及键鼠规则。复用既有 IPC 和 SAM；不改 PSD refine。
3. 在 `ImageStudioCreate.tsx`/`ImageStudioPage.tsx` 冻结编辑源并让每项意见进入既有 Main 一次提交。仅在实际合同缺口处修改 Main。
4. 聚焦逻辑与服务测试、构建、隔离 Electron 多尺寸截图、真实 SAM/已授权中转、PSD refine 相邻回归；LE-T01—48 分层记录于 `tasks/todo.md` 和测试报告，最后只读审查。无新费用授权的调用标未执行；不操作 Git 状态或发布。

## 26. v1.8.4 功能精简：文件级技术计划（2026-10-03）

### 26.1 权威输入与阶段边界

- 规格：`docs/secondary-development/prd/v1.8.4-feature-pruning-spec.md`；实施指令：`docs/secondary-development/v1.8.4-feature-pruning-codex-instructions.md`。
- 已读根 `AGENTS.md`、根 `开发说明.md`、`.agents/skills/openjatobid-secondary-development/SKILL.md`、Plan reference 和 verification matrix。包含隐藏目录的本地检索只找到根 `AGENTS.md`，未发现受影响目录另有指令。
- 用户确认的是 D01—D08、C01/C02、客户端目标版本及现有实施分支。核对既有 `tasks/plan.md`、`tasks/todo.md` 未找到本轮计划、FP-01—FP-08 冲突或本轮技术计划确认记录；上方其他版本的批准和历史分支记录不作为本轮批准。
- 当前只执行 FP-01/FP-02；本节供用户确认，**尚未批准进入 Build**。仅追加计划和唯一任务状态，不修改源码、测试、版本字段；不安装依赖、不构建、不打包、不启动 Electron、不调用模型。
- 本节是执行计划，不另写 PRD、ADR、API 合同或并行状态文件。没有架构、IPC、数据库和视觉布局变更。测试/审查报告由后续真实执行产生，不预写通过结论。

### 26.2 本地基线与原有改动保护

| 项目 | 本次只读核验结果 |
| --- | --- |
| 实际仓库 | `D:\Documents\OpenJatobid` |
| 实际实施分支 | `v1.8.4-架构优化`；正常分支，不是 main/master 或 detached HEAD |
| HEAD | `7d5c26d1117f41071396818a0ed721081aca10db`，与规格历史快照相同；没有回退操作 |
| 原始 `git status --short` | 只有 `?? docs/secondary-development/prd/v1.8.4-feature-pruning-spec.md` 和 `?? docs/secondary-development/v1.8.4-feature-pruning-codex-instructions.md` |
| 已跟踪候选文件 | 原始 `git diff --stat` / `git diff --cached --stat` 均无差异；无原有源码/计划重叠修改 |
| origin | `git@github.com:migrant1124/OpenJatoBID.git` |
| upstream | `https://github.com/FB208/OpenBidKit_Yibiao.git` |
| 其他 remote | `Anna755zyp` → `git@github.com:Anna755zyp/OpenJatoBID` |
| 原有计划/任务 | 逐字保留既有内容；只在末尾追加本轮章节。没有本轮已批准计划与当前分支的冲突 |
| 旧精简文档 | `rg --files` 未找到旧 `feature-pruning-spec.md` 或旧配套指令；无需迁移或覆盖旧文档 |
| 安装工具只读清点 | Windows x64；Node `v26.1.0`、npm `11.13.0`；当前已安装 TypeScript `5.9.3`、Electron `41.5.0`、electron-builder `26.8.1`、Vite `7.3.2`。只是版本读取，不是运行时或 ABI 验证 |

原始两份未跟踪输入的 SHA-256：

- 规格：`F0BDBF41A1C5B6C530AA55B8E73E6311D8CAE736B94A7E7D6701186D2DD789A6`。
- 指令：`5C573D77360B72CF784BF245A2BAE8F84685467F9852C1DA716081BFC2F7B167`。

原始计划/任务 SHA-256：`tasks/plan.md` 为 `EDA98B321079D472CB59816D66242C1785139D5D3FF4A177FC96C9302770D3D7`；`tasks/todo.md` 为 `F10152DF395C541FF78870BC43E33BDA8274E6123DBCB89F472D830E173194AB`。写入采用末尾追加，原有字节保持不变。后续每阶段开始先核对分支、HEAD、工作区；出现新重叠修改先列明保护方案，不覆盖、不 stash。分支与本节不一致或 HEAD 意外变化时先说明并停止受影响修改。

### 26.3 八个目标入口的实际调用清单

| 项 | ID | 菜单、类型、图标 | 实际页面/路由 | Main、测试与统计边界 |
| --- | --- | --- | --- | --- |
| D01 | `bid-opportunity` | menuConfig 顶级声明/隐藏集合、SectionId、Sidebar 的 RadarIcon | AppRouter lazy + case → BidOpportunityPage；静态演示 | client Main/IPC/preload 和现有测试未发现专属 ID/页面引用；保留看板历史映射 |
| D02 | `resources` | menuConfig 顶级声明/隐藏集合、SectionId、Sidebar 的 ResourcesIcon | AppRouter lazy + case → ResourcesPage；真实列表/搜索/详情页 | 页面 fetch 到 `https://analytics.agnet.top/resources`，搜索仅增加 `q`；点击调用共享 trackResourceClick。页面和局部 helper 删除，共享 Analytics/服务/接口/历史记录保留 |
| D03 | `business-bid` | menuConfig 子项/隐藏集合、SectionId、Sidebar 的 BriefcaseIcon | AppRouter lazy + case → BusinessBidPage；静态演示 | 不触碰商务正文、承诺函、报价、表格或评分逻辑；保留历史映射 |
| D04 | `image-knowledge-base` | menuConfig 子项/隐藏集合、SectionId、Sidebar 的 ArchiveIcon 映射 | 当前无页面或路由 | 仅删占位声明；ArchiveIcon 仍被文档知识库使用，不删除图像、生图或知识库能力 |
| D05 | `ai-evaluation` | menuConfig 子项/隐藏集合、SectionId、Sidebar 的 BidCheckIcon 映射 | 当前无页面或路由 | 仅删占位声明；BidCheckIcon 仍被标书检查使用，不触碰评分反查、查重、废标等逻辑 |
| D06 | `developer-prompt-lab` | developerMenuItems 子项、SectionId、Sidebar 的 FlaskIcon 映射 | isDeveloperDemoSection → DeveloperDemoPage 的 demoConfigs | 仅静态演示，无真实 Prompt 调试执行；保留历史映射及真实 Prompt 能力 |
| D07 | `developer-parser-sandbox` | 同 D06 | 同上，独立 demoConfigs 条目 | 仅静态演示；保留真实解析、MinerU、图片导入 |
| D08 | `developer-export-preview` | 同 D06 | 同上，独立 demoConfigs 条目 | 仅静态演示；保留真实 Word/Markdown/图片导出 |

引用核验覆盖 `client/src`、`client/electron`、`client/scripts`，并只读分类 `management/`、`analytics/` 的历史统计命中。没有发现需为本轮删改的 Main 独占实现，不修改 Main、IPC、preload 或桥接类型。检查后台不等于授权清理后台。

### 26.4 文件级删除与局部修改清单

以下均是待确认、待 Build 的处理，不代表已删除。行号用于本基线定位，Build 前按实际内容再次核对。

| 文件/符号 | D/C 项与当前引用方 | 独占/共享证据及拟处理 | 保护对象与验证 |
| --- | --- | --- | --- |
| `client/src/features/bid-opportunity/pages/BidOpportunityPage.tsx` | D01；AppRouter:7、82 | feature 只有此文件；只展示静态 opportunities/signals，拟删除整文件 | 不按“投标”字样删除业务；静态连接/产物检查 |
| `client/src/features/business-bid/pages/BusinessBidPage.tsx` | D03；AppRouter:8、62 | feature 只有此静态演示页，拟删除整文件 | 不删除商务正文/承诺函；业务回归 |
| `client/src/features/resources/pages/ResourcesPage.tsx` | D02；AppRouter:21、68 | feature 只有此文件；ResourceItem、ResourceCover、normalizeResource 等只在本页，拟删除整文件 | 共享 trackResourceClick、Markdown/Dialog/Toast 保留；精确接口网络核验 |
| `client/src/features/developer/pages/DeveloperDemoPage.tsx` | D06—D08；AppRouter:12、53 | demoConfigs 只包含三个目标演示页，无保留页消费，拟删除整文件 | 保留其他 developer 页面、监视器子窗口及 Token 统计窗口 |
| `client/src/features/developer/developerDemoSections.ts` | D06—D08；AppRouter:5、53、DeveloperDemoPage 类型导入 | 只给目标演示页提供类型/判断，拟删除整文件 | 不删除 developer 目录 |
| `client/src/styles/feature-resources.css` | D02；styles.css:19 | 各规则均被 resources-/resource-book-/resource-detail- 祖先限定；唯一共有 primary-action 也受资源祖先限定。is-${tone} 动态变体来自本页，拟删除整文件 | 只移除资源限定规则；共享 primary-action 定义不动 |
| `client/src/app/menuConfig.ts` | D01—D08；Sidebar、AppRouter、SecondaryMenuPage、菜单辅助函数 | 局部删除八项、phaseOneUnavailableNotice、phaseOneHiddenSectionIds 及专用过滤。剩余 getAppMenuItems 沿用现有数组组合，不引入新接口或就地修改共享数组 | 普通六项顺序、子菜单和开发者四项顺序；反复调用/开关行为测试 |
| `client/src/shared/types/navigation.ts` | D01—D08、C02；所有导航消费者 | 仅删八项及旧 export-format 的 SectionId 分支 | AppMenuNotice、子菜单通用接口/图标联合类型保持；编译检查 |
| `client/src/components/Sidebar.tsx` | D01—D08、C01/C02 | 删九个目标导航映射；BriefcaseIcon、ResourcesIcon、RadarIcon 仅由目标映射消费，拟删局部函数；删 SHOW_USER_GUIDE、USER_GUIDE_URL、footer 中文档按钮表达式、renderUserGuideButton 和仅它消费的 BookIcon | DocumentIcon、ArchiveIcon、BidCheckIcon、FlaskIcon 等仍使用；保留 openExternalUrl、Toast/notice、设置、Tooltip、折叠、高亮、Logo 和几何布局 |
| `client/src/app/AppRouter.tsx` | D01—D03、D06—D08、C02 | 删四个 lazy 页面声明、三个页面 case、演示模块 import/判断分支、旧 export-format case | ExportFormatPage/MyTemplatesPage、editingTemplateId、离开守卫、共用技术方案 props、生图专用路由、知识库二级页保持 |
| `client/src/styles.css` | D02 | 只删 feature-resources.css 的 import | 其他 CSS 顺序不变 |
| `client/src/styles/feature-developer.css` | D01/D03/D06—D08；多个保留开发者页面 | 删除本基线 246—791 行中的 developer-secondary-*、demo-*、opportunity-* 独占块及对应响应式选择器；demo-dev-badge 仅在该演示块内已有孤立定义，一并删除。保留 938/966 附近混合 media 中 developer-test-* 部分，不重排其他块 | 保留 developer-test-*、developer-expansion-replace-*、token-stats-*、agent-monitor-* 及其响应式规则 |
| `client/src/styles/ant-v6-overrides.css` | D01/D02/D03/D06—D08 | 从混合 :is() 列表只移除 developer-secondary-*、demo-*、business-bid-demo、opportunity-*、resources-shelf-panel、resource-book-row；删除 285—288 行资源封面四种颜色专用覆盖及直接对应注释；经全 src 核验无其他消费者，移除资源/demo/opportunity 专属属性通配分支 | 保留同一规则其他 selectors/声明，以及 developer-/export-/template- 等共享通配和 Ant 样式；不整段删除混合规则 |
| `client/src/styles/shared-markdown.css` | D02；ResourcesPage:138 | 454、555 行混合选择器列表只删 resource-detail-markdown 分支，保持逗号语法；规则本身共享 | markdown-viewer、remote-notice-content 和全屏能力保持 |
| `client/package.json` | 版本同步；应用版本来源 | 只改顶层 version，详见 26.7；不新增 npm 测试脚本 | scripts、dependencies、devDependencies、build、appId、publish 原样 |
| `client/package-lock.json` | 版本同步 | 只改顶层 version 与 packages[""].version，实际格式 v3 | 第三方版本/resolved/integrity/树/格式原样；结构差异核验 |
| 根 `开发说明.md` | 本轮现行模块说明 | 删除 resources 与 bid-opportunity/business-bid 模块条目；资源列表不再是客户端公共页面能力，最小移除此处陈述中的资源列表 | export-format 模块保留，通用架构/流程/Git/统计/发布不改，不补无关遗漏 |
| 根 `README.md` | 本轮直接过时入口说明 | 仅更新“入口隐藏、源码未删除”那段，说明本轮八项/隐藏文档入口下线，真实业务/模板保留；不改无关的历史更新/开发路径描述 | README、手册、历史资料与外链仍保留 |
| 根 `AGENTS.md` | 本轮资源页能力描述 | 只把“公告、资源列表和 GitHub 软件更新仍为独立公共内容能力”改为“公告和 GitHub 软件更新仍为独立公共内容能力”，使客户端现状说明一致 | 其余授权、Analytics 降级、Git、模块、统计和发布保护条款保持原字句 |
| `client/scripts/feature-pruning.test.cjs`（新） | AC01—06、12—14；TC01—04、07、09、25—27 | Node 内置 test + 已安装 TypeScript 在内存编译真实 menuConfig 并调用导出函数；补导航/CSS残留及版本白名单核验 | 不增加框架、依赖、调试入口或生产兼容代码；版本/范围检查不能替代运行时 |
| `client/scripts/feature-pruning-electron-harness.cjs`（新） | TC05—19、21；隔离运行入口 | 在加载 bootstrap/Main 或任何 Store 前显式 app.setPath('userData', 专用绝对目录)，复用现有 Store 构造合成夹具；必要模型/解析响应仅在测试进程替换 | 不读正式 userData/正式密钥；测试限定的受控响应不宣称真实模型通过 |
| `client/scripts/feature-pruning-electron-smoke.cjs`（新） | 可重复 Electron/IPC/模板证据 | 复用已安装 playwright-core 的 _electron 与前述 harness，从真实保留入口导航，保存证据/合成导出；不将旧目标页注入生产导航 | 不增加生产开关；包的正式启动和授权另列验收 |

预计整文件删除 **6 份**（五份 TS/TSX + 一份资源 CSS）；目录只会因这些精确文件删除成为空目录，不执行递归目录清理。后续测试证据产物不算源码删除数量。Shared 的 SubMenuIcon 中 briefcase/prompt 等通用图标分支和图标类型联合仍属共享菜单接口，本轮保留，不借删除页面改造公共接口。

### 26.5 必须保留的文件/能力及残留理由

- `client/src/features/export-format/` 全目录、ExportFormatPage、MyTemplatesPage、TemplatePreview；`feature-export-format.css`、`shared/types/exportFormat.ts`、`shared/utils/exportFormatCss.ts`；模板 Store/IPC 和 Word 导出服务完整保留。TechnicalPlanHome 仍导入 TemplatePreview、ContentEditPage 仍使用 export-format-preview 类名。
- `client/src/features/developer/pages/DeveloperTestPage.tsx`、`ContentExpansionReplaceTestPage.tsx`、`PiAgentMonitorPage.tsx`、`SystemDiagnosticsPage.tsx` 以及 `PiAgentMonitorWindow.tsx`、`DeveloperTokenStatsWindow.tsx` 保留；相关 developerIpc/服务/统计与 Agent runtime 保留。
- `feature-technical-plan.css:4432` 的 feature-under-development-overlay 仍被 `TechnicalPlanHome.tsx:1128` 使用，不删除、不修改；panel、section-kicker、Dialog、Toast、布局和 Markdown 共享样式保留。
- `client/src/shared/analytics/analytics.ts:248` 的 trackResourceClick 和 resource_click/resources 契约保持，即使页面下线后无新调用；`client/electron/services/analyticsService.cjs`、analyticsQueueStore/analyticsIpc/preload 及模型统计保持。
- `analytics/dashboard/public/src/pages/traffic.js` 中 resources、business-bid、bid-opportunity、开发者演示 ID 和 export-format 的历史标签保留，Worker 资源接口、事件字段、统计数据与管理端看板也保留。字符串命中是历史解释，不是活动页面。
- 技术方案与扩写共用页、conversation/prompt-library、image-studio/作品、knowledge-base、duplicate-check、rejection-check、auth/settings、App.tsx、AppShell、SecondaryMenuPage、版本读取模块均不列为源码修改对象。
- `management/`（当前版本 1.4.2）、`analytics/`、`sql/`、所有数据库 migration、更新/发布脚本、`.github/workflows/`、vendor/SAM/Agent 工具及第三方依赖冻结。所有历史业务数据和正式缓存保留。

### 26.6 C02 决策：选择 A，不新增兼容层

完成包含隐藏目录、排除 .git/node_modules/dist/release/vendor 的源码检索，并对 576 个 TS/TSX/CJS/MJS/JS/JSON/SQL/HTML 文件核对单引号、双引号、模板字符串中的精确旧 ID：

1. 活动客户端仅三处精确旧值：`navigation.ts:22` 类型、`Sidebar.tsx:35` 图标映射、`AppRouter.tsx:80` 路由 case。没有 menuConfig 声明或现行导航调用。
2. 当前创建入口：AppRouter 的 MyTemplatesPage 回调 → new-template（:77）；TechnicalPlanHome 的模板跳转也是 new-template（:890）。编辑通过 editingTemplateId 和 mode="edit"，无需旧导航。
3. `App.tsx:19` 当前页为内存 useState('bid-generation')；用户操作经 requestSectionChange/离开守卫更新，登出重置，关闭开发者模式沿现有 effect 返回 bid-generation。未持久化或恢复旧 SectionId。
4. `main.tsx` 只解析 window=token-stats/agent-monitor，BrowserDebugPreview 只解析 preview=about；Main 协议为 yibiao-asset，不产生旧页面导航；preload/IPC 无旧 ID 消费边界。其余 localStorage 读取为公告关闭/旧统计客户端 ID 等，非当前页面恢复。
5. 全仓另一处精确旧 ID 为 traffic.js:52 的历史统计映射，保留；模板路径、样式前缀、日志名及历史文档不等同于活动导航。

因此按规格 7.3 **A** 删除类型、图标映射和重复路由，仅保留 new-template 作为新建模板导航。备选 B 适用于有内部调用，本基线没有；C 适用于实际旧值读取边界，本基线没有。不给八个退役页新增通用恢复系统。Build 前若出现新证据须返回计划说明，不能静默改为兼容框架。

### 26.7 客户端版本白名单与读取链路

| 文件/字段 | 实际原值 | 批准后拟值 |
| --- | --- | --- |
| `client/package.json` 顶层 version | 1.8.3 | 1.8.4 |
| `client/package-lock.json` 顶层 version | 1.8.3 | 1.8.4 |
| `client/package-lock.json` packages[""].version | 1.8.3 | 1.8.4 |
| `management/package.json` version | 1.4.2 | 保持 1.4.2 |

没有其他客户端根项目版本字段需要补造。使用最小文本编辑，禁止 npm version、全仓版本替换、锁文件重新解析。测试调用直接用 `node --test scripts/feature-pruning.test.cjs`，**不新增 test:feature-pruning 脚本**。对比原清单/锁文件，归一上述三个字段后深比较其余结构，人工确认文本 diff 只有允许字段。

版本链路已经存在：Electron `app.getVersion()` → `ipc/index.cjs:443` 的 app:get-version → preload.getVersion → `shared/runtime/appVersion.ts` 的 getAppVersion → StartupAuthPage / SettingsPage。保留 window.jatoaibid/window.yibiao 回退与缓存，不硬编码 1.8.4、不改 API。TC26 分别核对静态字段、登录页、设置/关于及本地验证包内应用版本/原命名模板生成的文件名，缺一层证据就分层标记，不以静态元数据代替完整验收。

### 26.8 实施顺序、决策门与成功标准

执行状态只见 `tasks/todo.md` 本轮章节，下表只描述任务顺序和验收，不作为第二套状态表。

| 任务 | 前置与范围 | 成功标准/检查 |
| --- | --- | --- |
| FP-01 基线核验 | 读取本轮输入/规则/现代码，源码只读 | 分支/HEAD/原有差异、版本、独占/共享引用和 C02 A/B/C 证据具备 |
| FP-02 Plan 与用户确认 | FP-01；本节和任务文件 | 文件范围、C02=A、三个版本字段、隔离验证方案可复核；**用户明确确认本技术计划后**才开始 FP-03 |
| FP-03 导航/独占页删除 | FP-02 明确批准；四个入口文件和五个独占 TS/TSX | 八项从导航/类型/图标/页面连接真正删除；普通六主菜单不变、开发者四子项；菜单行为测试及 build |
| FP-04 样式/C01 | FP-03；本节 CSS 和 Sidebar 精确局部 | 删除独占资源 CSS/演示样式/文档按钮，保留混合规则其他分支；CSS 解析/残留检查及 build |
| FP-05 C02 收口 | FP-02 已批准 A；可与 FP-03 的类型/Sidebar/AppRouter 编辑一并完成 | 旧三处活动值移除；模板新建/编辑路由和保留目录完整，专项测试 |
| FP-06 版本/测试/说明 | FP-03—05；三个字段、三个测试文件、直接过时说明 | 根版本一致 1.8.4、依赖树不变；测试真实调用菜单函数；说明与最终代码一致；build/聚焦回归 |
| FP-07 Verify | 完整差异、测试夹具；必要时返回 Build 修复 | TC01—27 分层证据、产物与隔离 Electron/导出记录，失败/未测/环境阻塞明示 |
| FP-08 Review/交付 | 规格、本节、唯一任务状态、差异和 FP-07 证据 | 用可用 openjatobid_reviewer 独立只读审查；报告后范围内问题返回 Build→Verify→Review，不在 Review 改源 |

Build 开始、每批和交付前复查实际分支/HEAD/用户改动。第一批前先执行相关既有测试与构建取得本机改前基线；本轮新测试应能在旧代码上揭示开发者七子项/目标连接仍在的差异，不将预期失败误记环境问题。以导航/页面、样式/辅助收口、版本/说明三个有意义增量验证；分批可用 Node 的 test-name-pattern 只运行当前增量适用用例，最后运行完整本轮测试，不弱化最终断言。

普通主菜单顺序固定：bid-generation、conversation、image-studio、template-settings、knowledge-base、bid-check，设置仍在 footer。开发者仅额外 developer-test，子项顺序固定 developer-json-test、developer-expansion-replace-test、developer-pi-agent-monitor、developer-system-diagnostics。知识库仍进现有二级页，生图仍走专用路由；不更名、不下沉、不加空卡片。

### 26.9 验证计划及证据深度

**自动化、编译与范围检查（以下尚未执行）：**

- client 内 `node --test scripts/feature-pruning.test.cjs`：TC01—04/07/09，真实执行菜单函数并检验精确 ID/中文名称/顺序、子项和 getSectionOrder/getAppMenuItemById/getParentMenuItemBySection；多次 true/false 切换前后不改变共享数组。补 TS AST/导入连接检查、独占 CSS/混合选择器检查；TC25/26/27 核对版本、保护目录、初始工作区与分支。历史统计/模板目录/测试文本按明确白名单分类。
- 每个有意义增量及最终 `npm.cmd run build`（实际脚本为 tsc --noEmit && vite build）；记录退出码/新增错误/既有 chunk 提示。Plan 不运行。
- 已确认存在：`npm.cmd run test:technical-plan-guards`、`npm.cmd run test:update`；直接运行 `node --test scripts/package-build-config.test.cjs`。
- 既有聚焦回归：`technicalPlanExport.test.cjs`、`technicalPlanSnapshotExport.test.cjs`、`exportStandaloneMarkdown.test.cjs`；授权组 `licenseService.test.cjs`、`lanManagementClient.test.cjs`、`licenseIpc.test.cjs`；统计组 `analyticsService.test.cjs`、`analyticsQueueStore.test.cjs`；对话/附件/提示词、知识库、扩写/生图根据 TC13—18 最小场景选现有对应测试。仅运行受控夹具，不运行自动读正式 Key 的 live-smoke。原生 Store 若 Node ABI 不符，用现有 Electron 运行时和隔离目录验证；不能删除测试或把 ABI 阻塞写成业务通过。
- 没有计划修改 Main/preload，因此不机械添加全 Main 语法扫描；新测试 harness/smoke 的 CJS 做 node --check，并执行真实 Electron 原生加载。若出现需改生产 Main/IPC 的发现，先记录进入 Change。
- 构建由现有 Vite 输出本轮新产物，保留/分类已有 dist，不执行 git clean 或清理工作区。核验生成 JS 依赖图/模块名称与 CSS 解析结果：没有四个删除页面的可执行模块、演示 helper 或资源/演示独占规则。不得仅对全部产物字符串作零命中断言。
- `git diff --check`、`git diff --stat`、文件级差异与未跟踪测试清点；不执行 git add。起止分支/HEAD 与本节对照，输入文档哈希不变，锁文件依赖和受保护目录无越界改动。

**Electron、网络、导出与数据（TC05—19/21/24/26）：**

1. 在系统临时目录建立唯一合成测试 userData；harness 先 app.setPath，再加载正常 bootstrap/Main/SQLite。只改 APPDATA 或追加 --user-data-dir 不作为已证明隔离。既有 v175 harness 可复用 seeding 思路，但其随后直接启动 "." 的测试方式不直接照搬。
2. 使用真实 Electron/preload/IPC 和保留入口完成普通六主菜单+设置、展开/折叠/高亮、开发者四页及开关回退；记录截图、console/network、配置持久化和窗口尺寸（至少普通宽窗及 1024×768），对照改前同夹具基线。Chrome DevTools MCP 工具可用，适合一次性界面核验；可重复多步覆盖使用已装 playwright-core，连接不可用时按实际原因记录。
3. 模板新建→保存→列表→编辑→返回、复读模板 Store；合成正文含中文标题/表格/图片，通过现有真实导出生成 DOCX，检查包内 document/styles/media 内容并实际打开文件。Word/WPS 不可用时“应用中打开”层标环境阻塞，不能以 ZIP 结构替代该层通过。
4. 技术方案/追加资料/事实/正文/导出、已有方案扩写、对话附件/提示词/导出、生图三页/受控作品、文档知识库引用、查重/废标/错别字/逻辑分支逐项最小合成回归。自动化 mock、真实 Electron/IPC、真实模型明确分层；没有对应场景就记未执行，不把文件未改当通过。
5. 对退役具体 `/resources` 和 `/resources?q=...` 记录请求，验证所有保留入口导航不产生资源页请求；不封域名、不屏蔽授权/公告/更新/模型请求。统计用本地受控接收方或现有夹具证明访问字段/队列/历史映射保留，禁止上传测试正文或伪造资源点击。
6. TC19 优先用本轮改前程序生成的隔离合成工作区，退出相关进程后取一致副本，再用改后程序打开并比较稳定字段/数量/内容哈希/引用关系。正式员工旧数据没有授权，不自动复制或试验；合成旧库不能冒充正式员工升级验收。无需改变 schema/migration；若数据异常停止并保全证据。
7. 登录页版本可用隔离启动的既有授权要求模式检查；开发业务导航按既有开发启动授权行为验证，不能新增生产授权绕过。包的授权/登录单列，不以开发 debug_disabled 的导航验证替代正式包授权。

**本地包（TC22/23/26）：**

- 源码/构建验证后才执行 `npm.cmd exec -- electron-builder --win nsis --publish never`，使用本地现有 builder，不修改 publish/build 模板，不读发布私钥或触发 Actions。
- 如已有同名验证资产，保留它们并在本轮独立输出目录生成；将实际输出路径和产物 SHA-256、app.asar 版本/文件/资源检查写入报告。目标 EXE 名字沿模板应对应 `Jato-AI-BID-1.8.4-win-x64.exe`，当前没有该次打包证据。
- 本基线正常启动没有显式 userData 测试隔离入口，不为包装测试新增生产开关。验证包的正常安装/启动/导航/模板导出使用独立 Windows 用户、Sandbox 或虚拟环境，不能在正式员工环境安装/启动试验。若本机无合格隔离环境或测试授权，包结构核验可执行，TC23 的实际启动/安装层记环境阻塞；不能用外置 harness 启动冒充正式包启动。
- 没有同环境/配置的前后安装包实测时，体积变化填未测；不作启动、内存或性能收益承诺。

### 26.10 风险、范围内修复和回滚

- CSS 在共享文件中混合：限定删除选择器/分支，保持其他声明和原顺序；解析、构建和保留页截图共同验证。
- 菜单去除隐藏过滤：验证剩余数组构造和 repeated calls，不引入 mutation；保留通用 notice/Toast/图标接口。
- 原生 ABI、文件占用、外部 Word/WPS、包装隔离/授权可能阻塞部分验证，目前只列风险，未执行前不判为实际失败。
- Verify/Review 发现本轮范围内问题时，写明问题分类和最小修复，返回 Build 再重验；既有问题/环境阻塞不靠删除测试或业务逻辑解决。需要新产品决策的删除、依赖、Main/IPC、布局/授权/更新变化先停受影响项进入 Change。
- 撤销只针对本轮独立文件 diff/新增测试，先与开始时用户修改比较；撤销本身需要用户明确授权，不执行 git reset/clean/stash。无数据库迁移和数据删除，无需设计数据库回滚；数据异常不删库。
- 始终禁止暂存/提交/推送/拉取/fetch/合并/变基/重置/清理/stash/分支创建切换重命名删除/tag/发布/部署和 npm version，复用已建分支。

### 26.11 后续报告与交付

- Verify：`docs/secondary-development/test-reports/v1.8.4-feature-pruning-test-report.md`，关联 AC01—14、TC01—27；包含时间、cwd、分支/HEAD/差异标识、工具版本、命令退出码、截图/日志/导出/包证据和覆盖深度。每用例用通过/失败/未执行/环境阻塞；失败另分本轮引入/既有/环境/暂未判定。
- Review：`docs/secondary-development/reviews/v1.8.4-feature-pruning-review.md`。到该阶段再读 review reference，并调用可用的 openjatobid_reviewer 独立只读审查；不可用就披露非独立上下文，不冒称调用。
- 交付分别给“代码实现”“测试完成”“可发布验收”三项结论，以及删改文件、保留残留理由、版本/分支/用户修改保护证据、未测/阻塞。当前只交付 Plan，三项均不预先判完成。

## 27. v1.8.4 Pi SDK 1.0.0 独立升级计划（2026-10-03）

本轮权威输入是 Pi 升级规格与配套指令。用户已授权计划后连续实施，无需重复确认。沿用项目 Skill 的 Plan → Build → Verify → 独立只读 Review；审查修复返回 Build。上一轮第 26 节及 FP 历史逐字保留。

### 27.1 基线与边界

实际分支 `v1.8.4-架构优化`，HEAD `23e05a543c8834045e76c045b61337c7f62ca16e`；tracked/staged 无差异，原有未跟踪文件仅两份本轮升级输入，保留原文。应用 1.8.4、Pi 两包 0.80.10；Windows x64，Node v26.1.0/npm 11.13.0、Electron 41.5.0。只发现根 AGENTS。开发说明的旧 OpenCode 描述属历史差异，按实际 Pi 调用保留接口，不恢复旧 runtime 或重写宪法。

保留精简八入口删除、C01/C02、runtime_id=pi、yibiao/default/openai-completions、本地 Proxy/独立队列、IPC、内存会话与业务存储/输出协议。禁止修改管理端、analytics、数据库、菜单/页面、写作 Prompt、授权或发布链路。基线备份/哈希/原状态位于忽略目录 `client/.tmp/pi184-upgrade/baseline/`，不含生产配置；原定向 21/21，原 audit 退出 1，逐项与升级后比较。

### 27.2 契约审计与文件计划

固定 v1.0.0 官方 SDK 文档及 npm 发布实物/shrinkwrap，不追踪 main。公开 ESM 导入、ModelRuntime.create/registerProvider/setRuntimeApiKey/getModel、SettingsManager.inMemory、SessionManager.inMemory、createAgentSession、defineTool/ToolDefinition 工厂均保留；安装后真实调用再核验。

| 当前行为 | 新版证据与决定 | 文件/验证 |
| --- | --- | --- |
| CJS 动态 import | 继续公开入口；真实 VERSION/支持的元数据，不硬编码；失败不永久缓存 | 工厂；T02/T05 |
| 内存模型与状态 | 继续原配置；实际思考读取 session.thinkingLevel | 工厂；T06 |
| noExtensions=false | 新 loader 文件发现与命名内联工厂独立；改 true，以哨兵/真实重试证明归一化扩展保留 | 工厂、自检；T07/T08/T13 |
| cacheWarming 默认 streaming | 显式 off；Pi 遥测 false、模型目录网络 false、trust never 保持；检查实际策略/计时器路径 | 工厂；T09/T30 |
| 两种工具集合 | 对话 read/find/ls，任务原 8 工具；真正执行中文/空格/越界/junction，禁止扩权 | 工厂默认保留，只修真实契约故障；T07/T14/T15 |
| prompt 与 agent_end | 原 runtime 已 await prompt 再校验，保持；验证自动恢复后唯一 task_end | runtime 默认保留；T11/T12/T21 |
| abort/dispose/finally | 新 abort 等待 idle，dispose 同步；清空目录前 await abort，避免迟到写入 | runtime 最小生命周期修补；T17-T22 |
| message_end 错误归一化 | 保留扩展，实测进入真实重试判断，命中差异再适配 | normalizer 默认保留；T13 |
| 自检 extensions 空断言 | 与命名内联扩展冲突，改精确白名单并验证实际版本/off；真实 read/bash/write/json 校验不放宽 | 自检与必要 runtime 断言；T23 |
| TypeBox/JSON/ask-user | 接受真实发布树，验证 schema 和 JSON details，不强 dedupe、不放宽 required | 原工具默认保留；T10/T19 |

允许 package.json 仅两依赖精确版本与必要 test/smoke 脚本、npm 生成 lockfile、工厂/runtime/自检最小适配及对应测试/client scripts。piEnvironment、归一化、JSON/提问工具、Agent/Proxy/对话业务默认只读，存在真实故障证据才按规格最小修复。不得升级 Electron/Vite/TypeScript 或工具体系；包内资源缺失仅按报错局部适配。

### 27.3 顺序、分层验证与阻断

PI184-01 基线 → 02 审计/计划 → 03 精确 install/npm ci/audit/树/engines → 04 最小适配 → 05 真实 SDK 离线 → 06 Electron/业务/Windows → 07 独立审查及范围内修复重验 → 08 交付。

L0：CJS/build、版本/树、npm ci 前后 lock 哈希、audit 前后。L1：原 Pi/Agent/对话测试、精简/守卫/更新回归。L2：真实 SDK + 项目工厂/实际 Proxy + loopback 模拟供应商，仅模拟最外层；Windows 合成路径/资源哨兵，精确工具/严格 JSON、分片参数、429/503/认证、取消/问答/压缩与至少 10 次释放。沿用 node:test/现有 Playwright，不新增框架；脚本必须超时、失败非零。

L3：业务服务/Store 加载前显式 app.setPath(userData, 本轮绝对隔离目录)，记录真实 Electron Node/ABI、工具 Node、自检与监视事件，复用精简 UI/IPC 合成项目/模板/Word，补对话历史。无 Chrome DevTools MCP 时披露并复用可重复 Playwright。L4：新独立输出 `client/release/v184-pi100-validation`，builder 明确 `--win nsis --publish never`；包内 SDK/资源工具加载、正常授权安装分别记录。无独立环境/有效授权则安装 BLOCKED。L5：无明确获准模型配置则 BLOCKED，不读取正式密钥/发收费请求。T01—T30 逐项记 PASS/FAIL/BLOCKED/NOT_RUN，不用 build 替代运行。

### 27.4 回退与交付

经用户另行批准后逐文件恢复本轮基线 package/lock 和实际适配文件、撤销本轮新增测试/脚本入口，再旧锁 npm ci/旧 Pi 定向验证/精简回归。保护后来用户修改；不得 reset 到精简前提交。无数据迁移，不删除/恢复业务数据。

交付 `docs/secondary-development/changes/v1.8.4-pi-1.0.0-upgrade-implementation.md`、`testing/v1.8.4-pi-1.0.0-upgrade-test-report.md`、`reviews/v1.8.4-pi-1.0.0-upgrade-review.md`，记录兼容矩阵、命令退出码、依赖差异、证据/风险/人工项。唯一状态源 tasks/todo.md；禁止任何 Git 写入、上传或发布。

### 27.5 范围内实施与审查修正

T14真实PNG暴露既有read操作遗漏，补公开MIME检测且复用realpath防护；无证据将其归因于新版引入。独立审查后主代理返回Build补强工具独有事实压缩证明、保留安全压缩失败诊断，并以运行中close改前失败/改后通过支持任务结算等待。修改文件仍限定三个Pi服务、清单/锁、测试及本轮文档；不改UI/IPC/数据库/业务控制层。

Chrome DevTools MCP实际可用，已检查隔离浏览器登录预览；多步真实Electron回归复用现有Playwright。Main及包内harness实际运行和正常授权解包/安装分开记录；监视器Renderer通用压缩标签不在本轮范围，报告保留限制。实际命令/偏差/依赖及回退依据均见指定三份报告，执行状态只在todo中维护。

### 27.6 用户授权续验（2026-10-03）

用户要求继续执行并更新证据，沿用 PI184-06，不扩大生产源码/依赖/授权范围。先核对隔离环境，再完成最新断言后的完整离线测试、正常 Main 的 before-quit/窗口关闭清理、精简基线合成项目/模板/对话附件副本兼容和 Word/WPS 实际打开/只读导出验证。每项分开记录技术证据与人工确认；不可用 VM/有效测试许可/获准真实模型配置的部分保持阻断。正式安装或模型测试不读取正式配置，不提高 Hyper-V 权限、不启用 Sandbox、不更改生产数据。证据放 client/.tmp/pi184-upgrade/continued-20261003，报告增量更新现有三份。

## 28. v1.8.4 PPT、管理端资源与两中心 UI 计划（2026-10-04）

本节只实施用户提供的 `docs/OpenJatoBID-v1.8.4-PPT-UI/OpenJatoBID-v1.8.4-PPT-Resource-Center-Spec-D1.2.md` 与 `UI-Handoff.md`，不新增相互冲突的产品规格。用户要求五步完整交付；任务切分是同一版技术依赖顺序，不是多期发布。旧第26/27节、FP/PI执行记录不覆盖、不当成本轮计划或UI确认。

### 28.1 基线、授权与确认点

真实分支 `v1.8.4-架构优化`、HEAD `6bad081ba9bc49158338c620297b9080cd02ce00`；原tracked/staged为空，原未跟踪只有46文件的用户UI输入包。客户端manifest/lock根均1.8.4、Pi两包精确1.0.0；管理端1.4.2。基线、真实代码/九图差异、复用清单及本轮少量公开样本审计见 `docs/secondary-development/design/v1.8.4-ppt-resource-center-baseline.md`；原文件hash和固定公开来源输入在忽略目录 `client/.tmp/ppt184-resource-center/baseline/`。

2026-10-04用户在本节计划交付后明确回复“确认”，本节技术计划及UI-Handoff/九图实施基线已获批准。当前进入Build，同版连续执行RC184-02至08，不逐任务重复等待确认。模型/新敏感动作仍按产品真实确认与获准配置执行；参考原型不作为软件验收。

始终保持版本、分支、精简成果、四开发者入口、普通侧栏、Jato控制层、runtime_id=pi、off、普通对话只读/原任务工具、Provider/Proxy/队列/IPC/统计/存储和输出约定。管理端资源周检查不修改其原六小时授权撤销清理。禁止所有用户列出的Git写入、发布/部署/PR/上传/R2/Worker/Secret/npm version。

### 28.2 文件范围与复用决定

以下新增路径是待实施文件归属，非已有能力声明；具体模块只随真实职责需要拆分，不建立第二套编辑器、状态模型或通知系统。

| 归属 | 现有文件 / 计划新增 | 最小变化及保留 |
| --- | --- | --- |
| 管理端资源Main | 新 `management/electron/services/resourceStore.cjs`、`resourceSourceAdapters.cjs`、`resourceDownloadService.cjs`、`resourceSyncService.cjs`、`resourceHttpRouter.cjs`；原 main/httpRouter/migrations | 来源、固定周计划、下载校验、快照/差异/审计、资源票据和分发；原授权/统计路由与托盘语义保持 |
| 管理端IPC/UI | 原 adminIpc/preload/shared/ipc/App/app.css；新 `electron/ipc/resourceIpc.cjs`、`src/features/resources/ResourceCenterPage.tsx` | 管理员来源启停、只读计划、立即检查、运行/发布/文件状态、独立网络/存储；使用现有表格/面板样式 |
| 客户端资源 | 新 `electron/services/resourceClientService.cjs`、`resourceCacheStore.cjs`、`resourceUpdateService.cjs` 与 `electron/ipc/resourceIpc.cjs`；原 sqliteDatabase/preload/ipc/index/main/IPC类型 | 独立可信LAN、已发布目录事务应用、票据/文件hash、本地asset、applied/shown与摘要；公共资源无外网回退 |
| 提示词迁移 | 原 imageStudioSources/imageStudioService/内置源配置/ImageStudioPrompts/Viewer/生图CSS；SQL阅读schema | 七源稳定ID/译文/收藏/个人/启停/tombstone保留；停止员工公网扫描和constructor改回旧公网；实际参考图版本缓存、contain和模态可达性 |
| PPT业务 | 新 `electron/services/pptProjectStore.cjs`、`pptService.cjs`、`pptTemplateService.cjs`、`pptRuntimeService.cjs`、`pptSkillService.cjs`、`pptExportService.cjs`、`electron/ipc/pptIpc.cjs`；现有task/file/AI服务只接必要入口 | 文件权威、稳定页/元素、revision/候选/锁、规划/确认/生成/局部/原生/重制/媒体、Skill、项目路径与恢复；不将业务塞IPC |
| PPT/Pi适配 | 原 agentService/piSessionFactory/piRuntimeService与agentToolEnvironment按真实缺口最小接入；新PPT限定工具/worker | 只给PPT profile批准Skill和脚本；不全局改noSkills/noExtensions/普通工具集合，不绕过原Proxy与统计 |
| PPT/更新UI | 新 `src/features/ppt/`、shared资源图片模态和 `app/ResourceUpdateDialog.tsx`、必要feature CSS；原App/menu/router/navigation/Sidebar | 图稿确认后PPT一个一级入口、三个页内视图、C07两个分区/真实图；原软件UpdateNotifier、旧对话布局、标书Word模板保持 |
| 统计映射 | 原 `analytics/dashboard/public/src/pages/traffic.js`、管理端中文页面映射及现有白名单 | 加稳定低基数PPT页面映射与必要公共资源计数；不修改Worker部署/原采集字段，不上传敏感文本/路径 |
| 运行包/测试 | 两端必要package/lock/build文件、client/vendor受管PPT runtime、固定Skill包及许可；各自已有node:test/scripts | 不全量升级依赖或运行环境；新增依赖仅路由实际需要、精确锁与许可证/包体审计。管理端版本不随客户端同步 |

资源协议、身份、状态、周锚点/发布、缓存/更新游标、IPC及权威文件草案见 `docs/secondary-development/api/v1.8.4-ppt-resource-center.md`，不在本节复制维护另一份合同。

### 28.3 同版可执行顺序与验收门

| ID | 对应用户步骤 / 规格 | 产物、依赖与验收 |
| --- | --- | --- |
| RC184-01 基线/计划 | 步骤一；D1.2 3、14.10、20 | 完整文档/实际CSS与代码/九图、复用和差异；固定来源样本、保护hash、API及本节计划。技术/UI确认是进入后续实现节点 |
| RC184-02 管理端周同步/协议 | 步骤二；6、15、T-W01—03、T-R01—10、T-N01/09 | 新SQLite迁移和备份；启用立即、604800000ms锚点、到期一次、手动不挪锚点、单在途、内容等价、不变不发、stage校验/不可变发布、失败旧快照、源范围/配额/代理、审计/只读计划、授权文件服务。定向时间/崩溃/HTTP/大下载并发测试后实际管理端验证 |
| RC184-03 提示词迁移/两中心摘要 | 步骤三/五；7、14.8、T-I01—04、T-N02—14 | 依赖02。七源和个人数据隔离迁移、所有重启/备用路径无公网；轻量数据原子应用，用户设备流游标、首次基线/去重/最终差异/安全延后/固定弹窗版本/原中心筛选。管理端离线真实缓存可用且不削弱授权规则 |
| RC184-04 模板/真实预览与两条路由 | 步骤三/四；8—10、14.9、T-TH01—04、T-V01—02、T-P01—07/10 | 依赖02。固定wuhua原包与free实际文件，全页结构/关系/原始比例/风险检测；真实首页/全页图片hash与生成版本。接ppt-master Native roundtrip对象映射替换、visual参考新SVG/原生DrawingML，两条路线各实际导出/渲染/目标环境证据；未验证只待验证，禁止截图叠字/全库放绿 |
| RC184-05 Skill/受控运行环境 | 步骤四/五；11—12、T-S01—05、T-B01/02 | 固定完整ppt-master与完整性guard/许可证；四入口解析/选择/确认安装、依赖/权限/启停/更新/锁版本/卸载；新GitHub仓库先定位申请/管理员准入/固定commit和子目录/完整候选/签名获取，不限于已有resourceId。Windows随包Node/Python/必要Git/媒体组件。先受限worker与取消/环境测试，再允许其批准工具；缺环境只阻断对应动作，不冒称已兼容Pi |
| RC184-06 PPT完整业务/存储 | 步骤四/五；9—13、15—17、T-P08—13、T-F01—03 | 依赖04/05。新项目资料解析复用、规划/有效确认、模板和风格、生成/原生编辑/美化/单页/局部/图表表格、人工/Agent写锁、稳定页顺序/备注/关系、历史恢复；预览/PPTX/PDF/图片/讲稿及启用的动画/语音/视频。三目录、真实系统卷/space、迁移与归属回收、崩溃恢复；以实际输出和文件hash验收 |
| RC184-07 真实UI/统一联调 | 步骤五；14/16.4与handoff；T-UI01、T-TH/T-N交互、T-B03 | 依赖已确认UI及02—06真实服务；两端组件/分辨率/内滚动/缩略图/大图焦点锁与恢复/错误重试；新增PPT入口和映射，C07不顶掉其他确认/离开保护。SVG/HTML/网页预览独立context、无Node/业务preload，CSP/请求阻断/静态内容规范化和受控编辑消息；恶意预览不触发脚本/外网/文件/越界写入。所有按钮连业务，没有示例图/假数字/假Agent成功 |
| RC184-08 Verify/Review/交付 | 步骤五；18的全部63用例、T-BR01、IM-08 | 各层证据、两端local builder --publish never、解包/正常授权/干净Windows安装分开；独立只读Reviewer。范围内缺陷返回Build修复再复测；报告/手册/迁移与只撤本轮方案，全部强制项未通过时不得宣布验收完成 |

当前已知source输入：wuhua完整封面7 shape/2文字/0 picture、free四页各满页1 picture/0文字；结论范围仅这两个源文件。free目录536 presentation/38 document/21 spreadsheet，不把595个条目全当演示文稿。完整主引擎有13,010文件/84,277,950已知字节，不用Codex安装路径替员工随包工具。RC04/05先检适配与运行依赖，必要的依赖/信任/权限变更写明再确认，不用失败来静默降级承诺。

### 28.4 固定实现规则

管理端每源 anchor、lastScheduledSlot、lastCheck、nextScheduled、当前run独立保存；手动/重试不移动anchor。窗口关入托盘不停计划，app退出取消/结算，重启或resume计算一次补查而非回放每周。语义hash排序稳定、忽略技术字段，实际图片/PPTX变化含文件hash；快照/差异/发布同批事务，只有文件已就绪才可读。无变化只检查审计，资源失败保留上版且不虚假下架。

客户端严格分离公共HTTPS和绑定LAN；资源只经许可管理端或已校验缓存，原自动刷新和cover/知识案例媒体中的公网回退逐项审计。应用/展示独立游标，固定范围差异而非累加日志；首次初始化、跨管理端和历史缺失不编造新增。已读/通知不意味着文件和AI复用完成。

PPT以路由权威文件为准，SQLite记流程/索引/hash/修订。每页/对象ID稳定，候选与baselineRevision校验、写锁、旧稿和无关页保留；图表工作簿/缓存一致，修改后旧检查报告失效。生成/视觉重制与原生roundtrip不混用权威数据。只公开当前条目实际验证状态，不全来源“一键验证”。

PPT限定profile通过Jato业务工具调批准脚本；worker不可继承Main全部环境/密钥，不给自由shell、外网或全盘读写。Windows受限token/AppContainer或等价真实隔离须证明文件/网络/进程限制，workdir不算沙箱。模型和联网资源通过Main原队列/Proxy/管理端代办。隔离/完整性/依赖未证明时该执行动作保留阻断，不把装上Skill当通过。

路径/删除基于realpath、实际系统卷和owned marker；默认目录改变只影响以后新项目。迁移先确认/停写/复制和hash/索引切换，失败保留旧目录；回收自己归属的项目/Skill副本，用户选父目录、源ZIP/文件、已有正式库和旧项目不碰。

### 28.5 分层验证、命令与证据

采用现有node:test、真实Electron与Chrome DevTools；可重复UI回归复用现有Playwright。下面是后续计划命令，不是本轮已通过记录：

- 两端新/改CJS分别 `node --check <实际文件>`；客户端 `npm.cmd run build`；管理端 `npm.cmd test`、`npm.cmd run build`；有新增依赖时两端各自 `npm.cmd audit`，不自动fix。
- 定向测试文件随实现落在各自已有服务测试目录。周锚点涵盖首次/手动/多个missed slot/clock rollback/并发/来源停启；内容发布涵盖等价字段/图片变更/单项失败/异常空/宕机和部分传输；目录游标涵盖所有T-N；安全来源和ZIP/PPT/Skill边界、真实原包及source变更缓存均有真实输入。
- 第四种Skill安装用此前未登记仓库，验证准入/固定commit/子目录/完整包/签名/确认/状态，禁止任意URL与员工直连；预览面以恶意SVG/HTML/foreignObject、脚本、file/javascript URL、外部图片/CSS、iframe/重定向、弹窗、伪造编辑消息/越界写入检查网络/文件/IPC副作用，不拿worker隔离结果替代显示面的隔离结果。
- 迁移用合成七源、收藏、中文译文、个人覆盖、禁用/删除记录；v40和管理端v4隔离副本前后核对并反复启动，不复制真实员工库或清空工作区。ABI记录Node/Electron区别，真实SQLite用对应Electron。
- 客户端service加载前设置绝对隔离 `app.setPath('userData', ...)`。管理端还须隔离 `getFixedManagementDataRoot()` 对应LOCALAPPDATA固定目录及legacy来源；只改APPDATA/userData不够。测试专用许可/签名/初始管理凭据不写正式配置，不绕过正常启动授权。
- 真实两端Electron/HTTP/IPC、管理端托盘/resume/exit、客户端断外网取目录+预览+原包、真实文件持久化、1600×1000及1366×900截图/键盘、焦点和关闭恢复；模拟IPC/UI截图只记模拟，不算真实业务联调。
- 真实SDK+模拟供应商离线证明工具/文件/取消；真实外部模型另记并需获准配置；自动重试不得重复扣费。PPT模型视觉/编辑能力缺失分别BLOCKED。原Pi测试/精简保留菜单/原标书/对话/生图/授权统计/公共更新按实际受影响范围回归。
- Office与WPS实际打开、可编辑对象/中文排版、备注/图表和导出逐样本记录；COM别名实际指向WPS时不得记Word/PowerPoint。结构CRC/hash通过不等于显示或复用通过。
- 客户端在build后使用 `npx.cmd electron-builder --win nsis --publish never --config.directories.output=release/v184-ppt-resource-validation`；管理端先检查现有build-win透传明确publish never再在独立输出构建。管理端缺私有初始凭据时只记包装BLOCKED，不造凭据或上传。正常解包、独立安装/升级、未装开发环境Windows、实际包体/缓存分开记录。

证据根 `client/.tmp/ppt184-resource-center/` 和管理端对应`.tmp`，原始日志/请求计数/快照/hash/截图/输出/包均可复核。最终测试报告 `docs/secondary-development/test-reports/v1.8.4-ppt-resource-center-test-report.md` 逐一覆盖D1.2第18节63用例，PASS/FAIL/BLOCKED/NOT_RUN分开，失败另标本轮/基线/环境/待定位；不是编译通过就可发布。

### 28.6 审查和交付

Plan的跨进程契约、迁移、权限和证据先独立只读检查；Build完成后另做完整Review，不能把计划审查当实现审查。按项目Skill使用openjatobid_reviewer；Review不改源码，主代理回Build修复范围内问题再Verify/复审。最终文件范围、新依赖、管理端职责及新增事件全部对照实际diff。

交付同版源码/必要锁差异、协议和迁移/使用说明、容量实际测量、实施记录 `docs/secondary-development/changes/v1.8.4-ppt-resource-center-implementation.md`、上述测试报告及 `reviews/v1.8.4-ppt-resource-center-review.md`。代码实施、自动/离线测试、真实模型、真实Office/WPS、真实Electron、解包、独立Windows安装、人工UI确认各自结论，未执行的不写通过。状态唯一在tasks/todo；不存在并行任务账本。

### 28.7 只撤本轮的保护与恢复

仅在另行授权后按开始时hash/原字节和实际diff撤本轮文件，保留6bad及之后用户提交、精简/Pi成果和输入46文件。既有文件采用局部恢复并核对后续用户编辑；新增文件仅本轮归属且无人后续使用才能移除。不git reset/clean/stash，不回退到历史SHA。

迁移前按现有路径备份库并校验，失败由拥有迁移的层恢复；代码撤销不直接降低schema。新PPT项目/输出/已导入Skill归用户，不随代码撤回删除；公共发布版本撤回产生新的版本/差异，不改已发布旧快照。保持客户端已有缓存/锁版本与旧目录，资源目录迁移失败恢复旧索引，不回退授权/统计库。回退后做旧业务/精简/Pi回归，生产数据仍不作为测试输入。


## 29. 同机授权核验与合入 main 后的 CI 修复（2026-10-05）

用户本轮已授权检查两端同机与客户端授权，并优化本地 CI；按已有 CI184 审查修复，直接执行范围内实施。实际分支 v1.8.4-架构优化、HEAD 6bad081ba9bc49158338c620297b9080cd02ce00，客户端1.8.4/Pi两个包1.0.0/管理端源码1.4.2保持；保护原有全部修改，只追加任务文档。

文件范围：.github/workflows/release.yml、新验证workflow及工作流回归测试；客户端固定PPT样本准备/样本测试输入、新同机Electron授权烟测与必要测试命令；现有UI烟测只参数化前置路径；管理端运维文档和本轮实施/测试/审查记录。没有授权协议、业务存储、正式凭据或产品UI改造。

实施：1）静态核验appId/独立userData与管理固定LOCALAPPDATA目录、端口及回环地址；两真实Main/preload/Renderer在隔离目录通过管理员初始登录/改密、员工申请、审批、签名授权登录，保留截图与状态，不写正式数据。2）新增main push/PR及手动触发的只验证workflow，contents read、无生产Secret/发布/产物上传，分别npm ci、离线Pi/PPT/授权回归与两端build；发布仍手动。3）现有release各构建模式打包前prepare/verify固定PPT运行包；管理端仅为准备器安装client工具依赖（npm ci --ignore-scripts，避免改native），两个job独立，不用客户端job产物。4）公开测试PPT来源固定commit/hash，明示失败，不用本机.tmp；UI验收前置目录显式输入，未提供就报缺项。5）回归发布门禁、样本/离线SDK、管理端测试/两端build与隔离真实Electron授权，独立只读复审；GitHub真实runner/独立安装仍待用户执行。

合入方式：用户自行推送分支并合入main，普通CI只验证；正式客户端tag必须包含最终实现/workflow，选择同SHA的workflow ref，继续原精确确认/构建证明/私有资源门禁。管理端ref选已合入main的同一版本源码，发布版本选未占用的独立版本；不自动修改源码版本或覆盖同版本发布。不得降低SHA/可信历史/许可/来源/收费模型授权门禁。

验收：从不含先前.tmp证据的新夹具目录准备并核验真实样本，定向测试与YAML/发布回归退出0；运行包准备步骤存在且位于builder前、resume不重建；同机授权真实Electron active，两个数据根不同；证据区分本地测试、GitHub runner、解包与安装。未运行不写通过；不提交/合并/推送/fetch/tag/发布/部署，不启用线上workflow或改Secret。

### 29.1 PR #31 验证失败修复（2026-10-05）

用户已授权检查并修正验证合并错误。新基线为现有分支 v1.8.4-架构优化 / cbe437e0a4e5889a5d42ee3e19a79fb1596c1993，工作区干净。真实 run 37253320878 的管理端82项和构建通过，客户端 Pi 28/29，coordinator加载Electron失败；runner为Node26.10.0/npm11.19.1。隔离完整安装日志证明Electron postinstall确实运行，但退出0时path.txt和可执行文件仍缺失。不能把allowScripts审核警告当成脚本被阻止；未生效的白名单候选已撤掉。

范围仅verify/release客户端步骤排序、既有CI回归、任务和现有报告追加。不改变package、依赖/锁文件、应用/Pi版本、授权/业务/工具权限或发布门禁。先记录失败与顺序回归红灯，再在隔离源码副本用runner同版本Node/npm重现；复用已有ensure-electron-binary.cjs，以固定版本/checksum下载并用PowerShell解包后校验可执行文件。PR验证在npm ci后调用，发布客户端把原有同一步移到npm ci后，均早于SDK测试，只执行一次。上游JS解包为何提前结束与本项目缺少安装完成门禁分开记录，不无证据宣称已修复上游。

验收使用隔离副本全新npm ci后原失败用例红灯，再执行独立二进制准备、原失败用例、完整test:ci-upgrade、Electron native/Pi/资源及客户端build，并执行完整发布回归。代码不进入正式数据目录；不修改全局Node/npm，不推送/合并/重新触发远端run或发布。线上修复效果等待用户推送后的新PR验证；原失败及后续步骤skipped均如实保留。
## 30. v1.8.4-OPT 同版优化（2026-10-05，当前用户授权连续实施）

权威输入为 docs/OpenJatoBID-v1.8.4-OPT 中 OPT-D1 规格、UI-Handoff、状态矩阵、114验收用例及 Codex-Run 十步；用户最后确认的单页/整套同页 Agent 流程优先。当前分支 v1.8.4-OPT / f866acc1d0be33ecbe73f5831bed21771389eaed。保护107个既有暂存交接文件；新源码、测试和报告只留工作区。版本、固定依赖、授权/统计、发布流程均不动。目录差异先采用现有目录、不移动原包。

执行切片：OPT-01基线及输入完整性；OPT-02需求/源码/UI/用例追踪、实际失败诊断与锁定ppt-master能力审计；OPT-03管理资源事务批量选择+SQLite持久FIFO（来源1、文件最多2）、requestId去重、取消及重启恢复；OPT-04稳定业务发布/独立统计/员工更新记录去版本化；OPT-05局部统一资源卡片、轻量首页和按需审计/只读周计划；OPT-06首页直接进入Agent、首次落盘位置确认、持久多轮消息/草稿/附件/选择及同工作区会话；OPT-07真实问答控制通道与阶段1/2指纹门禁、三方案选择、单页严格一页，保留原PPT写入保护；OPT-08保留既有编辑/导出/历史/存储并补齐必要状态；OPT-09静态/单元、Renderer/IPC、真实SDK离线、Electron、Windows/成品分层验证与截图对照；OPT-10只读独立审查，回Build修复再验证，交付实际报告。

文件范围：management的resourceStore/resourceSyncService/resourceCenterService、migrations、resourceIpc/preload/shared IPC、ResourceCenterPage及作用域app.css；client的ResourceUpdateDialog、PptPage和最小Agent组件、pptProjectStore/pptService、ppt IPC/preload/types及feature-ppt.css；必要schema阅读文件与隔离回归脚本。扩展既有Store，不另建Agent引擎或资源队列设施。事务仅写SQLite，网络在事务外；已确认任务与UI草稿完全分开。来源周锚点沿用，手动不移动，到期只补一次；取消保留镜像，不将旧复用计新增。asset业务对比按hash/角色/页面标准化，忽略随机标识与临时信息。

PPT持久消息/问题/门禁优先加入原项目Store。项目执行revision与需求fingerprint分开；确认绑定项目/会话/问题/阶段/技能模板hash/范围。等待回答保留写锁，答案经独立控制通道，不走assertIdle。流事件只内存展示，完整答复/阶段结果落盘。默认Generate Default，单页强制1页但保留两阶段；真实工具受原白名单/AppContainer保护，不开放shell、网络或自动安装。需新增权限/依赖的路线单独BLOCKED，继续其余项目。

验证按现有runner：管理npm test/build，客户端build/test:ci-upgrade及新回归；Main/preload node --check；复用真实Electron隔离SQLite/问答及实际固定工具；三个尺寸实际Renderer/真实Electron截图并量字号/溢出；安装/Office/真实模型按实际环境单列，禁止以mock通过代替。所有electron-builder显式--publish never。报告在交接包reports，状态仅tasks/todo；原设计证据不覆盖。

回退：需另行授权才按本轮实际diff局部撤销，保留f866既有精简/Pi/PPT/CI及用户资料，不reset/clean。新表可保留供旧代码忽略，不降schema或删用户项目；迁移事务失败完整回滚。测试使用独立库与目录；真实用户库不作为故障注入输入，原模板/稿件/历史不删除。


## 31. 两个提示词来源同步缺陷修复（2026-10-06，用户已授权 Debug 修复）

基线：v1.8.4-OPT / f866acc1d0be33ecbe73f5831bed21771389eaed；现有暂存/未暂存修改按 .tmp/resource-sync-fix-20261006/preflight.json 与原字节保护。诊断报告输入位于 Windows Temp 的 jatobid-resource-diagnosis-5ebrbj1i/diagnosis.md；不回退精简/Pi/OPT成果，版本、依赖、协议和周锚点保持。

最小范围：management/electron/services/resourceDownloadService.cjs 的资源专用 Electron 请求适配及图片 Camo 地址解码、明确HTTP失败属性；main.cjs仅替换资源专用 fetch 注入；resourceSourceAdapters.cjs仅为诊断确认的来源加入精确S3/Bibi图像主机；既有测试补回归，必要隔离 Electron 探针、测试/审查报告和本节任务追加。保持同一 session 的系统/专用代理；手动返回3xx给既有循环，每跳执行HTTPS、精确主机、公共DNS校验，禁止自动跟随任意地址。Camo仅在图像代理返回403后尝试原图，代理与原图地址均须校验，有效代理保持原路径，不让员工客户端直连公网；55个Bibi原图主机仅授予Banana来源，已确认GitHub附件S3主机仅授予涉及的提示词来源，不批准泛S3或任意原图主机。

执行：先新增最小失败回归并记录红灯；实现共享根因；验证取消、拒绝越界重定向/Camo、真实PNG入库、ETag/Range与失败旧快照；真实Electron使用隔离userData与资源目录及合成/公开图片，不加载生产业务入口。真实上游复测优先原失败14项及70+7项，对404/403/网络失败保留诚实状态，不以跳过失败制造complete。用户未授权操作正式资源库或重启正在使用的管理端，本轮不触发正式同步。

检查：受影响CJS语法、管理端完整既有测试/build、真实Electron网络及隔离同步；Node147与当前Electron145原生SQLite不匹配时不重建用户在用node_modules，记录npm test原始环境失败，使用当前Electron Run-As-Node ABI145运行同一完整node:test集。独立只读Reviewer按Skill检查网络边界、当前差异及证据，范围内问题由主代理修复复验。测试报告与审查写入docs/secondary-development指定目录；仅tasks/todo.md记录执行状态。所有代码留本地未暂存，禁止Git写入、打包发布、生产数据、收费模型或权限扩大。
