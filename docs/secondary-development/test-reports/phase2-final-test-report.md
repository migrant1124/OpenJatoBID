# 第二阶段最终测试报告

日期：2026-07-10；2026-07-11 完成 PRD 0.5 管理员认证复验  
结论：T32—T36 与 CP7 已完成，方案 2 的私有凭据注入、首次强制改密、主动改密、旧认证迁移、视觉回归和管理端 Windows 新安装包均通过。实体双机现场验收尚未执行，客户端既有依赖审计仍有已知漏洞，因此 T30/CP6 保持未关闭。

## 执行结果

| 项目 | 命令或方法 | 结果 |
| --- | --- | --- |
| 用户端干净安装 | `cd client; npm ci` | 通过 |
| 用户端服务测试 | `node --test electron/services/*.test.cjs` | 14/14 通过 |
| 用户端构建 | `npm run build` | 通过；仅有既有大 chunk 警告 |
| 用户端 Windows 打包 | `npm run dist:win` | 通过；NSIS、ZIP、win-unpacked 均生成 |
| 管理端干净安装 | `cd management; npm ci` | 通过；403 个包按锁文件重装 |
| 管理端测试 | `npm test` | 36/36 通过 |
| 管理端构建 | `npm run build` | 通过 |
| 管理端 Windows 打包 | `npm run dist:win` | 通过；NSIS、ZIP、win-unpacked 均生成 |
| 管理端 CJS 语法 | 对 `management/electron`、`management/scripts` 执行 `node --check` | 29/29 通过 |
| 运行时冒烟 | 管理端 `win-unpacked` 使用全新隔离 `userData` 启动 | Electron 进程正常；数据库生成且进入强制改密状态；启动标准错误为空 |
| 原生模块 ABI | 构建前强制 Electron 重建，封装后由 Electron 41 创建内存数据库 | 通过；构建日志为 `native-module-load: PASS` |
| ASAR 边界 | 检查应用清单并读取生成摘要模块 | 私有 JSON 0、测试文件 0、明文初始密码 0；生成摘要模块存在 |
| Git whitespace | `git diff --check` | 通过；仅显示 Git 的 CRLF 提示 |
| 凭据/旧方案扫描 | 扫描真实明文、`nodemailer`、忘记密码和旧恢复字段，排除私有构建文件与产物 | 明文只存在于被 Git 忽略的本机私有文件；产品代码与依赖无旧恢复能力 |

## 依赖审计

- 管理端：`npm audit` 为 0 项漏洞。
- 用户端：`npm audit` 返回 14 项（2 low、5 moderate、5 high、2 critical）。其中包括 `concurrently/shell-quote`、`undici`、`vite`、`mermaid` 和 `xlsx`；`xlsx@0.18.5` 在 npm 审计结果中没有可用修复。
- 这些依赖来自用户端既有依赖树，本轮没有执行自动 `npm audit fix`，避免在 UI/局域网授权任务中引入未经验证的大范围依赖升级或替换。该项需要单独建立依赖治理任务，完成替换和全功能回归后再关闭。

## 代码审查

按正确性、数据边界、性能、可维护性和交付风险复核。审查中已修复：

- 登录切换到首次改密时清空密码状态，避免初始密码残留在新密码输入框；
- 服务层拒绝把新密码设置为当前初始密码或当前负责人密码，确保“强制改密”不可绕过；
- Windows 打包前强制重建 Electron 原生模块，并在恢复宿主 Node 依赖前验证安装包实际可加载；
- 从 ASAR 排除全部测试文件和私有凭据 JSON；
- 统计聚合改为 SQLite 聚合查询，避免无界事件全量加载；
- 管理端列表刷新时及时标记过期授权；
- 已批准申请在授权被撤销/过期后不再返回旧签名授权；
- 移除旧离线激活界面和无引用授权提示样式；
- `MarkdownRenderer` 显式传递 React `key`，消除控制台告警。

未发现本轮新增 P0/P1 正确性问题。用户在本轮开始前已删除仓库 `NOTICE` 文件，该状态未被本轮修改；正式对外发布前需要由用户确认开源许可证与第三方声明是否仍满足发布要求。

## 视觉回归

- 用户端登录页 1280×720：无页面溢出，独立会话 0 error / 0 warning。
- 用户端技术方案页 1920×1080：无 body 溢出。
- 管理端授权与统计页 1440×900：无页面溢出，0 error / 0 warning。
- 管理端账号登录、强制改密、服务器设置和主动改密链路：0 error / 0 warning。
- 14 张固定视口截图归档于 `docs/secondary-development/design/screenshots/`。
- 详细记录见 `docs/secondary-development/design/phase2-visual-regression.md`。

## Windows 产物

| 产物 | 大小（字节） | SHA-256 |
| --- | ---: | --- |
| `client/release/Jato AI BID Setup 1.0.0.exe` | 212153512 | `202B84ACA722A85E0DBFDFE45C0F4FB7AF9C60100ABC37FE83D3ED41D47D1845` |
| `client/release/Jato-AI-BID-1.0.0-win-x64.zip` | 291700819 | `91845998B4B4C80BE825E65BC3D5497EFC54CEDD0DA511ABCC5AEF0C9E52B339` |
| `management/release/Jato AI BID 管理端 Setup 1.0.0.exe` | 101021003 | `0F8A48E963BBAE61C3B29BB44B91034273BD0249398CE68039FDBED9186186A6` |
| `management/release/Jato AI BID 管理端-1.0.0-win.zip` | 142805821 | `B50E4FFE316C48265C96F9344673318C74E7F2F841F6F9351F816CFD5936F081` |

## 剩余发布门

1. 在真实 Windows 服务器和另一台员工电脑完成安装、防火墙、申请—审批—登录—撤销、离线/30 天时钟和升级/卸载验证。
2. 如需要支持 macOS 用户端，在真实 Intel/Apple Silicon 设备完成同链路验证。
3. 对授权和埋点做现场网络抓包，确认仅访问配置的局域网管理端；同时确认保留的公告、资源和更新能力可达。
4. 单独治理用户端依赖审计问题。
5. 确认删除 `NOTICE` 不影响发布合规；若非有意删除，应由用户决定是否恢复。
