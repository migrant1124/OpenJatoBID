import { useEffect, useState } from 'react';
import type { ManagementOperationResult, ResourceCenterStatus } from '../../shared/ipc';

const date = (value: number | null) => value ? new Date(value).toLocaleString('zh-CN') : '尚未检查';
const size = (value: number) => `${(value / 1024 ** 3).toFixed(2)} GB`;

export default function ResourceCenterPage() {
  const [status, setStatus] = useState<ResourceCenterStatus | null>(null);
  const [settings, setSettings] = useState<ResourceCenterStatus['settings'] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState<{ path: string; freeBytes: number } | null>(null), [cleanup, setCleanup] = useState(false);
  const api = window.jatoManagement!.resources;
  const refresh = async () => {
    const result = await api.status();
    if (result.success && result.data) { setStatus(result.data); setSettings((value) => value || result.data!.settings); }
    else setMessage(result.message || '无法读取资源状态');
  };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 3000); return () => window.clearInterval(timer); }, []);
  const act = async (operation: () => Promise<ManagementOperationResult>) => {
    setBusy(true); setMessage('');
    try { const result = await operation(); setMessage(result.success ? '操作已完成，以下为真实运行状态' : result.message || '操作失败'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '资源操作失败'); }
    finally { setBusy(false); await refresh(); }
  };
  if (!status || !settings) return <p role="status">{message || '正在读取资源中心…'}</p>;
  return <section className="resource-center-page">
    <article className="settings-panel"><header><div><h2>公共资源同步</h2><p>固定每周一次 · 关闭窗口后继续驻托盘 · 退出服务或关机时停止</p></div><strong>{status.running ? '调度运行中' : '调度未运行'}</strong></header>
      <p>已发布版本 {status.version} · {status.count} 项目录 · 已镜像 {size(status.bytes)} · 可用空间 {status.freeBytes === null ? '资源盘不可用' : size(status.freeBytes)}</p>
      {status.unavailable && <p role="alert">{status.unavailable}。授权与统计服务继续运行，可更换资源目录或网络设置后重试。</p>}
      <p>索引、本体、预览、结构检查与实际套用验证分别记录。手动检查不改变周计划；失败保留旧快照。</p>
    </article>
    {message && <p className="form-message" role="status">{message}</p>}
    <div className="resource-table-wrap"><table className="resource-table"><thead><tr><th>来源</th><th>启用</th><th>最后检查 / 成功</th><th>下次周计划</th><th>运行及错误</th><th>操作</th></tr></thead><tbody>
      {status.sources.map((source) => <tr key={source.sourceId}><td>{source.name}</td><td><input type="checkbox" aria-label={`启用${source.name}`} checked={source.enabled} disabled={busy || source.running}
        onChange={(event) => void act(() => api.enable({ sourceId: source.sourceId, enabled: event.target.checked }))} /></td>
        <td>{date(source.checkedAt)}<br />{date(source.successAt)}</td><td>{source.enabled ? date(source.nextDueAt) : '来源未启用'}</td><td>{source.running ? '正在准备资源' : source.error || '等待周计划'}</td>
        <td>{source.running ? <button type="button" onClick={() => void act(() => api.cancel(source.sourceId))}>停止本次</button>
          : <button type="button" disabled={!source.enabled || busy} onClick={() => void act(() => api.check(source.sourceId))}>{source.error ? '重试失败来源' : '立即检查'}</button>}</td></tr>)}
    </tbody></table></div>
    <article className="settings-panel"><header><div><h2>资源存储与网络</h2><p>专用于公共资源下载，局域网授权与统计不经过该代理。</p></div></header>
      <form className="resource-settings" onSubmit={(event) => { event.preventDefault(); void act(() => api.configure(settings)); }}>
        <label>镜像目录<input value={settings.root} readOnly /></label><button type="button" disabled={busy} onClick={() => void api.chooseDirectory().then((result) => { if (result.success && result.data) { if (result.data.systemVolume) setLocation(result.data); else setSettings({ ...settings, root: result.data.path }); } else if (!result.success) setMessage(result.message || '目录检查失败'); })}>选择目录</button>
        {location && <section className="settings-panel"><strong>所选镜像位置位于系统盘</strong><p>{location.path} · 可用 {size(location.freeBytes)}。原始模板、预览和暂存可能持续占用空间，建议选择非系统盘。</p><button type="button" onClick={() => setLocation(null)}>重新选择（推荐）</button><button type="button" onClick={() => { setSettings({ ...settings, root: location.path }); setLocation(null); }}>仍然使用</button></section>}
        <label>配额（GB）<input type="number" min="1" value={settings.quotaBytes / 1024 ** 3} onChange={(event) => setSettings({ ...settings, quotaBytes: Number(event.target.value) * 1024 ** 3 })} /></label>
        <label>网络<select value={settings.networkMode} onChange={(event) => setSettings({ ...settings, networkMode: event.target.value })}><option value="system">使用系统网络设置</option><option value="proxy">管理端专用代理</option></select></label>
        {settings.networkMode === 'proxy' && <label>代理地址<input value={settings.proxyRules} onChange={(event) => setSettings({ ...settings, proxyRules: event.target.value })} placeholder="http://127.0.0.1:7890" /></label>}
        <button className="primary-button" type="submit" disabled={busy}>保存资源设置</button>
      </form>
      <button disabled={busy} onClick={() => setCleanup(true)}>清理无任务占用的暂存</button>{cleanup && <section className="settings-panel"><strong>确认清理当前镜像目录暂存？</strong><p>只删除中断下载与过期预览候选；原始镜像、已发布版本、授权数据库、管理员凭据及签名密钥均保留。</p><button onClick={() => setCleanup(false)}>取消</button><button disabled={busy} onClick={() => void act(async () => { const result = await api.cleanup({ confirmed: true }); if (result.success) setCleanup(false); return result; })}>确认清理暂存</button></section>}
    </article>
    <article className="settings-panel"><header><div><h2>发布记录</h2><p>仅有效业务变化发布；检查时间变化不生成通知。</p></div></header>
      {status.history.length ? status.history.map((release) => <p key={release.version}>版本 {release.version} · {date(release.createdAt)} · {JSON.parse(release.changesJson).length} 项有效变化</p>) : <p>尚无已发布快照</p>}
    </article>
    <article className="settings-panel"><h2>技能仓库获取申请</h2><p>只准入公开 GitHub 仓库和指定子目录，固定提交镜像完整候选。准入下载不授权员工执行新脚本。</p>{status.repositories.length ? status.repositories.map((item) => <p key={item.requestId}>{JSON.parse(item.locatorJson).repo} / {JSON.parse(item.locatorJson).root || '自动识别技能目录'} · {item.status}<button disabled={busy || item.status === 'downloading'} onClick={() => void act(() => api.repositoryDecision({ requestId: item.requestId, approve: true }))}>{item.status === 'failed' ? '重试获取' : '准入并获取'}</button><button disabled={busy} onClick={() => void act(() => api.repositoryDecision({ requestId: item.requestId, approve: false }))}>拒绝</button></p>) : <p>暂无获取申请</p>}</article>
    <details className="settings-panel"><summary>同步审计与只读计划</summary>{status.audits.map((audit, index) => <p key={index}>{date(audit.occurredAt)} · {audit.sourceId} · {audit.status} · {audit.detailJson}</p>)}</details>
  </section>;
}
