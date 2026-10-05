# 两个 PPT 模板来源的复用评估

日期：2026-10-04。面向 OpenJatoBID v1.8.4／v1.8.4-架构优化。

## 结论

**wuhua2026/ppt-templates：适合作为原生模板复用来源，AI通过工具进行对象映射和内容替换。** 本次不是只看README；已取得并检查一个真实PPTX页内XML并做替换、保存重开与渲染。

**ai-ppt-template/free-ppt-template：按视觉参考候选纳入；原生直接改字/改图表尚不能确认，不纳入全库“已验证直接套用”。** 它可以为AI重新设计提供视觉输入，但这不等于修改原PPT对象。

## wuhua实际证据

源文件：`templates/static/cover/split_screen_ocean_blue.pptx`。来源blob SHA：`b0c385dc5780c7a126ca97c623eaaf9e600f088e`。

| 检查项 | 结果 |
|---|---|
| 实际取得内容 | 原PPTX压缩包内完整`ppt/slides/slide1.xml`成员；不是整个源压缩包 |
| 原始成员长度 | 4956字节，CRC-32验证通过 |
| 原生形状 | 7个 |
| 含非空文字的对象 | 2个 |
| 页面自身图片对象 | 0个 |
| 替换前 | 分屏封面；Split Screen Cover |
| 替换后 | 部门汇报；内部展示 · 内容替换测试 |
| 保存重开 | 新文本存在；形状数、ID及位置宽高保留 |
| 渲染 | 重封装前后测试文件均经LibreOffice转PDF并渲染检查 |

文件：`audit/wuhua-reuse-evidence.json`、`audit/wuhua-original-slide1.xml`、`audit/native_test.py`、两份`*page-repacked.pptx`及PDF/PNG。

### 不夸大的边界

实际做的是确定性工具替换，不是Jato Agent真实模型调用。由于未取得原包全部母版/主题，测试PPTX为干净容器重封装，不声称保留源整包。一个封面的成功不能证明全库图表、动画、复杂组合及Windows PowerPoint/WPS兼容性。替换不同长度内容仍需检查中文换行、溢出和数据映射。

## free来源证据与不确定性

该仓库README声明595套、6603页，GitHub只存目录，PPTX在`cdn.ppttemplate.ai`。作者一方面称可编辑，另一方面说整页视觉先经图像模型生成再包装为PPTX。这两句话不能证明对象结构。

本次尝试官方90s咨询模板和几何企业模板的CDN PPTX路径，但当前网络/下载工具未取得文件。未做该来源原生对象数量、替换、母版、图表或视觉保真检测。不将工具访问失败当作源文件损坏或全部是图片的证据。

目前采取的项目决策是将它放到视觉参考候选：使用实际预览/页面图提取配色和构图，用用户的新内容重新设计并生成可编辑稿。实际取得原生结构并通过试验的条目可单独升级为直接套用；在此之前不宣布全库可直接改字。

视觉参考与原样分层还原不是一回事，不能整页截图铺底叠字冒充原生还原。上游ppt-master的Codex专属Image to PPTX能力不能仅改宿主名称就成为Jato已验证能力。

## 来源

- https://github.com/wuhua2026/ppt-templates/blob/main/templates/static/cover/split_screen_ocean_blue.pptx
- https://github.com/wuhua2026/ppt-templates/blob/main/README.md
- https://github.com/ai-ppt-template/free-ppt-template/blob/main/README.md
- https://github.com/ai-ppt-template/free-ppt-template/blob/main/index.json
- https://github.com/hugohe3/ppt-master/blob/main/skills/ppt-master/workflows/profiles/image-to-pptx.md

## 一句话总结

将能真实替换对象的原生模板和仅供参考重设计的视觉模板分开，降低“能打开PPTX但无法正确换内容”的返工风险；实际节省时长尚未测量。
