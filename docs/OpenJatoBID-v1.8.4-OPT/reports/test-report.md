# 分层测试与实际验收报告

证据根C=`D:\Documents\OpenJatobid\client\.tmp\v184-opt`；M=`D:\Documents\OpenJatobid\.tmp\v184-opt`；UI=`D:\Documents\OpenJatobid\client\.tmp\v184-opt\ui\双端-QYcsAe`。下列无前缀日志均位于C，管理日志在M。所有测试启动前设置独立userData；管理LOCALAPPDATA、正式凭据和授权流程分别隔离，未触正式Store。Electron启动前清空继承ELECTRON_RUN_AS_NODE；包内Node探针明确单列，不能冒充普通GUI入口。

| 层 | 实际命令 | 退出码及结果 | 原始证据 |
|---|---|---|---|
| 静态语法 | 仓库根：node --check <27个本轮.cjs> | 0 / 27全部通过 | 仓库.tmp/v184-opt/node-checks-final.json |
| 客户端构建 | client：npm.cmd run build | 0 | client-build-final-r2.log |
| 管理测试 | management：npm.cmd test | 0 / 89/89 | 仓库.tmp/v184-opt/management-test-r2.log |
| 管理构建 | management：npm.cmd run build | 0 | 仓库.tmp/v184-opt/management-build-final-r2.log |
| 客户端既有回归 | client：设置JATOBID_PPT_TEST_FIXTURES指向本轮hash固定目录后 npm.cmd run test:ci-upgrade | 0 / Pi29 + 业务34 | client-ci-upgrade-r3.log |
| 本轮合同负例 | client：node --test scripts/opt-contract.test.cjs | 0 / 5/5 | opt-contract-final-r3.log |
| 真实SDK/Electron | client：.\node_modules\electron\dist\electron.exe scripts/opt-electron-smoke.cjs .tmp/v184-opt/electron-r12 | 0 / 12/12 | opt-electron-r12.stdout.log；electron-r12/evidence.json |
| 新入口旧稿/插页 | client：.\node_modules\electron\dist\electron.exe scripts/opt-beautify-electron.cjs .tmp/v184-opt/agent-import-r4 .tmp/v184-opt/electron-r11/Quick七页.pptx | 0 / 6/6 | agent-import-r4.stdout.log；agent-import-r4/evidence.json |
| 跳转专项负例 | client：.\node_modules\electron\dist\electron.exe scripts/opt-beautify-electron.cjs .tmp/v184-opt/insert-links-r1 .tmp/v184-opt/electron-r11/Quick七页.pptx --insert-only | 0 / 1/1 | insert-links-r1.stdout.log；insert-links-r1/evidence.json |
| 四模板类型 | client：.\node_modules\electron\dist\electron.exe scripts/opt-beautify-electron.cjs .tmp/v184-opt/template-types-r3 .tmp/v184-opt/electron-r11/Quick七页.pptx --templates-only | 0 / 3/3（Brand/Layout/Deck）；Style另在SDK12项 | template-types-r3.stdout.log；template-types-r3/evidence.json |
| 真实原生/导出 | client：.\node_modules\electron\dist\electron.exe scripts/ppt-native-electron-smoke.cjs | 0 / 10/10 | native-current.stdout.log；原始根见该日志 |
| 真实Electron业务Store | client：.\node_modules\electron\dist\electron.exe scripts/ppt-business-electron-smoke.cjs | 0 / 7/7；该层runtime模拟，不称SDK | business-current.stdout.log；原始根见该日志 |
| 正常双端UI | client：node scripts/opt-ui-electron.cjs | 0 / 9/9 | ui-r20.log；ui/双端-QYcsAe/evidence.json |
| WPS只读 | 仓库根：powershell -File client/.tmp/v184-opt/wps-proof.ps1 | 0 / 实际七页PNG；源hash不变 | beautify-r1/wps-native-proof/evidence.json |
| 本地NSIS | client：node scripts/ppt-package-local.cjs；最终补构 --client-only | 见下方包证据 | package-final.log；package-client-final-r2.log |

## 层级边界

Pi/SKD为实际1.0.0包、实际Proxy和宿主工具；仅最外层供应商为本地合成HTTP，真实外部模型BLOCKED，未发生收费请求。AppContainer使用实际固定运行组件，没有用系统Python/PATH替代。Quick七页、单页Default、三方向两阶段、问题精确回答与旧否决、模板import/mirror/apply、创建模板、旧稿import原生/Beautify均有不同原始证据，不外推所有外部模型理解。

