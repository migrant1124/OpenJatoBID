# 埋点统计部署手册

本目录维护 `Cloudflare Workers + Analytics Engine + D1 + Cron Triggers` 埋点统计服务。公开仓库不保存 `ACCOUNT_ID`、`ADMIN_TOKEN`、`ANALYTICS_API_TOKEN` 等密钥。

## 地址

| 项目        | 地址                                   |
| --------- | ------------------------------------ |
| API       | `https://analytics.agnet.top`        |
| Dashboard | `https://static.analytics.agnet.top` |

## 数据源

| 数据源                                | Binding           | 用途                              |
| ---------------------------------- | ----------------- | ------------------------------- |
| Analytics Engine `jatobid_analytics` | `ANALYTICS`       | 详细事件、今天/7天/30天查询、最近事件、Cron 汇总来源 |
| D1 `jatoaibid-analytics`            | `ANALYTICS_DB`    | 新版 `stats_*` 长期统计表              |
| D1 `jatoaibid-resources`            | `RESOURCE_DB`     | 资源管理元数据                         |
| R2 `jatoaibid`                      | `RELEASE_BUCKET`  | 私有客户端更新制品                       |
| R2 `jatoaibid`                      | `RESOURCE_BUCKET` | 资源图片                            |
| KV                                  | `NOTICE_STORE`    | 公告、授权配置和 GitHub stats 缓存        |

这些生产资源由 Cloudflare 后台人工维护；普通 Worker 部署不会创建、删除或迁移它们。

## 接口

