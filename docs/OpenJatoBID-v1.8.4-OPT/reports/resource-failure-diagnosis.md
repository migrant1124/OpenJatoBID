# 资源失败取证边界

已从正式管理端 SQLite 只读取得最近100条脱敏审计，见 [resource-audit-readonly.json](resource-audit-readonly.json)。最新 PARTIAL 来自 awesome-gpt4o-image-prompts，计数14；对应 ITEM_FAILED 消息为“真实图片解码失败”。旧记录未保存 stage/code/upstreamCommit/原始图片hash与字节，不能把这14项全部归因为网络、缓存或某一种格式。未对正式资源重试、清空或写库。

在当前真实 Electron 中用同一40×30合成图片分别编码PNG/JPEG/GIF/WebP，nativeImage可读前两种，后两种为空；原下载协议允许后两种，因此存在已证实的格式适配缺口。[Electron nativeImage 官方说明](https://www.electronjs.org/docs/latest/api/native-image)也限定PNG/JPEG。新增解码器保留PNG/JPEG快路径，其他已批准图片由隔离、无外部网络的隐藏BrowserWindow通过createImageBitmap解码；损坏图片继续失败，不修改原字节/hash协议。真实结果见 client/.tmp/v184-opt/electron-r9/image-decoder.json；四格式及损坏负例通过。该结果没有替代原14项的逐字节取证。

隔离回归构造明确14项准备失败，管理单元测试与真实Renderer均验证 partial/14项详情、旧快照保留、失败条目重试、独立统计及无业务变化零发布。management完整89/89通过；真实双端UI证据见 test-report.md。该输入是测试合成来源，不证明正式14项已经恢复。

新的 ITEM_FAILED 包含任务、resourceId、stage、code、retryable及脱敏message；无法精准判断的字段写unknown。来源最终状态区分partial/failed/cancelled，审计按需分页20条，首页只取摘要。正式原失败恢复为NOT_RUN：需用户在确认来源后检查失败明细或提供原失败图片副本，不能宣称每次重试必然增版。
