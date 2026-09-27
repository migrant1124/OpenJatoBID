# v1.8.1 生图模式实施与分层证据（2026-09-27）

本轮在 `v1.8.1-PSDopt` 上接续 v1.8.0 R4；未切换、重置、提交、推送、合并、打标签或发布。所有 Electron 探针使用 `.tmp/v181-electron-userdata` 隔离数据目录。执行状态以 `tasks/todo.md` 为准。

客户端 `package.json` 与锁文件已对齐 1.8.1；本地 unpacked 包内版本和离线 SAM 推理均再次验证。

## 实施与证据

| 范围 | 实际改动 | 证据与边界 |
| --- | --- | --- |
| 创作页 A | 输入框 210px，三个提示词工具按钮 18px，删任务类型和画质，张数与当次画幅同排，画幅显示像素和比例；参考图、结果及示例图共用滚轮缩放预览。局部主图可滚轮缩放、中键拖移、适应窗口、原始尺寸。 | `electron-ui/create.png`、`result.json`、`viewer-wheel-result.json`、`local-zoom-result.json`；隔离 Electron 的 1440×900 页面。 |
| 提示词中心 B | 来源栏/内容区独立滚动；真实远程示例图缓存、失败重试、卡片/详情/大图展示；40 条分页显示当前页/总页/总数；参考收藏去重、取消收藏保留个人副本、来源更新不覆盖个人编辑；风格说明、幂等应用和撤销。 | `electron-ui/prompt-center.png`、`prompt-detail.png`、`viewer-wheel.png`；`result.json` 显示 40 条和 1/44 页、共 1750 条；聚焦测试覆盖收藏、分页、缓存与七天时钟。 |
| 参考图与更新 C | 删除旧固定“合同验证”拦截；受管原图字节通过 `aiService` 图像队列以 multipart edits 发送。默认来源后台七天检查、无确认弹框；保留用户改址、停用/删除、自定义来源及个人数据，中文化增量执行。 | `reference-real-result.json` 为真实中转 `gpt-image-2` 单参考任务 completed，输出 `reference-real-result.png`；传输测试断言请求包含原图字节。七天更新由可注入时钟测试验证，未等待七个自然日。 |
| 局部修改 D | 矩形、连续多笔画笔、离线 SAM 魔法套选；默认区域 1，主动添加后出现区域 2；区域编号与逐区域输入互相高亮。提交为原图与每区域独立标注图，Prompt 按图号对应修改要求；生成新作品版本，失败保留输入。 | `electron-ui/magic-selection.png`、`two-regions.png`、`multi-region-before-submit.png`；`live-edit-verified.json`：真实中转两区域完成，新作品指向原作品，37638 像素改变，区域外改变 0；输出 `live-edit-output.png`。 |
| SAM/PSD E | 本地 SlimSAM 生成对象像素遮罩和透明层；图层预览包含原图、背景、合成和单层透明视图，可重命名、隐藏、排序、删除、细修；原 PSD 写入器接收真实多图层。GPT Image 2.5 Sunburst 用于逐对象背景补全，结果偏离原图或未补洞时拒绝建立图层会话。 | `packaged-sam-result.json`：Windows `win-unpacked` 随包模型完全离线分割 1536×1024 图，选中 133527 像素；`layers-cat-transparent.png` 显示透明猫层。`live-layer-sample/layered-sample.psd` 可由 ag-psd 读取 1536×1024、12 层，但为质量门槛加入前的**结构样本，视觉不合格**；`layers-background.png` 显示整幅场景被重画。 |

## 背景补全实测结论

使用真实 1536×1024 猫/客厅图，先由 SAM 提取透明猫层，再以 GPT Image 2.5 Sunburst（另试过 Flare）做移除补全。中转均返回图像，但把家具和房间一起明显重画；Sunburst 输出见 `gpt-image-2.5-sunburst-cat-test.png`。`inpaint-quality-gate.json` 显示新质量门槛拒绝该真实返回，避免生成不可信的新 PSD。故“移除对象后形成连续、保留原场景的完整背景”仍未验收，不能将上述 12 层结构样本称为合格成品。

又用 1024×1024 猫周围局部裁剪做一次真实 Sunburst 调用；`crop-probe-result.json` 记录遮罩外平均通道差异约 56.9。`gpt-image-2.5-sunburst-crop-composite.png` 仅替换猫的遮罩像素后仍出现明显猫形状的沙发/地毯拼接边界，视觉验收失败。没有把这一探针接入生产链路。

## 验证分层

- **单元/模拟**：`node --test electron/services/imageStudio*.test.cjs` 21/21；覆盖图像字节传输、多区域映射、选区外像素守恒、PSD 多层、透明/补洞拒绝、收藏、分页、七天更新。变更 CJS 均通过 `node --check`。
- **构建与打包**：`npm.cmd run build` 通过；`electron-builder --win --dir --publish never` 通过，仅产生本地 unpacked 检查目录。随包 SAM 模型离线推理通过；Vite 忽略本地 ONNX 资源，避免 Windows 文件监视 EBUSY。
- **真实 Electron**：隔离 userData，SQLite v36→v37 迁移和字段保留通过；本目录 `electron-ui/` 为真实页面截图。局部图滚轮后可滚动，且中键拖移确实改变滚动位置；`local-zoom-result.json` 留痕。
- **真实中转**：单参考出图、两区域局部修改、SAM 驱动的 GPT Image 2.5 Sunburst 背景补全均发起真实调用。前两者成功；背景补全返回图像但质量不合格，由门槛拒绝。
- **PSD 文件**：结构样本 61,070,668 字节、12 层，透明猫层非空；背景视觉失败。当前机器未发现 Photoshop 安装，未做 Photoshop 实机打开验收。
- **全量测试**：`node --test` 321 项，293 通过、27 失败、1 跳过；原始输出 `full-tests.txt`。失败涉及技术方案、项目工作区和图片编排等测试；缺少本轮同环境改前基线，尚未归因，未据此宣称全量回归通过。`npm audit --omit=dev` 报 16 项生产依赖告警（3 中、13 高、0 严重），未做范围外依赖升级。

## 未完成与后续

1. **PSD 最终视觉验收未完成**：当前中转的 GPT Image 2.5 在遮罩编辑时明显改变遮罩外场景，无法证明“移除猫后补出原地毯并保持其余像素”。需要可稳定遵循 mask 的背景补全能力或更好的真实返回，并用至少猫/地毯及其他对象场景复测。现有质量门槛阻断明显坏图；它不是人工视觉验收的替代。
2. **Photoshop 实机未验**：当前主机未安装 Photoshop。待有该应用的环境中打开合格的多对象 PSD，检查图层、透明边缘、合成和保存回读。
3. **全量回归仍有 27 项失败**：本轮聚焦测试通过，失败清单详见 `full-tests.txt`；无同环境改前基线，未判定这些失败的引入时间。

## 审查

只读审查曾发现逐区域图像映射、图层会话定向、离线模型资源、背景质量门槛及局部图缩放问题；已修复并复测。复审补充发现根 `.gitignore` 忽略随包 `config.json`，已作精确例外。审查不以结构样本代替 Photoshop 或视觉质量验收。
