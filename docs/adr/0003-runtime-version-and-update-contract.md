# ADR-0003：运行时版本与更新契约

## 状态

accepted

## 日期

2026-07-15

## 决策人或责任域

客户端运行时

## 背景

启动页、设置页和埋点使用固定版本会导致已安装应用显示错误版本。

## 决策

Renderer 统一经 preload 调用 Electron 运行时版本；读取失败显示“未知版本”，不伪造默认版本。

## 不变量

- 保留 `window.yibiao` 与 `window.yibiaoClient` 兼容桥。
- 新增 `window.jatoaibid` 别名。

## 备选方案

- 构建期常量：无法反映打包产物，故不采用。

## 正面影响

- 用户可见版本与应用实际版本一致。

## 负面影响

- 首次渲染需异步读取版本。

## 安全与隐私

只暴露版本字符串，不增加敏感 IPC。

## 运维与回退

桥保持兼容；读取失败可诊断但不阻断启动。

## 关联代码和测试

- [preload](../../client/electron/preload.cjs)
- [版本读取模块](../../client/src/shared/runtime/appVersion.ts)

## Supersedes / Superseded by

无
