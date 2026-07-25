# Cloudflare CI/CD 配置说明

本文只覆盖 OpenJatoBID 当前发布链路中的 Cloudflare 部分：现有 `bidupdat` Worker、私有 R2 更新制品、更新检查/授权下载代理，以及 Worker 自身的 Cloudflare Workers Builds。不要创建 Cloudflare Pages，不要使用 Cloudflare Containers，也不要把本地 Electron 应用业务后端迁移到 Cloudflare。

## 现有 Worker

在 Cloudflare 中文控制台中进入：

1. `计算(Workers)` -> `Workers 和 Pages`
2. 打开现有 Worker：`bidupdat`
3. 进入 `设置` -> `构建`
4. 选择 `连接 GitHub`

构建字段按以下值配置：

| 字段 | 值 |
| --- | --- |
| 仓库 | `migrant1124/OpenJatoBID` |
| 根目录 | `analytics/worker` |
| Node 版本 | 读取仓库内 `.nvmrc`，内容为 `22` |
| 构建命令 | `npm test && npm run deploy:dry-run` |
| 部署命令 | `npm run deploy` |
| 非生产上传命令 | `npx wrangler versions upload --config wrangler.jsonc` |

`analytics/worker/wrangler.jsonc` 继续保留 Worker 名称 `bidupdat`，以及现有 R2、D1、KV、Analytics Engine 和 Cron bindings。不要把 `R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY` 或任何私钥写入 `wrangler.jsonc`。

## R2 发布权限

客户端正式发布由 GitHub Actions 的 Windows 自托管 Runner 构建，并通过 S3 API 直接写入私有 R2 bucket。

GitHub Secrets：

| 名称 | 用途 |
| --- | --- |
| `R2_ACCESS_KEY_ID` | R2 S3 API 对象读写访问密钥 ID |
| `R2_SECRET_ACCESS_KEY` | R2 S3 API 对象读写机密访问密钥 |

GitHub Variables：

| 名称 | 用途 |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare Account ID，用于拼出 `https://<account-id>.r2.cloudflarestorage.com` |
| `UPDATE_WORKER_BASE_URL` | 客户端更新 Worker 根地址，例如 `https://bidupdat.<account>.workers.dev` 或已绑定域名 |

R2 API Token 或 S3 凭证必须限制到 bucket `jatoaibid`，权限为对象读写。正式发布脚本固定只写入：

- `release/<version>/Jato-AI-BID-<version>-win-x64.exe`
- `release/<version>/manifest.json`
- `release/latest.json`

## 正式发布审核

正式发布仍在 GitHub Actions 手动执行：

1. 先由维护者人工审核 release notes，不允许包含禁用词、竞品名、API Key、Bearer Token、私钥片段、本地路径或内部调试地址。
2. 运行 `.github/workflows/release.yml` 的 `workflow_dispatch`。
3. `tag_name` 输入稳定版本 tag，例如 `v1.3.2`。
4. `confirm_release` 必须精确输入 `PUBLISH v1.3.2`。
5. 工作流会先创建 GitHub Draft Release，再发布 R2 版本目录，提升 `latest.json`，通过 Worker 完整下载 EXE 验证后才公开 GitHub Release。

如果 Worker 验证或 GitHub Release 正式化失败，workflow 会用 `.release-state/previous-latest.json` 回滚 R2 `release/latest.json`。成功后才清理多余旧版本，只保留当前版本和发布前稳定版本。

## 禁止事项

- 不创建 Cloudflare Pages 项目。
- 不使用 Cloudflare Containers。
- 不把 OpenJatoBID 客户端业务后端迁移到 Cloudflare。
- 不把 R2 S3 凭证、Cloudflare API Token、许可证私钥或构建证明私钥写入仓库。
- 不绕过 SHA-256、文件大小、构建证明、R2 回读、Worker 完整下载、Draft Release 和 latest 回滚验证。
