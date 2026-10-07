function specification(pages) {
  return `<!-- ppt-master-schema: design-spec/v1 -->
# 隔离资料汇报 - Design Spec
## I. Project Information
| Item | Value |
| --- | --- |
| Page Count | ${pages.length} |
| Primary Language | zh-CN |
| Target Audience | 测试人员 |
| Communication Intent | 核对合成资料原文 |
| Desired Audience Outcome | 确认工具链与导出 |
| Core Message / Ask / Action | 所有内容仅用于隔离测试 |
| Delivery Context | 内部屏幕审阅 |
| Artifact Afterlife | 回归证据 |
| Reading Mode | balanced |
| Design Spec Depth | complete |
| Speaker Notes | enabled |
| Custom Animations | disabled |
| Narration Audio | disabled |
## II. Canvas Specification
1280 × 720，viewBox 0 0 1280 720。
## III. Visual Theme
### Theme Style
白底蓝色标题，合成资料核验。
## IV. Typography System
标题和正文均为 Microsoft YaHei，分别 40 px 与 24 px。
## V. Layout Principles
同一边距，标题与正文纵向分隔。
## VI. Icon Usage Specification
不使用图标。
## VIII. Image Resource List
不使用图片。
## IX. Content Outline
${pages.map((page, index) => `#### Slide ${String(index + 1).padStart(2, '0')} - ${page.title}\n- **Audience move**: 从原文到可核对的页面。\n- **Relationships**: none\n- **Title**: ${page.title}\n- **Content**: ${page.content}`).join('\n')}
## X. Speaker Notes Requirements
- **Generation**: enabled
- **Filename**: 与页面 SVG 同名。
- **Content**: 仅重述本页合成资料。
`;
}
function lock(pages) { return `<!-- ppt-master-schema: spec-lock/v1 -->
# Execution Lock
## canvas
- viewBox: 0 0 1280 720
- format: ppt169
## communication
- primary_language: zh-CN
- audience: 测试人员
- objective: 核对合成资料
- core_message: 测试不含真实业务
- consumption_mode: balanced
## mode
- mode: briefing
## visual_style
- visual_style: swiss-minimal
## colors
- bg: #FFFFFF
- primary: #1677FF
- secondary: #555555
- accent: #AA3333
- muted: #888888
- text: #333333
## typography
- font_family: Microsoft YaHei
- body: 24
- title: 40
## icons
- library: none
- inventory: none
## page_rhythm
${pages.map((_, index) => `- P${String(index + 1).padStart(2, '0')}: anchor`).join('\n')}
## pptx_structure
- mode: flat
## forbidden
- 禁止脚本、外部样式和外部网络。
`; }
function pageSvg(page) { return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720" font-family="Microsoft YaHei"><rect id="背景" x="0" y="0" width="1280" height="720" fill="#FFFFFF"/><text id="标题" x="80" y="120" font-size="40" fill="#1677FF">${page.title}</text><text id="正文" x="80" y="260" font-size="24" fill="#333333">${page.content}</text></svg>`; }

module.exports = { specification, lock, pageSvg };