双端UI使用真实Main/preload/Renderer、SQLite、LAN HTTP：管理员正常初始登录改密→员工申请→管理员批准→签名授权active。公共资源用合成16条并故意14项解码失败，真实正式14项仅只读审计，不称原因全查清/已全部修复。实际四格式解码另测，失败旧镜像保留/无变化不发布另有管理回归。

原生用真实hash固定wuhua单页和free四页二进制；wuhua原生对象精准替换、free视觉参考路线、真实PDF/PNG/Markdown/静态MP4/个人模板导出分别执行。一个样本不代表全库。Brand仅完整规格/素材/校验；Layout/Deck有实际SVG原型和preview PPTX，不能把Brand混称SVG预览。

窗口1600×1000、1366×900、1280×800与进程zoomFactor1.25已测。物理Windows显示scaleFactor1，全局125%、真实IME/系统缩放下人工交互NOT_RUN。初始C01/工作区C27/A01各三尺寸已补PNG及横向溢出/字号断言，C15另为已有会话。

WPS COM的PowerPoint.Application实际指向wpp.exe，只能记WPS。七页实际只读渲染且原PPTXhash保持；Microsoft Office BLOCKED。换行/字体/复杂图表表格/SmartArt/备注的全对象人工验收NOT_RUN。

## 原始失败与复验

- 管理首轮87/89，既有数据库测试仍期望schema5；本轮实际加法schema6，更新对应断言后89/89。原management-test.log保留。
- 早期Agent确认、候选附件、模板树诊断与单页/方案审计失败均保留electron-r*原日志；主代理Debug后最新electron-r12为12/12，不能删除失败来制造绿灯。
- Brand首轮缺真实链接素材而拒绝（template-types-r1）；增加受控复制当前ready/固定templates素材的工具后r3为3/3。素材规范化/错误格式负例真实执行，不开放下载/生图。
- UI r8/r10/r13分别为测试文本/按钮/精确label定位错误，原日志保留；r14为8/8；新补测r15期待旧状态文本失败，r16/r18发现真实焦点丢失，r17因脚本改写路径错误未应用而保留失败。修复共享查看层cleanup捕获element/previous后，r19为9/9；r20补真实内部scrollTop90→90后仍9/9。所有原FAIL保留。更早实际问题修复证据见final-review.md。
- 首次最终包核对r1实际退出1：A00D5B的ASAR在pptService.cjs记录124832字节、实际冻结源码124842字节，后继文件起点偏移10字节，包内package.json解析失败。package-corruption-diagnosis.json保留。该构建期间有最后源码修复，构建退出0不代表包可用；采用源码冻结后的全新包并重新核对，结果另列包证据。

## Windows及未执行项

Windows11Pro、本地builder可运行。Sandbox特性关闭且无WindowsSandbox.exe；Hyper-V存在但Get-VM只读查询被当前系统权限拒绝，没有独立VM/专用测试账户，NSIS实际安装/升级两端BLOCKED。未开启功能、提权、创建账户、安装到正式用户或绕过许可证。available-vms.json保存系统原文。

114个唯一用例逐项在acceptance-results.md。PASS仅实际层级；规定组合未运行即NOT_RUN，环境/权限明确阻断为BLOCKED。局部证据不替代整项组合。完整76 UI状态还缺部分actual截屏，用户UI定稿确认NOT_RUN。不声称核心闭环之外的全部验收通过，release_ready=false。

所有本地electron-builder为--publish never。独立安装、实际外部模型、Office、全局DPI/IME、完整物理重启/断网/全部脏草稿组合及用户视觉确认仍是交付限制。没有上传、发布或线上工作流执行。

## 最终本地包复验

最终客户端`client/.tmp/ppt184-resource-center/package/本地-1cAPZx/client`，管理端`本地-p9jmcX/management`。管理端在共用查看层焦点修复、management build final-r2后重新--management-only构建，两个builder都明确`--win nsis --x64 --publish never`，退出0；原native模块hash前后不变。本地包包含合成管理测试凭据，不作为正式发布包。

