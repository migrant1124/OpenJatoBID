# Cloudflare Worker 部署边界重构测试报告

日期：2026-07-18

## 目标与边界

`analytics/worker` 现在是一个独立的 `bidupdat` Worker 项目。普通 `npm run deploy` 只执行配置验证和 `wrangler deploy --config wrangler.jsonc`；不调用 `analytics/scripts`，不创建或修改 R2、D1、KV，不执行 D1 migration。本报告期间未执行真实部署、远程迁移或任何 Cloudflare 资源写操作。

## 审计结果

### `env.<binding>` 使用点

| Binding / 运行时变量 | 使用位置 |
| --- | --- |
| `ADMIN_TOKEN` | `src/http.js` |
| `ACCOUNT_ID`、`ANALYTICS_API_TOKEN` | `services/analyticsQuery.js`、`routes/resources.js` |
| `ANALYTICS` | `services/analyticsTrack.js` |
| `ANALYTICS_DB` | `services/analyticsStatsStore.js`、`routes/projects.js` |
| `RESOURCE_DB` | `services/analyticsStatsStore.js`、`services/resourceStore.js`、`routes/resources.js` |
| `NOTICE_STORE` | `services/noticeStore.js`、`services/licenseStore.js`、`routes/notice.js`、`routes/githubRepoStats.js` |
| `RELEASE_BUCKET`、`R2_RELEASE_PREFIX` | `routes/updates.js` |
| `RESOURCE_BUCKET` | `routes/resources.js` |
| `GITHUB_API_TOKEN`、`GITHUB_TOKEN` | `routes/githubRepoStats.js` |
| `LICENSE_PRIVATE_KEY_JWK`、`LICENSE_PUBLIC_KEY_JWK`、`LICENSE_KEY_ID` 及兼容的 `YIBIAO_*` 名称 | `services/licenseCrypto.js`、`routes/license.js` |
| `JATOBID_UPDATE_LICENSE_PUBLIC_KEY`、`UPDATE_LICENSE_PUBLIC_KEY` | `routes/updates.js` |

`src/routes/health.js` 只以 `Boolean(...)` 检查五个资源 Binding，不返回任何 ID、token、secret、公钥或 bucket 内容。

### 原有基础设施副作用

- `setup-notice-kv.mjs`：创建 KV namespace 并写入 Worker 配置。
- `setup-resource-storage.mjs`：创建或复用 RESOURCE_DB D1、RESOURCE_BUCKET R2；原先还会执行 RESOURCE_DB migration。
- `setup-analytics-storage.mjs`：创建或复用 ANALYTICS_DB D1；原先还会写 Cron、执行 SQL migration、ALTER TABLE 与 CREATE INDEX。
- `backfill-analytics-*.mjs`：直接写入 D1，保留为人工回填工具。
- `deploy-if-changed.mjs`：原先在 Worker 部署前依次调用上述 setup 脚本；该调用链已删除。

`routes/resources.js` 的 R2 对象读写删除属于 Worker 业务运行时，不创建 bucket，未被普通部署触发。

### `deploy-if-changed.mjs` 调用者

- 改造前：`analytics/worker/package.json` 的 `deploy` 脚本（已删除）。
- 当前：`analytics/dashboard/package.json` 的 `deploy` 脚本仍使用该 helper；helper 已不再调用任何 setup 或 migration。
- 历史文档与配置验证的负面测试不属于可执行部署调用者。

## 最终 Binding 清单

| Binding | 类型 | 生产资源 |
| --- | --- | --- |
| `ANALYTICS` | Analytics Engine | `jatobid_analytics` |
| `NOTICE_STORE` | KV | `b844c8df3b1c486cbf0828bbd9070c41` |
| `ANALYTICS_DB` | D1 | `jatoaibid-analytics` / `a9575062-816e-41cb-aa03-33d79e2a30b1` |
| `RESOURCE_DB` | D1 | `jatoaibid-resources` / `2aa37ad4-07b8-43ba-b35a-8b5e15d855a6` |
| `RELEASE_BUCKET` | R2 | `jatoaibid` |
| `RESOURCE_BUCKET` | R2 | `jatoaibid` |

所有 ID 已由需求提供并已写入 `analytics/worker/wrangler.jsonc`；没有待填写的资源 ID。运行时 Secret 仍须在 Cloudflare 后台保留，不写入配置文件。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `npm install --package-lock-only --ignore-scripts` | 通过；lockfile 由 npm 重建 |
| `npm ci` | 通过；本机 Node 26 对 `>=22 <23` 给出 EBADENGINE 警告，目标 Cloudflare 构建应使用 Node 22 |
| `npm ls wrangler --all` | 通过；仅 `wrangler@4.111.0` |
| `npm test` | 通过，11/11：配置验证 3 项、health 2 项、已有 updates 6 项 |
| `npm run validate:config` | 通过 |
| `npm run deploy:dry-run` | 通过；仅生成部署预览，输出全部六个 Binding，未部署 |
| `node --check`（5 个基础设施/回填脚本） | 通过 |
| `git diff --check` | 通过 |

配置验证同时覆盖：Worker 名称和入口、禁止静态 assets 配置、所有 Binding、`RELEASE_BUCKET=jatoaibid`、禁止占位 ID、根目录不存在 `wrangler.jsonc`、以及 deploy 脚本不得调用外部 setup/helper。错误配置的 CLI 进程验证为非零退出码。

## Cloudflare 后台目标配置

| 项目 | 值 |
| --- | --- |
| Worker | `bidupdat` |
| Git 仓库 | `migrant1124/OpenJatoBID` |
| 生产分支 | `main` |
| Root directory | `analytics/worker` |
| Build command | `npm ci && npm test && npm run deploy:dry-run` |
| Deploy command | `npm run deploy` |
| 非生产分支构建 | 关闭 |
| Build watch paths | `analytics/worker/*` |
| `compatibility_date` | `2026-07-14` |
| `workers_dev` / `keep_vars` | `true` / `true` |
| Cron | `0 17 * * *`、`30 17 * * *`、`0 18 * * *`、`30 18 * * *`、`0 19 * * *` |

只读检查确认远端已有上述五个 Cron；远端当前 `compatibility_date` 仍为 `2026-07-18`，需在下一次获准的真实部署时才会与仓库配置同步。本轮未改变远端。

## 回滚

本轮没有远端变更，因此无需执行 Cloudflare 资源回滚。若需要回退本地实现，使用版本控制仅还原本报告列出的改动文件，再依次运行 `npm ci`、`npm test`、`npm run validate:config` 和 `npm run deploy:dry-run`；不要删除或重建现有 R2、D1、KV 资源。
