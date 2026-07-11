# 第二阶段上线迁移说明

## 数据与授权切换

- 本阶段不迁移原 `analytics.agnet.top` 的历史统计、员工或授权数据；局域网管理端从首次启用之日起重新累计统计。
- 旧公网授权和旧离线激活文件不再作为有效授权来源。员工升级后需在启动页通过“授权申请”向局域网管理端重新申请当前设备。
- 客户端保留既有 `analytics_client_id`，仅用于同一安装实例的统计连续性；不会导入公网历史事件。
- 管理端 SQLite 数据、签名密钥和管理员密码摘要均保存在管理端自己的 Electron `userData` 目录，与用户端数据目录相互独立。

## 管理员认证切换

- PRD 0.5 删除旧 SMTP、固定恢复邮箱、邮件临时密码和忘记密码流程。
- 内置初始凭据通过被 Git 忽略的私有构建配置注入安装包；仓库和交付文档不保存明文密码。
- 新安装首次登录后必须修改为与初始密码不同的新密码，完成后再设置局域网监听地址。
- 从旧 SMTP 认证数据库升级时，只重置管理员为“初始凭据待接管”状态并删除旧 SMTP/临时密码数据；员工、设备、授权、统计和签名身份继续保留。
- 负责人完成首次改密后，后续启动或升级不得再次使用安装包初始凭据覆盖当前密码。
- 管理端不提供自助找回。升级和改密前必须备份完整 `userData`，并由负责人保管当前密码。

## 网络边界

客户端授权与运维埋点仅使用登录页保存的局域网管理端地址：

- `GET /api/v1/health`
- `POST /api/v1/authorization/applications`
- `GET /api/v1/authorization/applications/:id`
- `POST /api/v1/authorization/login`
- `POST /api/v1/authorization/verify`
- `POST /api/v1/analytics/events`

2026-07-10 静态扫描结果：`client/src` 与 `client/electron` 中不存在 `analytics.agnet.top/track`、`analytics.agnet.top/license/*`、`license/activate`、`activateOffline` 或 `importOfflineLicense` 调用。

以下非授权、非埋点公共内容能力按 PRD 明确保留：

- 公告：`https://analytics.agnet.top/notice`
- 资源列表：`https://analytics.agnet.top/resources`
- 软件更新：GitHub Release API 与 GitHub Release 下载页

## 上线步骤

1. 在 Windows 局域网服务器安装并启动“Jato AI BID 管理端”。
2. 使用私下交付的内置凭据登录，完成首次强制改密和监听地址设置。
3. 在服务器防火墙中放行实际配置的 TCP 端口（默认 `47821`）。
4. 员工升级用户端后，从启动页提交姓名、手机号、服务器 IP 和当前设备申请。
5. 管理员批准后，员工返回启动页输入姓名和手机号登录。
6. 上线当天确认管理端收到 `app_open`、页面、AI 与 Agent 事件；不执行任何历史数据导入。

## 回退边界

管理端数据库与签名密钥是本阶段授权的权威数据。回退用户端版本不会把局域网授权自动转换回旧公网授权；若确需回退，应先停止发布并备份整个管理端 `userData` 目录，不要删除或重新生成签名密钥。
