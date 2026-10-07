# 固定ppt-master兼容审计

客户端1.8.4、Pi两个1.0.0、ppt-master6.6.0／44c10ed0bc3a9e1df7a25aa179ae7c26db09469b、Python3.13.16不变。完整route与工具合同已只读核对。

| 路线 | 真实适配 | UI | 本轮证据／限制 |
|---|---|---|---|
| Default | 阶段1用途/受众/目标/语言/画幅/模板；阶段2恰好三种完整方向；spec/lock/计划与实际产物一致性审计 | C16/C18/C21 | electron-r12，UI；真实SDK、外层合成供应商，外部模型BLOCKED |
| 单页 | 同页选择single；Default严格一页，无独立大纲/无自动Quick | C14/C20/C28 | 真实SVG/预览/PPTX解析，未偷加目录或尾页 |
| Quick | 仅用户本轮完整明确原文启用；无Default spec/lock/plan/finalize；字体校准、首次七页P05早期回执、最终双flags | 同一会话 | electron-r12七页真实工具；没有上限页数限制冒充 |
| 选模板 | 阶段1后真实import (--inheritance-mode both)/mirror (--kind deck)/quality/apply；候选原件/安装树hash绑定阶段2 | C10—C13/C18 | electron-r12下一候选重新检查不改变批准树；diagnostic输出在reports |
| Edit Native | 当前ready旧稿→import问答→真实结构/hash准备→同一会话scope/objects/replace；原生与视觉参考分开 | C41/C42/C29 | agent-import-r4；native10/10；wuhua真实1页不外推全库 |
| Beautify | 同入口确认、真实intake、source_to_md、冻结inventory；原文字/页数/顺序与真实PPTX facts校验 | C43 | agent-import-r4七页；OOXML图表数值负例；复杂全部对象NOT_RUN |
| Image-to-PPTX | 固定上游完整路线需要Codex原生图像编辑，Pi没有获准等价工具 | C44 | BLOCKED；不以整页截图叠字代替 |
| Create Brand/Style | 已确认项目内工作区，完整kind/id规格、已有素材受控复制、固定校验；不写公共库 | C45 | Style在electron-r12；Brand在template-types-r3；Brand没有SVG原型或preview的合同 |
| Create Layout/Deck | 完整规格+真实SVG原型+受控关联素材+质量检查+真实preview PPTX | C45 | template-types-r3；公共注册/全风格全尺寸NOT_RUN |
| 配图/视觉 | 既有用户授权、限额/队列/结果对账保留；移除材料不可用；import接受后所有工具停止 | C25/C44 | electron-r12移除图零调用、agent-import-r4接受后零调用；真实收费模型BLOCKED |
| 旁白/媒体 | 保留用户本地音频、固定FFmpeg静态逐页MP4与明确mediaEnabled | C59 | native-current实际MP4；动画保持/TTS/所有旁白组合NOT_RUN |
