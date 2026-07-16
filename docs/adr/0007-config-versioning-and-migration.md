# ADR-0007：配置版本与迁移

## 状态

accepted

## 日期

2026-07-15

## 决策人或责任域

客户端配置

## 背景

新增本地渲染并发设置时必须保留 LAN、模型和未知未来字段。

## 决策

配置升级到 `config_version: 2`；首次从旧版本迁移前创建一次 `.v1.backup`，未知顶层字段和 LAN 设置保留。

## 不变量

- Mermaid 与 HTML 默认并发均为 5，范围为 1–20。
- 迁移不删除 LAN 管理配置。

## 备选方案

- 重建整个配置：会丢失用户设置，不采用。

## 正面影响

- 老用户可以无感获得新组件设置。

## 负面影响

- 需要维护向后兼容归一化逻辑。

## 安全与隐私

备份保存在同一用户数据目录，不上传配置。

## 运维与回退

可通过 `.v1.backup` 恢复旧文件；升级异常由配置读取错误明确报告。

## 关联代码和测试

- [配置存储](../../client/electron/services/configStore.cjs)
- [配置测试](../../client/electron/services/configStore.lan.test.cjs)

## Supersedes / Superseded by

无
