# v1.8.0 生图模式 R4 交付证据

## 基线与范围

- 分支 `v1.8.0-Image-generation`，开始时 HEAD `3cc44c9100593b7ee9190e24dc99dd7468695a95`；未切换分支、提交、推送、合并、打标签或发布。用户提供且未跟踪的 R4 规格原文未修改。
- W01-W06 已实现；W07 完成当前可得的代码、迁移、打包、Electron、受限中转和只读审查取证。下面标为“部分”或“未验”的项目不得当成验收通过。
- 本轮 R4 真实模型调用：文本 3/6、图片/编辑 5/6，图片请求每次 1 张；没有调用新账户、新服务或周更批量付费翻译。所有图片/编辑仍经原 `aiService` 图片队列；文本视觉分析和翻译经其文本队列，模型/密钥/中转来自当前设置。

## 实施

- 创作页局部改动：210px 输入框，工具/任务按钮缩高，主按钮不缩；张数与画幅同排，尺寸进草稿、请求、任务与作品。参考图浏览可放大/切换/缩放，角色与删除是独立操作；局部编辑固定使用所选原作品尺寸，避免按当前创作画幅错发收费请求。
- 真参考图通过 multipart 按序送入现有中转；局部修改以原图和可见红色标注图请求，模型结果按选区逐像素合成，区外保持原图。当前中转明确拒绝 mask 字段：`mask compositing is disabled because the VPS does not process image pixels`，因此不宣称 mask 端点可用。没有退回纯文生图或锁住编辑入口。
- 提示词示例图按视口懒加载、本地缓存、逐条错误/重试；图片 URL 与字节哈希决定新缓存文件，同 URL 缓存 24 小时后重新获取，离线沿用已有图。来源增量刷新、40 条分页/总数、晚响应丢弃、个人收藏事务关联和来源/封面保留均已接入。
- Main 每七天检查已启用内置来源，首启延迟检查、休眠恢复检查、同源合并、逐源退避与无变化时间推进。内置初始中文提示词随包提供。周更检查结果通过已有生图事件通知页面；旧中文条目迁移时标记为已翻译，避免误付费。
- PSD 保留 `ag-psd` 写入器，新增本地 OpenCV GrabCut Worker、互补像素前/背景、图层会话、显隐/排序/细修、原子导出/回读。产品照、室内猫及含文字海报均有真实像素样本；海报文字保留在背景像素中，不是可编辑文字图层。海报样本来自双联海报，左幅右边的水果本就在原图幅边截断；候选仍可能携入水果/价格牌，语义质量需人工细修。无 Photoshop 实机证据。

## 验证层级

| 层级 | 结果 | 证据 |
| --- | --- | --- |
| U 定向代码 | 21/21，通过 | `node --experimental-sqlite --test` 加五个 `electron/services/imageStudio*.test.cjs` 定向文件（逐文件列入命令） |
| U 全套 Node | 320 项：292 过、27 败、1 跳过，退出 1 | `full-node-tests-final.tap`；其中 14 项项目持久化受 `better-sqlite3` ABI 145/Node26 ABI147 影响，另有格式、插图、技术方案和旧 UI 断言失败；无同环境改前基线，**不能断言其余均为既有失败** |
| I 构建/打包 | `npm.cmd run build`、CJS `node --check`、`git diff --check`、`electron-builder --win --dir --publish never` 退出 0 | `client/release/win-unpacked/` 为本地未发布目录；打包 Electron 41.5.0 运行 Worker 输出 1536×1024 两层 PSD：`packaged-psd-sample/result.json` |
| I 迁移 | 在线备份 v34 和 v35；隔离 v34→v36 及重复打开，8 类表行数不变 | `migration-result.json`、`online-backup-v35-result.json`。v34 备份在 `C:\Users\MiG\AppData\Local\OpenJatoBID-R4-backup-20260926-224943`，v35 备份在 `C:\Users\MiG\AppData\Local\OpenJatoBID-R4-backup-20260926-160908`，后者 `integrity_check=ok` |
| E 真实 Electron | 隔离 `userData`、CDP 9224；创作/参考放大/分页/收藏/编辑/PSD/缩放等真实页面交互 | `electron-ui/*.png`、`electron-ui/result.json`、`electron-ui/review-regression-result.json`；风格追加后撤销保留后续输入，作品详情直达已有 PSD 会话 |
| R 真实中转 | 单参考图、双参考图、文生图、标注局部编辑成功；纯 mask 请求失败且保留选区 | `relay-edit-result.json`、`electron-ui/{multi-ref-result,edit-ui-result,text-to-image-result}.json`，同目录真实结果 PNG；R4 图片/编辑共 5 次 |
| R PSD 语义 | 当前文本/视觉模型完成 3 次真实候选；本地算法产两层 PSD | `psd-vision-sample/`、`electron-ui/psd-ui-result.json`、`psd-poster-sample/`、`packaged-psd-sample/`；真实边缘质量不等于 Photoshop 验收 |
| F Photoshop | 未执行，本机无 Photoshop | V49 待实机打开并独立移动/隐藏图层 |
| 依赖/审查 | 加入 `@techstark/opencv-js`，复用已有 `sharp`/`ag-psd`；只读 Reviewer 已反馈并修复可定位缺口 | `client/package*.json`、本报告；`npm audit --omit=dev --audit-level=critical` 退出 0，但仍报告 3 moderate/13 high，未做范围外升级 |

