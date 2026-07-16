# 上游同步策略

本仓库跟踪上游能力，但 `origin` 中的 Jato 产品边界优先于上游实现。

1. 先运行 `node scripts/audit-upstream-diff.mjs --base main --head upstream-main`，审阅报告中的路径和能力候选。
2. 不执行全量 merge、批量 cherry-pick 或整文件覆盖受保护路径；采用能力时只做可审查的语义级修改。
3. 命中受保护路径、品牌、发布、授权、管理端或 Analytics 风险时，先更新 ADR/Manifest 并取得人工确认。
4. 审计工具和 CI 仅读取 Git 历史与工作区文件，不创建分支、提交或 PR。
5. 采用、Fork、拒绝或暂缓的能力都更新 [Manifest](upstream-sync-manifest.yml)，记录风险和本地文件。

该策略由 [ADR-0001](../adr/0001-upstream-sync-strategy.md) 和 [ADR-0002](../adr/0002-product-identity-and-protected-paths.md) 约束。
