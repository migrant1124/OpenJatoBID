# ADR-0004：结构化响应写入保护

## 状态

accepted

## 日期

2026-07-15

## 决策人或责任域

内容生成与导出

## 背景

结构化响应直接写入业务状态时，部分响应会破坏既有文档和导出数据。

## 决策

保留现有格式校验、写入保护和回归测试，新增能力不得绕过它们。

## 不变量

- 只在完整、有效响应后落盘。
- 正文与导出继续以 `outlineData.outline[*].content` 为权威来源。

## 备选方案

- 直接接受模型自由文本：不可验证，不采用。

## 正面影响

- 保持既有文档数据完整性。

## 负面影响

- 需要维护格式兼容测试。

## 安全与隐私

不新增响应内容外传。

## 运维与回退

失败时保留已保存的有效版本，重新执行任务即可。

## 关联代码和测试

- [内容生成目录](../../client/src/features/content-generation)
- [现有格式回归报告](../secondary-development/test-reports/2026-07-15-format-driven-content-generation-regression-test-report.md)

## Supersedes / Superseded by

无