最终命令（client目录）：`node .tmp/ppt184-resource-center/verify-final-package.cjs .tmp/ppt184-resource-center/package/本地-1cAPZx .tmp/ppt184-resource-center/package/本地-p9jmcX`，退出0。日志`client/.tmp/v184-opt/package-verification-final-r3.log`，完整hash/installer/ASAR/实际包内探针在`client/.tmp/ppt184-resource-center/final-package-ObFhO4/final-artifact-hashes.json`。复用通用验证器的layer有历史描述，以本报告实际root/源码hash及命令为本轮范围依据。

client253/management27生产文件、14553/14549运行文件零差异；自身打包Electron RUN_AS_NODE探针4/4和3/3分别退出0，实际中文SQLite/ABI145、client两个Pi1.0.0、固定Python/AppContainer attribution_guard通过。此层不能替代正常GUI、NSIS安装升级或许可证/模型人工验收。A00D5B旧失败包不可使用。

末次UI为ui-r20/双端-QYcsAe，9/9、errors=[]。M03/M14/P05与V07/V08新增真实断言包括内部表scrollTop90→90及焦点/草稿保留、仅2/3来源且周锚点不变、目录取消零模型/零项目、初始C01/工作区C27/A01九张三尺寸PNG。原始r15文本定位失败、r16/r18焦点真实失败及r17脚本改写路径失败均保留；焦点修复后r20通过。

最终114项：81 PASS、29 NOT_RUN、4 BLOCKED；完整76 UI状态27取得actual，用户定稿确认尚未收到，剩余状态不能由这26张图外推。P10比例冲突决定完整UI没有执行而NOT_RUN。

## 最终隔离补测

仅测试脚本继续变化，生产源码与包保持冻结。命令均在client目录，启动前清空ELECTRON_RUN_AS_NODE、使用真实Electron及隔离userData：

| 实际命令 | 退出码/结果 | 原始证据 |
|---|---|---|
| .\node_modules\electron\dist\electron.exe scripts/opt-electron-smoke.cjs .tmp/v184-opt/electron-r13 | 0，13/13 | opt-electron-r13.stdout/stderr.log；electron-r13/evidence.json |
| .\node_modules\electron\dist\electron.exe scripts/resource-client-electron-smoke.cjs | 0，10/10 | resource-client-current.stdout/stderr.log；../ppt184-resource-center/resource-client/隔离-s01Zfp/evidence.json |
| node scripts/opt-ui-electron.cjs --supplement | 0，12/12 | ui-supplement-r7.log；ui/双端-egevke/evidence.json |
| node --check 本轮28份CJS | 0，全部通过 | 仓库.tmp/v184-opt/node-checks-supplement.json |

M12/M13通过真实点击取消/停用，旧镜像hash和周计划保护；M16在供应商挂起及失败后，真实LAN许可verify与管理统计仍响应；M19实际关窗隐藏，调用真实托盘退出菜单回调后进程0、LAN拒绝。未模拟物理托盘菜单点击。R03无旧镜像失败文案准确，R07全16失败/16复用/0新增/0发布，R09隔离预置24条后0/5异常清单不删旧快照。

R05一次真实有效资源变化由签名HTTP应用并显示一次，两次相同检查不增版/游标/未读/弹窗。R10两次变化实际记录按日期和摘要，无资源版本选择；查看层使用既有resource-update-history事件入口。编辑焦点延迟有实际断言，但R13导出/答题完整组合仍NOT_RUN。R12签名失败applied/shown两游标不动；R14有效PNG缓存可读，未缓存失联失败，所有网络请求限定LAN。

P07实际有效TXT与损坏DOCX：附件ready/failed独立，原件hash保持，SDK仅继续读取ready。原始r13测试名有“模型不可读取失败项”，该新增块未直接请求失败路径；失败无path及既有activeMaterials门禁/移除材料负例另证，不将其外推新访问负例。

补测r1/r2为测试注入路径/评估环境require错误，r3/r4为ElectronApplication.evaluate第一个参数实际为Electron而误用业务参数，r6为更新弹窗标题定位错误；原FAIL保留，不属于生产修复。r5先11/11，再补真实更新UI后r7为12/12。当前无已确认未修复FAIL。合成供应商、真实外部模型、安装、Office的分层边界不变。

最终114项81 PASS、29 NOT_RUN、4 BLOCKED；76状态27有actual，最终用户UI确认未收到。详见逐项acceptance-results.md，release_ready=false。
