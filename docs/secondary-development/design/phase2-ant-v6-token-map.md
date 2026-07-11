# Ant Design v6 到 OpenJatobid CSS 令牌映射

来源：

- PRD 指定的 Ant Design System v6 Community Figma 文件。
- Ant Design v6 官方 Customize Theme / Design Token 文档：`https://ant.design/docs/react/customize-theme/`。

实现策略：不安装 `antd`，不替换 Radix。将 Ant 的 Seed / Map / Alias Token 语义映射到现有 `--yb-*` CSS 变量，使现有组件逐步迁移且保持接口稳定。

## 核心映射

| Ant 语义 | `--yb-*` | 值 |
| --- | --- | --- |
| `colorPrimary` | `--yb-primary` | `#1677ff` |
| `colorPrimaryHover` | `--yb-primary-hover` | `#4096ff` |
| `colorPrimaryActive` | `--yb-primary-deep` | `#0958d9` |
| `colorPrimaryBg` | `--yb-primary-bg` | `#e6f4ff` |
| `colorPrimaryBorder` | `--yb-primary-border` | `#91caff` |
| `colorBgLayout` | `--yb-bg` | `#f5f5f5` |
| `colorBgContainer` | `--yb-surface` | `#ffffff` |
| `colorBgElevated` | `--yb-surface-elevated` | `#ffffff` |
| `colorBorder` | `--yb-border` | `#d9d9d9` |
| `colorBorderSecondary` | `--yb-border-soft` | `#f0f0f0` |
| `colorText` | `--yb-text` | `rgba(0,0,0,.88)` |
| `colorTextSecondary` | `--yb-text-soft` | `rgba(0,0,0,.65)` |
| `colorTextTertiary` | `--yb-text-muted` | `rgba(0,0,0,.45)` |
| `colorTextDisabled` | `--yb-text-disabled` | `rgba(0,0,0,.25)` |
| `colorSuccess` | `--yb-success` | `#52c41a` |
| `colorWarning` | `--yb-warning` | `#faad14` |
| `colorError` | `--yb-error` | `#ff4d4f` |

## 几何与密度

| Ant 语义 | 映射 |
| --- | --- |
| 4px 基础单位 | `--yb-space-1` 至 `--yb-space-10` |
| `borderRadius` 6 | `--yb-radius` |
| `borderRadiusSM` 4 | `--yb-radius-sm` |
| `borderRadiusLG` 8 | `--yb-radius-lg` |
| 大容器扩展 12 | `--yb-radius-xl` |
| `controlHeight` 32 | `--yb-control-height` |
| 小/大控件高度 24/40 | `--yb-control-height-sm` / `--yb-control-height-lg` |
| 基础字号 14 | `--yb-font-size` |

## 使用规则

1. 卡片默认 8px，大型面板最多 12px；除圆形状态和胶囊标签外不使用 `999px`。
2. 主按钮使用纯主色，hover/active 使用对应令牌，不使用紫蓝渐变。
3. 页面背景、容器、浮层分层依靠灰阶背景、1px 边框和轻阴影，不使用玻璃拟态和大面积彩色光晕。
4. 颜色必须使用语义令牌；功能页迁移时逐步清理原始颜色字面量。
5. 交互控件保留清晰的 hover、active、disabled 和 `:focus-visible` 状态。
6. 保留既有布局尺寸和内部滚动边界，令牌迁移不承担信息架构调整。
