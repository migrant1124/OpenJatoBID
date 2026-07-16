# ADR-0002：产品身份与受保护路径

## 状态

accepted

## 日期

2026-07-15

## 决策人或责任域

产品与仓库维护

## 背景

客户端、局域网管理端、Analytics 共同构成 Jato 产品身份和合规边界。

## 决策

在同步 Manifest 中登记受保护路径，并要求涉及这些路径的上游差异先由责任人评审。

## 不变量

- Jato 品牌、LAN 授权、管理端、Analytics 和导出合规不可被上游覆盖。

## 备选方案

- 仅靠人工记忆：不可审计，因此不采用。

## 正面影响

- 关键产品边界有机器可读的保护清单。

## 负面影响

- 清单需要随架构调整维护。

## 安全与隐私

授权与埋点能力保留原有最小数据边界。

## 运维与回退

更新清单前须同步本 ADR 或后续 ADR；误加条目可在文档提交中回退。

## 关联代码和测试

- [同步 Manifest](../secondary-development/upstream-sync-manifest.yml)
- [ADR-0001](0001-upstream-sync-strategy.md)

## Supersedes / Superseded by

无