| 接口                               | 数据源                     | 鉴权                      | 用途                                                                                                  |
| -------------------------------- | ----------------------- | ----------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /health`                    | Worker                  | 无                       | 健康检查                                                                                                |
| `POST /track`                    | AE + D1                 | 无                       | 写 AE；从 Cloudflare 真实客户端 IP 请求头记录客户端 IP；新客户端按 `client_created_at` 窗口实时入库，授权字段按快照覆盖既有 `stats_clients` |
| `GET /api/projects`              | D1 优先，AE 兜底             | `ADMIN_TOKEN`           | 项目列表                                                                                                |
| `GET /api/overview`              | D1 + AE + KV            | `ADMIN_TOKEN`           | 概览总数、新增、今日活跃、每日统计                                                                                   |
| `GET /api/clients`               | D1                      | `ADMIN_TOKEN`           | 客户端统计列表                                                                                             |
| `GET /api/client-detail`         | AE                      | `ADMIN_TOKEN`           | 单客户端 7天/30天/全部事件明细                                                                                  |
| `GET /api/ip-stats`              | D1                      | `ADMIN_TOKEN`           | 按最后访问 IP 汇总客户端数，分页返回                                                                                |
| `GET /api/traffic`               | D1 或 AE                 | `ADMIN_TOKEN`           | 访问分析，`range=history/today/7/30`                                                                     |
| `GET /api/config-usage`          | D1 或 AE                 | `ADMIN_TOKEN`           | 配置使用，`range=history/today/7/30`                                                                     |
| `GET /api/model-usage`           | D1 或 AE                 | `ADMIN_TOKEN`           | 模型使用，支持 `provider/endpointHost/model` 筛选                                                            |
| `GET /api/agent-runtime`         | D1 或 AE                 | `ADMIN_TOKEN`           | Agent 执行、重试和重试后成功率，`range=history/today/7/30`                                                       |
| `GET /api/latest`                | AE                      | `ADMIN_TOKEN`           | 最近事件，支持 `event` 筛选                                                                                  |
| `GET /api/retention`             | D1                      | `ADMIN_TOKEN`           | 留存概览，读取 Cron 生成的最新 30 天快照                                                                           |
| `GET /api/github-repo-stats`     | GitHub + KV             | `ADMIN_TOKEN`           | GitHub stats                                                                                        |
| `GET /notice`                    | KV                      | 无                       | 客户端公告                                                                                               |
| `GET/POST/DELETE /api/notice`    | KV                      | `ADMIN_TOKEN`           | 公告后台管理                                                                                              |
| `POST /license/activate`         | KV + Worker Secret      | 无                       | 客户端免费授权签发，返回带签名 license                                                                             |
| `GET/POST /api/license-config`   | KV                      | `ADMIN_TOKEN`           | 授权配置后台管理                                                                                            |
| `GET /resources`                 | `RESOURCE_DB` + AE      | 无                       | 客户端资源列表，点击量为 D1 累计 + AE 今天                                                                          |
| `GET/POST/DELETE /api/resources` | `RESOURCE_DB` + R2 + AE | `ADMIN_TOKEN`           | 资源管理                                                                                                |
| `POST /updates/latest`           | 私有 R2 + 管理端授权公钥         | JSON Body 中的本地许可证       | 校验完整必要载荷、年度有效期、离线校验期限和签名后，返回 `release/latest.json` 和无许可证查询参数的下载 URL                                 |
| `GET /updates/download`          | 私有 R2 + 管理端授权公钥         | `X-Jato-License` Header | 执行同一完整许可证校验并校验 `release/<version>/` 规范 key 后流式返回安装包                                                 |

旧 `/api/summary` 已删除。

## 统计口径

| 模块              | 口径                                                                                                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 历史              | 读 D1，忽略 AE                                                                                                                                                                               |
| 今天/7天/30天       | 读 AE，忽略 D1                                                                                                                                                                               |
| 活跃客户端           | 任意允许事件去重 `client_id`                                                                                                                                                                     |
| 总客户端数           | D1 `stats_totals.total_clients`                                                                                                                                                          |
| 今日/7日新增         | D1 `stats_clients.first_seen_date`                                                                                                                                                       |
| 实时客户端入库         | `/track` 只对当前业务日期或前 1 天创建的客户端尝试实时插入并增加总客户端数；授权字段会按客户端授权快照覆盖既有 `stats_clients`；D1 写入失败不影响 `/track` 返回成功；老客户端活跃由 Cron 批量更新                                                                 |
| 最后访问 IP         | Worker 优先记录 `CF-Connecting-IP`；如果它是 Pseudo IPv4 的 `240.0.0.0/4` 伪地址，则改用 `CF-Connecting-IPv6`；完全忽略 `CF-Pseudo-IPv4`。AE 写入 `blob13`，D1 `stats_clients.last_access_ip` 由新客户端实时入库和每日 Cron 更新 |
| 每日统计            | 今天读 AE，前 9 天读 D1                                                                                                                                                                         |
| 最近事件            | 只读 AE，不入 D1                                                                                                                                                                              |
| 留存              | Cron 写入 `stats_client_activity` 和固定 30 天 `stats_retention`，页面只读 D1 最新快照，忽略当天数据                                                                                                           |
| 资源点击量           | `RESOURCE_DB.resources.click_count` 保存历史累计，页面查询时加上 AE 今天点击量                                                                                                                              |
| 版本客户端数          | D1 历史来自 `stats_clients.last_active_version` 当前分组重算；今天/7天/30天来自 AE 去重客户端数                                                                                                                 |
| 模型 Total Tokens | `ai_request` 的 `double4` 按 `_sample_interval` 聚合，历史写入 `stats_models.total_tokens`                                                                                                        |
| Agent 执行统计      | `agent_runtime` 的 `blob9` 单字段 v2 复合值聚合，包含最终状态、重试次数、文本模型服务商、endpoint host 和模型名；历史读 D1 按模型维度的汇总列，今天/7天/30天读 AE；旧版 Agent 历史不兼容                                                              |
| 配置使用            | 新版 `config_usage` 使用 `config_key/config_value` 键值对上报；D1 历史保留，AE 旧格式不再兼容                                                                                                                  |
| 授权状态            | 客户端上报 `license_status/license_plan/license_expires_at/source_trusted/untrusted_reason`；AE 写入 `blob14-blob18`，D1 `stats_clients` 保存最新状态                                                   |

## 事件类型

| event            | 用途                      |
| ---------------- | ----------------------- |
| `app_open`       | 打开次数、留存                 |
| `page_view`      | 页面访问                    |
| `config_usage`   | 配置使用                    |
| `ai_request`     | 模型使用、AI 请求、Token        |
| `resource_click` | 资源点击                    |
| `agent_runtime`  | Agent 执行成功率、重试次数、重试后成功率 |

`config_usage` 使用 `config_key/config_value` 键值对上报，每个配置项一条事件。Worker 从 Cloudflare 真实客户端 IP 请求头读取公网 IP 并写入 `blob13`，客户端不自报 IP；`CF-Pseudo-IPv4` 不参与统计。授权状态写入 `blob14-blob18`，只包含状态、授权类型、有效期日期和可信来源标记，不上传设备原始指纹。`ai_request` 只采集请求类型、服务商、endpoint host、模型名和 token 用量，不采集 API Key、Prompt、响应内容或错误详情。`agent_runtime` 只采集执行状态、重试次数、文本模型服务商、endpoint host 和模型名，编码到单个字段 `blob9=v2|<success|failed>|r<0-3>|<provider>|<host>|<model>`，不采集 API Key、任务内容、错误详情、Prompt、输出或本地路径。

更新 Bucket 通过 `RELEASE_BUCKET` Binding 固定绑定私有 `jatoaibid`。Worker 不需要也不接受 R2 写入密钥；客户端下载 URL 只包含对象 `key`，许可证不得放入 URL。许可证必要载荷与管理端签发结构保持一致，并同时检查 `expiresAt` 和 `offlineValidUntil`。客户端发布工作流使用 AWS CLI v2 的 S3-compatible API 写入 `release/<version>/`，`release/latest.json` 只在三个制品和 `manifest.json` 的大小与 SHA-256 验证通过后提升；GitHub Release 正式化失败会恢复旧值。

## 首次部署

### 1. Cloudflare 凭据

普通 Worker 构建和部署不需要基础设施管理凭据。仅在人工维护现有资源或执行独立迁移时，才在本机终端临时配置：

| 变量                      | 说明                                |
| ----------------------- | --------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | 仅人工维护时使用，按目标操作授予最小权限 |
| `CLOUDFLARE_ACCOUNT_ID` | 53d21f8ee647e4b1877d5147e1424636  |

这两个变量不是 Worker 运行时 Secret；不得写入仓库或用于普通 Worker 部署。

Worker 运行时还需要在 Cloudflare 后台配置 Secret：

| Secret                              | 说明                                             |
| ----------------------------------- | ---------------------------------------------- |
| `ACCOUNT_ID`                        | Cloudflare Account ID                          |
| `ADMIN_TOKEN`                       | Dashboard 管理 Token                             |
| `ANALYTICS_API_TOKEN`               | Analytics Engine SQL Read Token                |
| `GITHUB_API_TOKEN`                  | 可选，降低 GitHub API 限流概率                          |
| `LICENSE_PRIVATE_KEY_JWK`           | ECDSA P-256 私钥 JWK，用于签发客户端 license             |
| `LICENSE_KEY_ID`                    | 可选，授权签名 key id，默认 `official-build-key-2026-01` |
| `JATOBID_UPDATE_LICENSE_PUBLIC_KEY` | 局域网管理端授权公钥 PEM，用于校验客户端本地许可证后放行更新下载             |

不要在 `wrangler.jsonc` 增加 `secrets.required`。

授权密钥使用 ECDSA P-256 JWK，用于 Worker 签发旧版云端 license；构建证明密钥是独立用途，不复用该密钥。构建证明私钥配置在 GitHub Actions Secret `JATOBID_BUILD_ATTESTATION_PRIVATE_KEY_JWK`，Worker 更新下载授权使用局域网管理端公钥 `JATOBID_UPDATE_LICENSE_PUBLIC_KEY`：

```powershell
node -e "const { webcrypto } = require('node:crypto'); (async () => { const key = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign','verify']); console.log(JSON.stringify(await webcrypto.subtle.exportKey('jwk', key.privateKey))); })();"
```

公钥由客户端发布脚本从私钥 JWK 自动导出并打入安装包，不需要作为 Secret 保存。

### 2. 基础设施维护

`analytics/worker` 的普通 `npm run deploy` 只部署 Worker 代码和已有 Binding 配置，不调用 `analytics/scripts`，不创建 R2、D1、KV，也不执行数据库迁移。`setup-*.mjs` 与历史回填脚本仅限人工维护，必须由运维人员在确认目标资源和权限后单独执行。

数据库 migration 也必须由人工单独执行，且不能与普通 Worker 部署混用。完成备份并确认目标 Binding 后，在 `analytics/worker` 目录按编号执行：

```powershell
npx wrangler d1 migrations apply RESOURCE_DB --remote --config wrangler.jsonc
npx wrangler d1 execute ANALYTICS_DB --remote --file analytics-migrations/0001_create_stats_schema.sql --config wrangler.jsonc
npx wrangler d1 execute ANALYTICS_DB --remote --file analytics-migrations/0002_create_rollup_stages.sql --config wrangler.jsonc
npx wrangler d1 execute ANALYTICS_DB --remote --file analytics-migrations/0003_create_retention_tables.sql --config wrangler.jsonc
npx wrangler d1 execute ANALYTICS_DB --remote --file analytics-migrations/0004_create_agent_runtime_stats.sql --config wrangler.jsonc
```

这些命令会写入远端 D1；本轮未执行。

### 3. 部署 Worker

API Worker 配置：

| 项目             | 值                     |
| -------------- | --------------------- |
| Worker 名称      | `bidupdat`            |
| Git 仓库         | `migrant1124/OpenJatoBID` |
| 生产分支         | `main`                |
| Root directory | `analytics/worker`    |
| Build command  | `npm ci && npm test && npm run deploy:dry-run` |
| Deploy command | `npm run deploy`      |
| 非生产分支构建    | 关闭                    |
| Build watch paths | `analytics/worker/*` |

Dashboard Worker 配置：

| 项目             | 值                           |
| -------------- | --------------------------- |
| Worker 名称      | `agnet-analytics-dashboard` |
| Root directory | `analytics/dashboard`       |
| Build command  | `npm install`               |
| Deploy command | `npm run deploy`            |

## 验证

健康检查：

```powershell
Invoke-RestMethod -Uri "https://analytics.agnet.top/health"
```

上报测试：

```powershell
Invoke-RestMethod `
  -Uri "https://analytics.agnet.top/track" `
  -Method Post `
  -ContentType "application/json" `
  -Body '{"projectName":"yibiao-client","event":"app_open","version":"0.1.0","platform":"win32","arch":"x64","client_id":"test-client","client_created_at":"2026-06-13"}'
```

如果要验证 `/track` 实时写入 D1 客户端表，`client_created_at` 需要使用当前业务日期或前 1 天日期；否则只写 AE，客户端会由后续 Cron 汇总补入 D1。

查询概览：

```powershell
Invoke-RestMethod `
  -Uri "https://analytics.agnet.top/api/overview?projectName=yibiao-client" `
  -Method Get `
  -Headers @{ Authorization = "Bearer <ADMIN_TOKEN>" }
```

## 历史回填

新版历史回填脚本会按 Cron 同一套逻辑，把 Analytics Engine 中 `yibiao-client` 在脚本执行当天北京时间之前的所有历史日期汇总到 D1 `stats_*` 表；回填会补齐留存所需的 30 天 `app_open` 活动窗口并生成 `stats_retention` 快照；资源点击量会按历史总量写入 `jatoaibid-resources.resources.click_count`，不会按天重复累加。

本地执行前，在 `analytics/scripts/.env` 中配置：

| 变量                                     | 说明                                                    |
| -------------------------------------- | ----------------------------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID` 或 `ACCOUNT_ID` | Cloudflare Account ID                                 |
| `CLOUDFLARE_API_TOKEN`                 | 具备 D1 Query 权限的 Cloudflare API Token                  |
| `ANALYTICS_API_TOKEN`                  | Analytics Engine SQL Read Token                       |
| `ANALYTICS_DB_ID`                      | 可选；不填则按 D1 名称 `jatoaibid-analytics` 自动查找             |
| `RESOURCE_DB_ID`                       | 可选；不填则按 D1 名称 `jatoaibid-resources` 自动查找，用于回填资源累计点击量 |

执行回填：

```powershell
node analytics\scripts\backfill-analytics-stats.mjs
```

只补指定日期时使用 `BACKFILL_DATE` 环境变量：

```powershell
cd analytics\worker
$env:BACKFILL_DATE="2026-06-17"
node ..\scripts\backfill-analytics-stats.mjs
Remove-Item Env:\BACKFILL_DATE
```

如果只需要补齐新增的 `stats_versions.client_count` 和 `stats_models.total_tokens` 两个字段，执行：

```powershell
cd analytics\worker
node ..\scripts\backfill-analytics-stat-fields.mjs
```

注意事项：

| 项     | 说明                                                                                  |
| ----- | ----------------------------------------------------------------------------------- |
| 项目    | 固定回填 `yibiao-client`                                                                |
| 日期    | 默认自动发现 AE 中北京时间今天之前的所有有数据日期；设置 `BACKFILL_DATE=YYYY-MM-DD` 时只处理指定日期                  |
| 今天    | 脚本不回填今天，今天/7天/30天仍直接读 AE                                                            |
| 留存    | 回填会先补齐回填窗口前 30 天到最后回填日的 `stats_client_activity`，再生成对应 `stats_retention` 快照          |
| 重复保护  | `stats_rollup_runs.status = success` 的日期会跳过                                         |
| 异常状态  | 已存在 `running/failed` 且没有 `stats_daily` 时会清理状态并重试；如果已有 `stats_daily` 会停止，避免重复累加污染 D1 |
| 临时错误  | AE/D1 对 `429/500/502/503/504` 会自动重试，并打印 HTTP 状态、返回内容和 SQL 片段                        |
| 参数    | 脚本不接受命令行参数；指定单日使用环境变量 `BACKFILL_DATE`                                               |
| 补字段脚本 | 只补 `stats_versions.client_count` 和 `stats_models.total_tokens`，不回填资源点击量，不重跑每日统计     |

## 排查

| 问题                               | 处理                                                                                                                   |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `unauthorized`                   | 检查 Dashboard 输入的 `ADMIN_TOKEN`                                                                                       |
| `ANALYTICS_DB is not configured` | 检查 `wrangler.jsonc` 中的 `ANALYTICS_DB` Binding 与真实 D1 ID；不要通过普通 Worker 部署创建资源 |
| 查询为空                             | 先确认 `/track` 成功，再等待 AE 写入或第二天 Cron 汇总                                                                                |
| 历史总数为空                           | 新版 D1 刚重建时没有历史数据，需等待 Cron 或后续回填                                                                                      |
| 今日/7天/30天为空                      | 检查 `ACCOUNT_ID` 和 `ANALYTICS_API_TOKEN`                                                                              |
| 资源数据异常                           | 不要删除 `jatoaibid`、`RESOURCE_DB`、`RESOURCE_BUCKET`                                                          |

查看 Worker 日志：

```powershell
cd analytics\worker
npx wrangler tail bidupdat --config wrangler.jsonc --format pretty
```

## 自动部署触发规则

Cloudflare Workers Builds 仅在生产分支 `main` 推送时触发 `bidupdat` 构建；Root directory 为 `analytics/worker`，Build watch path 为 `analytics/worker/*`，非生产分支构建关闭。

| Worker      | 监听目录               |
| ----------- | ---------------------- |
| `bidupdat` | `analytics/worker/*` |

强制部署可临时设置：

```text
npm run deploy
```
