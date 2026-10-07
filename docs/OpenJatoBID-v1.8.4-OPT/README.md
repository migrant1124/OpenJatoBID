# OpenJatoBID v1.8.4-OPT 优化交付包

文档修订：OPT-D1 · 2026-10-05  
开发分支：**v1.8.4-OPT（用户创建并切换）**  
客户端软件版本：**1.8.4保持不变**；管理端独立版本保持原值。  
只读取证：`migrant1124/OpenJatoBID`，`main@f866acc1d0be33ecbe73f5831bed21771389eaed`。

## 1. 先看这里

本轮只做两条主线：管理端资源操作与界面修正；客户端PPT改为Agent对话驱动的制作入口。**PPT首页不重做；点击开始制作直接进入红标题、充分留白的Agent页；上传、技能（默认ppt-master）、模板和单页/整套都在这一页选择；不再强制跳转独立大纲页；后续三栏工作区基本保留。**

管理端采用“多选草稿 → 批量确认 → 持久后台队列”。审计与只读周计划由一个按钮打开；版本号保留在内部协议和诊断，不交给员工选择。统一资源卡片的语义字号和内边距，失败信息收纳到详情而不是伪装成功。

用户最后的文字纠正优先于旧D1.2文档及历史生成海报。旧图中的每日同步、四类模式、额外导航、版本选择和必经大纲流程均不得沿用。

## 2. 文件怎么使用

| 文件 | 用途 |
|---|---|
| [v1.8.4-OPT-spec.md](v1.8.4-OPT-spec.md) | 需求、业务流程、数据状态、接口合同、边界和验收门槛 |
| [Code-Audit.md](Code-Audit.md) | 已查明的代码问题、符号位置、固定提交来源和未知根因 |
| [UI-Handoff.md](UI-Handoff.md) | 字号/间距/布局、复用边界、响应式和图稿实施规则 |
| [UI-State-Matrix.md](UI-State-Matrix.md) | 76个状态逐一对应输入、主动作、输出约束和PNG |
| [Acceptance-Test-Cases.md](Acceptance-Test-Cases.md) | 114项测试合同：98项P0、16项P1，尚未执行生产测试 |
| [Codex-Run.md](Codex-Run.md) | 可整段粘贴的10步连续执行指令，每步含输入、输出、约束 |
| [ui/prototype.html](ui/prototype.html) | 自包含离线状态演示，用右下角画面目录切换 |
| [ui/gallery.html](ui/gallery.html) | 全部设计参考缩略图索引，便于逐图查看 |
| ui/screens/ | 76张基准PNG及16张关键画面尺寸对照，共92张 |
| [references/user-agent-reference.png](references/user-agent-reference.png) | 用户上传的红线参考原图，不是重新生成的图片 |
| [reports/design-render-check.json](reports/design-render-check.json) | 独立设计参考的真实浏览器渲染/导航检查；不代表软件验收 |
| [reports/test-case-catalog.json](reports/test-case-catalog.json) | 机器可读测试用例目录，状态为尚未执行 |
| delivery-manifest.json | 交付文件清单与SHA-256，方便核对完整性 |

建议先读规格，再开Agent初始页C01、单页C14、确认C16/C18/C20和管理端A01–A07，随后按状态矩阵检查分支。原型是可点击的状态切换演示，不是能存储草稿、处理文件或调用模型的应用。

## 3. 放到项目里的位置

解压后将本文件所在目录的**全部内容**放到：

```text
D:\Documents\OpenJatobid\docs\v1.8.4-OPT\
```

正确结构：

```text
docs/v1.8.4-OPT/
  README.md
  v1.8.4-OPT-spec.md
  Code-Audit.md
  UI-Handoff.md
  UI-State-Matrix.md
  Acceptance-Test-Cases.md
  Codex-Run.md
  references/
  ui/
    prototype.html
    gallery.html
    state-data.json
    screens/
  reports/
  delivery-manifest.json
```

不要多嵌套一层`OpenJatoBID-v1.8.4-OPT/`，否则指令中的路径找不到。保留仓库旧规格作为历史，不直接覆盖旧D1.2。由用户创建并切换`v1.8.4-OPT`后，再将Codex-Run.md的正文指令粘贴执行。没有切到正确分支时，Codex必须停止写入而不是替用户切分支。

## 4. 一条启动指令

```text
当前任务是OpenJatoBID的v1.8.4-OPT优化。先只读核对当前分支、HEAD、git status及AGENTS.md；分支必须为v1.8.4-OPT，否则停止写入并报告。完整读取docs/v1.8.4-OPT/README.md及其引用的规格、代码核对、UI交接、状态矩阵和验收用例，然后严格执行docs/v1.8.4-OPT/Codex-Run.md中的10个步骤，除真正阻塞项外连续完成代码、迁移、测试和报告。以用户最后确认的Agent同页制作流程为准：首页保留、单页不进大纲、后续工作区基本不变。保持客户端1.8.4及管理端独立版本和固定依赖；保留用户修改；不得暂存、提交、推送、合并、回退、打标签、发布或部署。真实功能与图稿逐项对应，原型/mock/构建通过不能冒充安装和业务验收。
```

完整10步指令在Codex-Run.md，不需要将全部规格粘进一个聊天消息；让Codex读取本地文件即可。

## 5. 图稿与检查范围

共76个状态：管理端A01–A13，客户端C00–C62。**C00只是“首页保持”的连接示意，不是新首页设计。** 基准图1600×1000；A01/A02/A06/C01/C10/C18/C27/C37另有1366×900与1280×800对照图。图内公司文字/侧栏为保留区域示意，实际实现必须复用真实Logo、导航和窗口组件。

全部画面是HTML/CSS渲染的设计参考，数据、来源名称、模板封面、项目内容及统计都是明确标示的示例，不能进入生产库。程序运行时必须使用真实数据、真实模板缩略图和真实文件状态。图稿需要与UI-Handoff一起使用，不能只照颜色或图片中的装饰复制。

本次完成独立设计参考的渲染、页面边界及两条原型导航检查，没有运行用户安装包、用户14项失败的本地日志、真实模型请求或Office/WPS成品验收。也没有打开成功原分享链接；依据的是仓库已读代码/handoff和用户上传参考图。以上尚未验证事项在规格和测试中保留，不宣称已修复。

## 6. 给Codex的交付要求

完成后提交工作区供用户检查，输出需求到源码/截图/测试的追踪表、能力映射、实施记录、配置说明、迁移及回退方案、分层测试报告和视觉差异报告。未执行标NOT_RUN，有权限/环境/依赖边界标BLOCKED；不得仅用“已按图实现”结束。

本包不附带生产代码、字体文件、凭据或可执行安装包，也不会执行任何Git/发布操作。

**一句话总结：这份交付把“交互如何改、界面如何摆、状态如何流转、Codex如何执行、怎样才算通过”放在同一份可追踪合同中，降低误触下载、流程跑偏、假成功和旧稿误覆盖风险。**
