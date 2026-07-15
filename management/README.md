# Jato AI BID 管理端

`management/` 是与员工用户端完全独立的 Windows Electron 软件，负责局域网授权审批、授权校验和运维统计。它拥有独立的 `package.json`、appId、安装包、进程和 Electron `userData` 目录，不依赖 `client/` 运行。

## 本地开发与验证

管理端运行前需要本机私有凭据文件。复制 `initial-admin.private.example.json` 为 `initial-admin.private.json`，填写由公司负责人保管的初始用户名和初始密码；真实文件和生成的摘要模块均被 Git 忽略。准备脚本只把用户名、随机盐、密码摘要和凭据版本写入运行时模块，不写入明文密码。

```powershell
cd management
npm ci
npm test
npm run build
npm run dev
```

开发服务器固定为 `127.0.0.1:5174`。局域网 HTTP 服务默认监听 `0.0.0.0:47821`，首次设置时可修改。

## Windows 打包

正式打包机器同样必须提供 `initial-admin.private.json`。缺失或字段无效时打包失败，不使用公开默认密码。

```powershell
cd management
npm run dist:win
```

产物写入 `management/release/`，包括 NSIS 安装程序、ZIP 和解包目录。打包脚本会强制按 Electron ABI 重建 `better-sqlite3`，在系统临时目录完成 electron-builder 输出，复制回 `release/` 后再由 Electron 实际创建内存数据库验证，最后恢复本机 Node ABI 对应的依赖。

需要云端按需构建时，手动运行 GitHub Actions 的 `Build Management` 工作流，输入独立的管理端版本和代码 ref。ref 必须是当前 `origin/main` 可达的提交、标签或分支；工作流会在注入 Secret 前完成该信任检查。随后才从 `MANAGEMENT_INITIAL_ADMIN_CREDENTIAL_JSON` Secret 临时生成私有凭据，完成测试、构建和原生模块验证后删除临时文件，只上传以下内部 Artifact，保留 30 天：

```text
Jato-AI-BID-Management-<version>-win-x64.exe
Jato-AI-BID-Management-<version>-win-x64.zip
SHA256SUMS.txt
```

管理端 Artifact 不进入 GitHub Release 或 R2，也不会随客户端 `v*` 标签自动构建。管理端版本与客户端版本独立，兼容性以局域网 API v1 为准。

## 数据与运行方式

- 管理端只有一个管理员账号，不提供账号注册或多管理员。
- 首次启动使用随安装包私下交付的内置初始凭据登录；验证成功后必须立即修改为不同的新密码，再设置局域网监听地址。
- 已登录管理员可在“系统设置”中输入当前密码主动修改密码，新密码不得与当前密码相同。
- 管理端不提供忘记密码、SMTP、恢复邮箱、邮件临时密码或其他自助恢复入口。
- SQLite 数据库文件名为 `management.sqlite3`，位于管理端自己的 Electron `userData` 目录。
- 管理端关闭窗口后隐藏到托盘；托盘“退出服务”才会停止局域网服务。
- 首次启动后启用当前 Windows 用户的登录自启动。
- 管理员密码摘要、签名私钥和业务数据库只保存在管理端服务器本地，不应复制到代码仓库。
- 同一公司局域网只部署一个管理端。安装包、初始凭据、修改后的密码和服务器由公司负责人保管；软件不提供公司网络识别或外部运行技术阻断。
- 覆盖升级前必须备份 `management.sqlite3`；不要修改 appId、删除 `userData` 或重新生成既有许可证签名密钥。

部署、备份和员工操作详见：

- [`phase2-management-guide.md`](../docs/secondary-development/phase2-management-guide.md)
- [`phase2-client-guide.md`](../docs/secondary-development/phase2-client-guide.md)
- [`phase2-migration-notes.md`](../docs/secondary-development/phase2-migration-notes.md)
