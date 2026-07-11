# 第二阶段 Ant Design v6 视觉回归记录

日期：2026-07-10；2026-07-11 补充方案 2 管理端认证回归  
测试方式：Vite Renderer + Playwright 独立浏览器会话；Electron API 使用无业务数据的本地桩，仅用于呈现固定 UI 状态。管理端授权页和统计页使用固定空态/统计样例。

## 令牌与组件覆盖

本阶段通过 `tokens.css` 和最后加载的 `ant-v6-overrides.css` 完成视觉覆盖，不改变组件接口、页面 DOM 顺序、主菜单、业务按钮位置或各页面 grid/flex 尺寸。

| 组件/页面 | 覆盖结果 |
| --- | --- |
| 主壳、侧栏、主/次级菜单 | 白色容器、Ant 主色选中态、灰阶分割线和轻量边框；286px/88px 侧栏尺寸不变 |
| 输入框、选择器、按钮、开关 | 统一 Ant 主色、6px 圆角、hover/focus/disabled 状态 |
| 卡片、面板、表格 | 8px 圆角、1px 次级边框、移除玻璃拟态与重阴影 |
| Dialog、Toast、Tooltip | Ant 浮层阴影、8px 圆角、`rgba(0,0,0,.45)` 遮罩和可见焦点态 |
| Markdown / Mermaid | 白色内容面、灰阶表格/引用块、等宽代码字体和紧凑边框 |
| 技术方案 Step01—04 | 页面结构、步骤、内部滚动和底部工具条不变；表面样式统一 |
| 查重、废标检查 | 上传区、筛查卡、结果面板和状态控件统一；状态仍有文字说明 |
| 知识库、模板、资源、设置、开发者页 | 移除超大圆角、紫蓝装饰渐变和彩色重阴影，沿用同一语义令牌 |
| 启动登录/授权申请 | Ant 表单与弹窗；1280×720 无水平或垂直溢出 |
| 独立管理端 | 与用户端相同主色/灰阶/圆角；授权管理和运维统计保持独立工程 |

## 固定视口证据

截图作为交付证据保存在 `docs/secondary-development/design/screenshots/`：

| 视口 | 页面 | 截图 |
| --- | --- | --- |
| 1280×720 | 用户端启动登录 | [`client-login-ant-1280x720.png`](screenshots/client-login-ant-1280x720.png) |
| 1280×720 | 用户端授权申请弹窗 | [`client-authorization-modal-1280x720.png`](screenshots/client-authorization-modal-1280x720.png) |
| 1440×900 | 用户端主菜单 | [`client-main-1440x900.png`](screenshots/client-main-1440x900.png) |
| 1440×900 | 用户端通用设置 | [`client-settings-ant-1440x900.png`](screenshots/client-settings-ant-1440x900.png) |
| 1440×900 | 文本模型配置 | [`client-text-model-1440x900.png`](screenshots/client-text-model-1440x900.png) |
| 1440×900 | 关于与隐私声明 | [`client-about-privacy-1440x900.png`](screenshots/client-about-privacy-1440x900.png) |
| 1440×900 | 技术方案 Step01 | [`client-technical-plan-1440x900.png`](screenshots/client-technical-plan-1440x900.png) |
| 1440×900 | 标书查重 Step01 | [`client-duplicate-check-ant-1440x900.png`](screenshots/client-duplicate-check-ant-1440x900.png) |
| 1920×1080 | 技术方案 Step01 | [`client-technical-plan-1920x1080.png`](screenshots/client-technical-plan-1920x1080.png) |
| 1440×900 | 管理端授权管理 | [`management-authorization-1440x900.png`](screenshots/management-authorization-1440x900.png) |
| 1440×900 | 管理端运维统计 | [`management-analytics-1440x900.png`](screenshots/management-analytics-1440x900.png) |
| 929×917 | 管理端账号密码登录 | [`management-admin-login.png`](screenshots/management-admin-login.png) |
| 929×917 | 首次改密后的局域网服务配置 | [`management-server-setup.png`](screenshots/management-server-setup.png) |
| 929×917 | 系统设置主动修改管理员密码 | [`management-system-settings.png`](screenshots/management-system-settings.png) |

## 尺寸、滚动与控制台

- 用户端登录页 1280×720：`scrollWidth = clientWidth = 1280`，`scrollHeight = clientHeight = 720`。
- 用户端技术方案页 1920×1080：`scrollWidth = clientWidth = 1920`，`scrollHeight = clientHeight = 1080`。
- 管理端 1440×900：`scrollWidth = clientWidth = 1440`，`scrollHeight = clientHeight = 900`。
- 管理端方案 2 认证链路：账号密码登录后，新密码与确认密码均为空；完成首次改密后进入局域网服务配置；进入管理端后可在系统设置验证当前密码并主动改密。
- 启动登录页独立会话：0 error，0 warning。
- 管理端授权/统计会话：0 error，0 warning。
- 管理端方案 2 认证与主动改密会话：0 error，0 warning。
- 浏览器检查发现 `MarkdownRenderer` 将 React `key` 放入 spread props 的告警；已改为显式 `key`，不改变渲染结果。

## Figma 读取限制

指定 Figma 节点在本次会话中仍返回“当前未选择图层”，无法取得该节点的像素截图。实现以 Ant Design v6 正式主题令牌和用户提供的设计系统方向为准；该限制已记录在视觉基线文档中。
