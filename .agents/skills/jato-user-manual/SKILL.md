# Jato User Manual

用于维护 Jato 客户端使用说明、版本日志和可选 Wiki 同步。默认执行 `dry-run`，只读取目标文档并输出 operations 与 plan hash。

支持：更新指定功能、更新完整使用说明、更新版本日志、全部更新、仅同步、仅检查。文档必须使用 Jato 品牌、LAN 授权、私有更新和结构化图表术语；版本以 `client/package.json` 与 Jato `v1.x.x` Tag 为准。

远端写入前必须先运行 `scripts/sync_manual.py --json --scope <scope>`，将返回的 `plan_hash` 与清单交给用户确认。只有相同 scope 与 `--expected-plan-hash` 匹配时才可使用 `--apply`。不得提交 `.env.local`、密钥或截图临时文件，也不得用生成式图像代替真实 Jato UI 截图。
