# 发布与自动更新工作流优化测试报告

## 1. 范围与结论

- 需求依据：`D:\download\OpenJatoBID_发布与自动更新工作流优化方案.md`
- 仓库基线：`main` / `517683f4dcb6c9c6f5d68df48110b28faf4020a8`
- 验证日期：2026-07-15
- 本地环境：Windows 10.0.26200、Node.js 26.1.0、npm 11.13.0；GitHub Actions 工作流固定 Node.js 22
- 结论：本地实现、聚焦回归、构建和 Windows 实物打包通过；首轮独立只读 Review 发现的 5 项 P1、2 项 P2 已补失败用例并修复，第二轮独立只读 Review 未发现新的 P0/P1/P2，Review 通过。真实 GitHub Draft Release、私有 R2、已部署 Worker 和 v1.3.1 客户端升级属于需要外部凭据与上线操作的验收项，本轮未执行，不能据此声明生产发布链路已上线通过。

## 2. 已验证行为

| 范围 | 证据 | 结果 |
| --- | --- | --- |
| 客户端更新完整性 | `cd client; npm run test:update` | 5/5 通过：EXE 优先、稳定版本比较、摘要规范化、缓存大小+SHA-256、下载失败清理。 |
| 客户端构建 | `cd client; npm run build` | 通过；仅保留既有 Vite chunk 体积警告。 |
| 客户端原生模块 | `cd client; npm run smoke:electron-native` | 通过；Electron 41.5.0 / modules 145，`better-sqlite3` 可加载并查询。 |
| 客户端 Windows 制品 | `electron-builder --win nsis zip --publish never`；`electron-builder --win msi --publish never` | EXE、MSI、ZIP 均按 `Jato-AI-BID-1.3.1-win-x64.*` 生成；MSI 单独重跑退出码 0。 |
| 打包内工具 | `verify-packaged-opencode-binary.cjs`、`verify-packaged-opencode-tools.cjs` | OpenCode、rg、fd、jq 均通过。 |
| 客户端清单 | `prepare-client-release.mjs` | 只暂存 EXE/MSI/ZIP/manifest.json，大小与 SHA-256 和实物一致。 |
| Worker 更新路由 | `cd analytics/worker; npm test` | 6/6 通过：完整必要载荷、年度和离线期限、DER ECDSA 严格验签、Header-only、URL 无许可证、非法 key 拒绝。 |
| 发布脚本与工作流 | 根目录 `node --test` 运行 7 个发布/Worker/管理端聚焦测试文件 | 26/26 通过：命名、manifest、稳定版本、R2 稳定版本对保留、latest 比较、Worker 全量下载、Draft/正式化/回滚顺序、标签 SHA、AWS CLI v2 和管理端 ref 信任门禁。 |
| 管理端测试与构建 | `cd management; npm test; npm run build` | 38/38 通过，构建通过。 |
| 管理端实物打包 | `cd management; npm run dist:win` | 退出码 0；Electron ABI 重建、打包内 `better-sqlite3` 验证和主机 ABI 恢复通过。 |
| 管理端 Artifact | `prepare-release-artifacts.cjs` | 只暂存 EXE、ZIP、SHA256SUMS.txt。 |
| 静态检查 | 所有修改的 CJS/ESM `node --check`；两份 workflow 用 `js-yaml` 解析；三个 package.json 用 JSON 解析；`git diff --check` | 全部通过；本机未安装 `actionlint`，未声称完成该项。 |

客户端本地制品：

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `Jato-AI-BID-1.3.1-win-x64.exe` | 216,689,778 | `dfd44452ac9d73911940b2beac68099cf658d2920d561130635a97f659cc6dd2` |
| `Jato-AI-BID-1.3.1-win-x64.msi` | 236,533,654 | `cfda624e7a49d324a5e598e11a0edcb1800727909b6b9228771af9871ef94c82` |
| `Jato-AI-BID-1.3.1-win-x64.zip` | 296,235,443 | `a785bc9375eb4df0f1c2bf8adfab93ae5e9efbdf55f1306e8e8520970e438a8d` |

管理端本地制品：