首次 UI 探针原以为 `APPDATA` 覆盖可隔离 Electron，实际启动时曾打开真实用户配置并把真实 SQLite 从 v34 迁到 v35。迁移前 v34 备份存在；没有删真实内容。该探针曾创建一条个人提示词并随后软删除，草稿修订从 39 增至 44，草稿正文仍保留。随后改用 `app.setPath('userData', ...)` 明确隔离，后续 E/R 样本均在 `C:\Users\MiG\AppData\Local\OpenJatoBID-R4-electron\jatoaibid`。这些影响不能用隔离探针掩盖。

## V01-V65 核对

“通过”只针对所列证据层；“部分”表示尚缺规格要求的某些样本或端到端验证；“未验”不得算通过。U=单元/模拟，I=迁移/打包，E=真实 Electron，R=真实中转，F=Photoshop。

| 项 | 状态 | 证据与剩余口径 |
| --- | --- | --- |
| V01 | 通过 E | `electron-ui/result.json` 高度 210px、创作截图 |
| V02 | 部分 E | 三工具按钮 18px、可点击；键盘逐键未单独记录 |
| V03 | 通过 E | 八任务按钮约 23px、截图 |
| V04 | 部分 E | CSS 限定生图；其他模块按钮未做实测尺寸对照 |
| V05 | 部分 E | 1280×800 与 1024×640 等效 125% 可达，非物理 125% DPI 实测 |
| V06 | 通过 E | `electron-ui/reference-viewer.png`，缩放/100%/关闭交互 |
| V07 | 部分 E | 多图参考真实生成；四图切换、角色/移除逐项误触未全录 |
| V08 | 部分 U/E | 历史作品可预览；受管文件丢失 UI 未单独演练 |
| V09 | 通过 E | 同排张数/画幅，无画质项，截图与 DOM 指标 |
| V10 | 通过 R | 1536×1024 多参考与 1024×1024 文生图，设置未改 |
| V11 | 通过 I/E | 草稿尺寸恢复、历史作品尺寸与请求快照 |
| V12 | 部分 U/E/R | 七类选项可选，真实中转仅验证两种尺寸 |
| V13 | 部分 U | 格式校验与错误传播在代码；服务端逐尺寸拒绝未遍历 |
| V14 | 通过 R | `electron-ui/text-to-image-result.json` |
| V15 | 通过 R | `relay-edit-result.json` 与传图 transport 测试 |
| V16 | 通过 R | `electron-ui/multi-ref-result.json` 主体/风格顺序与产物 |
| V17 | 部分 U/E | 第五张拦截、25 MB 单图/50 MB 总量代码已加，实际字节超限前置拒绝有单测；四张真实请求未发送 |
| V18 | 通过 U | multipart 字节/字段测试，无本地路径作为公网 URL |
| V19 | 部分 U/R | 父版本/多参考真实链有证据，多结果兄弟链仅代码核对 |
| V20 | 部分 U | 不重复收费的失败处理存在，未做已发出断连端到端 |
| V21 | 通过 U | 仅 GET 重试测试、停止等待迟到结果测试 |
| V22 | 通过 E/R | `electron-ui/edit-selection-before-submit.png` 与真实编辑产物；中转不支持原生 mask，标注路径成功 |
| V23 | 通过 R | `electron-ui/edit-ui-result.json` 区外改变 0 像素 |
| V24 | 通过 E | 真来源封面获取、卡片/详情/大图与 `source-cover-sample/result.json` |
| V25 | 部分 I/E | 本地缓存重复获取成功，断网重启未单独录屏 |
| V26 | 部分 U/E | 无 URL 与单条失败/重试 UI 存在，404/超时/伪图未逐项演练 |
| V27 | 部分 U | URL 换键、字节哈希新文件、24h 刷新；同 URL 即时上游替换不实时探测 |
| V28 | 部分 U | 安全 URL/图片格式/大小限制代码有，攻击性重定向组合未全测 |
| V29 | 通过 U/E | 0/1/39/40/41/80/81 边界测试，实际分页截图 |
| V30 | 部分 U/E | 同条件 total、请求序号防旧响应；快速连续搜索 E 未留截图 |
| V31 | 部分 U | 越界回最后有效页；内容减少 E 未演练 |
| V32 | 通过 U/E | 收藏个人副本及真实页面 `favorite-in-mine.png` |
| V33 | 通过 U | 同步事务及稳定源 ID/条目 ID 关联，重复操作 1 份 |
| V34 | 部分 U | 编辑保留/再次收藏测试；完整后台刷新后 E 未演练 |
| V35 | 部分 U | 取消不删副本、再收藏复用测试；双页同步 E 未全录 |
| V36 | 部分 U/I | 来源删除不级联副本的 schema/代码；含封面断源 E 未录 |
| V37 | 部分 U | 先另存再收藏复用且不覆盖文本；同名不同源未单独测 |
| V38 | 通过 E | 常用风格用途说明、应用 UI；不改参考与尺寸 |
| V39 | 部分 U/E | styleId/版本幂等及草稿字段；重启后重复应用未单独跑 |
| V40 | 通过 E | `electron-ui/review-regression-result.json` 后续用户文本保留 |
| V41 | 通过 E | 创作与作品详情同一 PSD 对话框，`psd-from-work-detail.png` |
| V42 | 通过 U/R | 产品照真实候选、非矩形像素边缘、两层 PSD |
| V43 | 部分 E/R | 室内猫真实候选和细修/显隐生效；边缘质量仍有局部缺口 |
| V44 | 部分 R | 双联茶饮海报保留文字像素与两层 PSD；非可编辑字层，候选会携入水果/价格牌 |
| V45 | 通过 U | 真实产品照像素重组逐像素等于原图 |
| V46 | 部分 U/R | 拒绝空层/重复层及真实样本；语义质量不可由结构测试保证 |
| V47 | 部分 U/E | `psd-refine-ui-result.json` 显隐/排序/重开可用，Photoshop 层状态未验 |
| V48 | 部分 U/I | 原子临时文件+回读、实际 PSD 输出；中文路径/磁盘满/占用未全测 |
| V49 | 未验 F | 本机无 Photoshop，不以 `ag-psd` 回读代替 |
| V50 | 部分 I/E | unpacked 包内 Worker 成功产 PSD；全新员工机器性能未验 |
| V51 | 部分 U/I/E | 随包 8 条中文起始提示词、延迟 Main 检查；首次真联网调度未实测 |
| V52 | 通过 U | 注入时钟临界七天测试 |
| V53 | 部分 U | 恢复事件与到期计算已接入，真实休眠/两周离线未执行 |
| V54 | 部分 U | Main 定时器单例路径已核，页面关闭时真调度未执行 |
| V55 | 通过 U | 200 内容不变/ETag 304 成功时间推进测试 |
| V56 | 通过 U | 主源正常变化无需人工确认，原子刷新测试 |
| V57 | 部分 U | 骤减和备用版本保护测试；空 JSON 未单独断言 |
| V58 | 通过 U | 同源并发合并、单源退避并继续其他源 |
| V59 | 通过 U/I | 改址晚响应丢弃、停用/删除保留设置测试 |
| V60 | 部分 U | 旧中文迁移免重译和增量状态；真实少量新英文翻译未付费演练 |
| V61 | 部分 U/E | 来源事件刷新来源/分页、详情更新提示；真实到期时打开页面未执行 |
| V62 | 部分 I | v34→v36 行数保留及重复迁移，失败恢复演练未做 |
| V63 | 未验 E | 旧对话/投标配图/Word 真实业务未逐项回归，完整测试有非本功能失败 |
| V64 | 部分 U/R | 请求走原队列、来源下载不带模型鉴权；系统级日志/泄漏审计未全做 |
| V65 | 部分 U/I | 聚焦21/21、构建/检查/打包通过，只读审查完成；全套292/320且F缺失 |

## 审查结论与未关闭项

只读 Reviewer 发现的作品详情 PSD 入口、风格撤销、个人副本去重/封面、编辑原图尺寸、旧中文迁移、后台检查状态前台刷新、参考图实际字节限制均已修复，并在可行层复测。海报候选与猫边缘的语义质量仍需要人工细修和 Photoshop 终验。没有执行正式安装器签名/发布、管理端、Worker、R2 或超额度模型调用。