| 文件 | 大小 | SHA-256 |
| --- | ---: | --- |
| `Jato-AI-BID-Management-1.3.1-win-x64.exe` | 101,079,581 | `e1858bbfcf95b37f82db6eb77b43ada1faf88c9f53b909a0ff6883eed97f6138` |
| `Jato-AI-BID-Management-1.3.1-win-x64.zip` | 142,892,872 | `563e32796d334e4b0b5154c6dff98606a7d1b16b7eac4e3781243808a7322418` |

## 3. 异常与调查记录

第一次组合执行 NSIS/ZIP/MSI 时，外层命令在 304 秒达到工具超时，未返回退出码。调查发现 NSIS 和 ZIP 已完成，WiX `light.exe` 仍作为子进程继续链接 MSI；它在约 38 秒后退出并生成目标 MSI。随后只重跑 MSI，183.4 秒完成且退出码为 0。根因是组合命令的外层等待窗口小于本机三种制品总构建时间，不是代码或 WiX 构建失败。

首轮独立只读 Review 未通过，发现 AWS CLI v1/v2 参数不兼容、手动补发构建证明 SHA 来源错误、GitHub Release 正式化失败不回滚、Worker 许可证必要载荷不完整、管理端任意 ref 注入 Secret、紧急回退后的清理目标错误及 prerelease 比较不一致。修复后：工作流安装并验证 AWS CLI v2；构建证明显式使用已验证标签 SHA 并在工作流内比对；正式化位于回滚判定前且清理位于成功路径末尾；Worker 按管理端签发结构检查 13 个必要字段及 `expiresAt`/`offlineValidUntil`；管理端 ref 必须在注入 Secret 前证明可达 `origin/main`；清理保留新版本与发布前稳定版本；客户端正式发布只接受 `vX.Y.Z`。

首轮 Review 后没有重复执行耗时的 electron-builder 实物打包；修复未改变 electron-builder 目标和制品命名，客户端当前源码已重新通过 5 项更新测试和完整构建，管理端当前源码已重新通过 38 项测试和完整构建。实物制品表用于证明命名、三种客户端目标、管理端目标和打包内原生模块链路已在本轮运行过，不代表已执行正式发布。

第二轮独立只读 Review 逐项复核上述 5 项 P1、2 项 P2，未发现新的 P0/P1/P2，确认本地实现与证据范围内 Review 通过。真实 Actions/R2/Worker/升级链路仍按第 5 节保留为上线验收，不因代码 Review 通过而视为已上线。

## 4. 依赖审计

| 包 | 结果 |
| --- | --- |
| client | `npm audit` 返回 1：14 项（2 low、5 moderate、5 high、2 critical）；均为既有依赖报告，其中 `xlsx` 无可用修复。本轮未执行 `npm audit fix`，未改变依赖。 |
| management | `npm audit` 返回 0：0 项。 |
| analytics/worker | 未执行：该独立包没有 `package-lock.json`，`npm audit` 明确报 `ENOLOCK`；未为审计额外引入锁文件。 |

## 5. 上线前仍需完成

1. 在 GitHub 配置并复核 `JATOBID_BUILD_ATTESTATION_PRIVATE_KEY_JWK`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`JATOBID_UPDATE_TEST_LICENSE_JSON` 和管理端 `MANAGEMENT_INITIAL_ADMIN_CREDENTIAL_JSON`。
2. 先部署本轮 Worker，确认 `RELEASE_BUCKET` 仍绑定私有 `jatoaibid`，且 `JATOBID_UPDATE_LICENSE_PUBLIC_KEY` 与管理端签名公钥一致。
3. 按已确认方案先复制并校验 `release/1.3.1/`，在新版本成功前保留原平铺对象和旧 `release/latest.json`。
4. 用新标签运行 `Release Client`，核对 Draft、四文件白名单、R2 回读摘要、latest 提升、Worker 全量 EXE 下载和 Release 正式化。
5. 使用实际已安装的 v1.3.1 客户端完成 Header 下载与升级；安装新版后执行篡改一字节的 SHA-256 失败测试。
6. 手动运行一次 `Build Management`，下载 30 天 Artifact 并核对 `SHA256SUMS.txt`；覆盖安装前备份并验证 `management.sqlite3`、授权数据和签名公钥保持。

本轮未执行 `git pull/push/merge/rebase/reset`、提交、标签、GitHub Release、R2 写入、Worker 部署或管理端外部分发。
