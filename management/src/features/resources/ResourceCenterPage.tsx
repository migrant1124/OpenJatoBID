import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ManagementOperationResult, ResourceAudit, ResourceCenterStatus } from '../../shared/ipc';

const date = (value: number | null, empty = '尚未检查') => value ? new Date(value).toLocaleString('sv-SE').slice(0, 16) : empty;
const size = (value: number) => `${(value / 1024 ** 3).toFixed(2)} GB`;
const states: Record<string, string> = { queued: '等待同步', running: '正在同步', completed: '已检查，无更新', partial: '部分资源待更新', failed: '更新未完成', cancelled: '已停止', interrupted: '上次任务中断' };
function ResourceDialog({ title, children, close, busy = false }: { title: string; children: ReactNode; close: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current, previous = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className="resource-dialog" onCancel={(event) => { event.preventDefault(); if (!busy) close(); }} aria-label={title}>
    <header><h2>{title}</h2><button disabled={busy} onClick={close} aria-label={`关闭${title}`}>×</button></header>{children}
  </dialog>;
}
export default function ResourceCenterPage({ registerLeaveGuard }: { registerLeaveGuard?: (guard: ((leave: () => void) => void) | null) => void }) {
  const [status, setStatus] = useState<ResourceCenterStatus | null>(null), [settings, setSettings] = useState<ResourceCenterStatus['settings'] | null>(null);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState('');
  const [draft, setDraft] = useState<{ ids: string[]; original: string[]; revision: number } | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'selection' | 'check'; requestId: string; ids: string[]; revision: number } | null>(null);
  const [location, setLocation] = useState<{ path: string; freeBytes: number } | null>(null), [cleanup, setCleanup] = useState(false);
  const [details, setDetails] = useState<'records' | 'plan' | 'history' | 'repositories' | 'settings' | null>(null);
  const [audit, setAudit] = useState<{ total: number; items: ResourceAudit[] }>({ total: 0, items: [] });
  const [filter, setFilter] = useState({ sourceId: '', status: '', since: '', offset: 0 });
  const [history, setHistory] = useState<ResourceCenterStatus['history']>([]);
  const [repositories, setRepositories] = useState<{ total: number; items: ResourceCenterStatus['repositories'] }>({total:0,items:[]}), [repositoryOffset,setRepositoryOffset] = useState(0);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const api = window.jatoManagement!.resources;
  const refresh = async () => { try { const result = await api.status(); if (result.success && result.data) { setStatus(result.data); setSettings((value) => value || result.data!.settings); } else setMessage(result.message || '无法读取资源状态'); } catch(error) { setMessage(String(error)); } };
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 3000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (details !== 'records') return;
    let live = true;
    void api.audits({ ...filter, since: filter.since ? new Date(filter.since).getTime() : undefined, limit: 20 }).then((result) => { if (live && result.success && result.data) setAudit(result.data); else if (live && !result.success) setMessage(result.message || '无法读取审计'); }).catch((error) => { if(live) setMessage(String(error)); });
    return () => { live = false; };
  }, [details, filter]);
  useEffect(() => { if (details === 'history') void api.history().then((result) => { if (result.success && result.data) setHistory(result.data); else setMessage(result.message || '无法读取发布记录'); }).catch((error) => setMessage(String(error))); }, [details]);
  useEffect(() => { if (details === 'repositories') void api.repositoryRequests({offset:repositoryOffset,limit:20}).then((result) => { if(result.success && result.data) setRepositories(result.data); else setMessage(result.message || '无法读取申请'); }).catch((error) => setMessage(String(error))); },[details,repositoryOffset,status?.repositories]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (draft) { event.preventDefault(); } };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [draft]);
  useEffect(() => { registerLeaveGuard?.(draft ? (leave) => setLeaveAction(() => leave) : null); return () => registerLeaveGuard?.(null); }, [draft, registerLeaveGuard]);
  const act = async (operation: () => Promise<ManagementOperationResult>, success = '操作已完成') => {
    setBusy(true); setMessage('');
    try { const result = await operation(); setMessage(result.success ? success : result.message || '操作失败'); return result.success; }
    catch (error) { setMessage(error instanceof Error ? error.message : '资源操作失败'); return false; }
    finally { setBusy(false); await refresh(); }
  };
  if (!status || !settings) return <p role="status">{message || '正在读取资源中心…'}</p>;
  const enabled = status.sources.filter((source) => source.enabled).map((source) => source.sourceId);
  const selected = draft?.ids || enabled, changed = draft ? status.sources.filter((source) => draft.ids.includes(source.sourceId) !== draft.original.includes(source.sourceId)) : [];
  const tasks = status.tasks.filter((task) => ['queued', 'running'].includes(task.status));
  const openCheck = () => setConfirm({ kind: 'check', requestId: crypto.randomUUID(), ids: enabled, revision: status.settingsRevision });
  const sourceState = (source: ResourceCenterStatus['sources'][number]) => {
    if (!source.enabled) return '未启用';
    const task = status.tasks.find((task) => task.sourceId === source.sourceId);
    if (task?.status === 'completed') return task.resultJson && JSON.parse(task.resultJson).publishedChanges ? '已更新' : '已检查，无更新';
    if (task && ['queued', 'running', 'cancelled', 'interrupted'].includes(task.status)) return states[task.status];
    if (source.error) return source.hasMirror ? task?.status === 'partial' ? '部分资源待更新，现有资源可继续使用' : '更新未完成，现有资源可继续使用' : '资源暂不可用';
    return source.checkedAt ? '已检查，无更新' : '等待周计划';
  };
  return <section className="resource-center-page">
    <header className="resource-page-head"><div><h1>资源中心</h1><p>管理公共资源来源、同步任务与本地镜像</p></div><button onClick={() => setDetails('records')}>同步审计与只读计划</button></header>
    <article className="resource-card"><header><div><h2>公共资源同步</h2><p>固定每周一次 · 关闭窗口后驻托盘；退出服务或关机时停止</p></div><small>{status.running ? '调度运行中' : '调度未运行'}</small></header>
      <div className="resource-card-body resource-metrics"><span>镜像体积 <strong>{size(status.bytes)}</strong></span><span>可用空间 <strong>{status.freeBytes === null ? '资源盘不可用' : size(status.freeBytes)}</strong></span><span>资源目录 <strong>{status.count} 项</strong></span><span>已启用来源 <strong>{enabled.length} / {status.sources.length}</strong></span></div>
      {status.unavailable && <p className="resource-card-body" role="alert">{status.unavailable}。授权与统计服务继续运行，可更换资源目录或网络设置后重试。</p>}
    </article>
    {message && <p className="form-message" role="status">{message}</p>}
    <article className="resource-card"><header><h2>公共来源</h2><div className="resource-actions"><input aria-label="搜索来源" placeholder="搜索来源" value={query} onChange={(event) => setQuery(event.target.value)} /><button disabled={!enabled.length} onClick={openCheck}>检查已启用来源</button></div></header>
      <div className="resource-table-wrap"><table className="resource-table"><thead><tr><th>来源</th><th>启用</th><th>状态</th><th>最近检查</th><th>操作</th></tr></thead><tbody>
        {status.sources.filter((source) => source.name.toLowerCase().includes(query.toLowerCase())).map((source) => <tr key={source.sourceId}><td>{source.name}</td><td><input type="checkbox" aria-label={`启用${source.name}`} checked={selected.includes(source.sourceId)} onChange={(event) => {
          const base = draft || { ids: enabled, original: enabled, revision: status.settingsRevision };
          const ids = event.target.checked ? [...base.ids, source.sourceId] : base.ids.filter((id) => id !== source.sourceId);
          setDraft(ids.length === base.original.length && ids.every((id) => base.original.includes(id)) ? null : { ...base, ids });
        }} /></td><td>{sourceState(source)}</td><td>{date(source.checkedAt)}</td><td><div className="resource-actions"><button onClick={() => { setFilter({ sourceId: source.sourceId, status: '', since: '', offset: 0 }); setDetails('records'); }}>详情</button>{tasks.some((task) => task.sourceId === source.sourceId) && <button onClick={() => void act(() => api.cancel(source.sourceId), '已请求停止，保留现有镜像')}>停止本次</button>}</div></td></tr>)}
      </tbody></table></div>
      {draft && <footer className="resource-selection"><span>已修改 {changed.length} 个来源 · 尚未开始下载</span><div className="resource-actions"><button onClick={() => setDraft(null)}>取消修改</button><button className="primary-button" disabled={busy || !changed.length} onClick={() => setConfirm({ kind: 'selection', requestId: crypto.randomUUID(), ids: draft.ids, revision: draft.revision })}>确认并加入队列</button></div></footer>}
      {tasks.length > 0 && <footer className="resource-selection"><span>{tasks.filter((task) => task.status === 'running').length} 个来源正在同步 · {tasks.filter((task) => task.status === 'queued').length} 个等待</span><button onClick={() => setDetails('records')}>查看任务</button></footer>}
    </article>
    <div className="resource-lower-grid"><article className="resource-card"><header><h2>资源存储与网络</h2><button onClick={() => setDetails('settings')}>设置</button></header><div className="resource-card-body"><p>镜像目录：{status.settings.root}</p><p>网络：{status.settings.networkMode === 'proxy' ? '管理端专用代理' : '使用系统网络设置'}</p><p>专用于公共资源获取，不改变局域网授权与统计网络。</p></div></article>
      <div className="resource-record-stack"><article className="resource-card"><header><h2>发布记录</h2><button onClick={() => setDetails('history')}>查看记录</button></header><div className="resource-card-body">{status.history.length ? status.history.map((release) => <p key={release.version}>{date(release.createdAt)} · {JSON.parse(release.changesJson).length} 项有效变化</p>) : <p>尚无已发布内容</p>}</div></article>
      <article className="resource-card"><header><h2>技能仓库获取申请</h2><button onClick={() => setDetails('repositories')}>查看申请</button></header><div className="resource-card-body"><p>{status.repositoryPending} 项待处理 · 准入获取不代表授权执行</p></div></article></div></div>
    {details === 'settings' && <ResourceDialog title="资源存储与网络设置" close={() => setDetails(null)} busy={busy}><div className="resource-card-body">
      <form className="resource-settings" onSubmit={(event) => { event.preventDefault(); void act(() => api.configure(settings)); }}>
        <label>镜像目录<div className="resource-actions"><input value={settings.root} readOnly /><button type="button" disabled={busy} onClick={() => void api.chooseDirectory().then((result) => { if (result.success && result.data) { if (result.data.systemVolume) setLocation(result.data); else setSettings({ ...settings, root: result.data.path }); } else if (!result.success) setMessage(result.message || '目录检查失败'); }).catch((error) => setMessage(String(error)))}>选择目录</button></div></label>
        <div className="resource-settings-pair"><label>配额（GB）<input type="number" min="1" value={settings.quotaBytes / 1024 ** 3} onChange={(event) => setSettings({ ...settings, quotaBytes: Number(event.target.value) * 1024 ** 3 })} /></label><label>网络<select value={settings.networkMode} onChange={(event) => setSettings({ ...settings, networkMode: event.target.value })}><option value="system">使用系统网络设置</option><option value="proxy">管理端专用代理</option></select></label></div>
        {settings.networkMode === 'proxy' && <label>代理地址<input value={settings.proxyRules} onChange={(event) => setSettings({ ...settings, proxyRules: event.target.value })} placeholder="http://127.0.0.1:7890" /></label>}
        <div className="resource-actions"><button className="primary-button" type="submit" disabled={busy}>保存资源设置</button><button type="button" disabled={busy} onClick={() => setCleanup(true)}>清理无任务占用的暂存</button></div>
      </form>
    </div><footer><button disabled={busy} onClick={() => setDetails(null)}>关闭</button></footer></ResourceDialog>}
    {leaveAction && !confirm && <ResourceDialog title="来源选择尚未确认" close={() => setLeaveAction(null)}><div className="resource-card-body"><p>离开前可确认并排队，也可放弃本次草稿；现有镜像保持。</p></div><footer><button onClick={() => setLeaveAction(null)}>继续编辑</button><button onClick={() => { setDraft(null); leaveAction(); }}>放弃草稿并离开</button><button className="primary-button" onClick={() => draft && setConfirm({ kind: 'selection', requestId: crypto.randomUUID(), ids: draft.ids, revision: draft.revision })}>确认并排队后离开</button></footer></ResourceDialog>}
    {confirm && <ResourceDialog title={confirm.kind === 'selection' ? '批量来源确认' : '本次检查范围'} busy={busy} close={() => setConfirm(null)}>
      <div className="resource-card-body">{confirm.kind === 'selection' ? <><p>确认后统一加入持久后台队列，来源依次同步，后续固定每7天检查。</p>{changed.map((source) => <p key={source.sourceId}>{source.name}：{confirm.ids.includes(source.sourceId) ? '启用并排队' : source.running ? '停用并停止当前同步，保留旧镜像' : '停用并撤销未开始任务，保留旧镜像'}</p>)}</> : <><p>仅检查本次所选已启用来源，不修改启用设置或周锚点。</p>{status.sources.filter((source) => source.enabled).map((source) => <label className="resource-check" key={source.sourceId}><input type="checkbox" checked={confirm.ids.includes(source.sourceId)} onChange={(event) => setConfirm({ ...confirm, ids: event.target.checked ? [...confirm.ids, source.sourceId] : confirm.ids.filter((id) => id !== source.sourceId) })} />{source.name}</label>)}</>}</div>
      <footer><button disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className="primary-button" disabled={busy || confirm.kind === 'check' && !confirm.ids.length} onClick={() => void act(() => confirm.kind === 'selection' ? api.applySelection({ requestId: confirm.requestId, expectedSettingsRevision: confirm.revision, enabledSourceIds: confirm.ids }) : api.enqueueChecks({ requestId: confirm.requestId, sourceIds: confirm.ids }), '已受理并加入队列，可继续其他操作').then((success) => { if (success) { if (confirm.kind === 'selection') { setDraft(null); leaveAction?.(); setLeaveAction(null); } setConfirm(null); } })}>确认加入队列</button></footer>
    </ResourceDialog>}
    {details && details !== 'settings' && <ResourceDialog title={details === 'history' ? '发布记录' : details === 'repositories' ? '技能仓库获取申请' : '同步审计与只读计划'} close={() => setDetails(null)}>
      <div className="resource-card-body">{['records', 'plan'].includes(details) && <nav className="resource-actions"><button aria-current={details === 'records'} onClick={() => setDetails('records')}>运行记录</button><button aria-current={details === 'plan'} onClick={() => setDetails('plan')}>周计划</button></nav>}
        {details === 'plan' && <><p>固定每7天一次 · 手动检查与重试不改变锚点 · 退出服务或关机时停止</p>{status.sources.map((source) => <div className="resource-audit-item" key={source.sourceId}><strong>{source.name} · {source.enabled ? '已启用' : '未启用'}</strong><p>周期锚点：{date(source.anchorAt, '尚未初始化')} · 下次检查：{date(source.nextDueAt, '尚未初始化')}</p><p>最近完整成功：{date(source.successAt, '暂无完整成功记录')}</p></div>)}</>}
        {details === 'records' && <><div className="resource-actions resource-audit-filters"><select aria-label="审计来源" value={filter.sourceId} onChange={(event) => setFilter({ ...filter, sourceId: event.target.value, offset: 0 })}><option value="">全部来源</option>{status.sources.map((source) => <option key={source.sourceId} value={source.sourceId}>{source.name}</option>)}</select><select aria-label="审计结果" value={filter.status} onChange={(event) => setFilter({ ...filter, status: event.target.value, offset: 0 })}><option value="">全部结果</option>{['ITEM_FAILED', 'PARTIAL', 'FAILED', 'CHECKED', 'CANCELLED', 'PUBLISHED'].map((value) => <option key={value} value={value}>{({ ITEM_FAILED: '条目未完成', PARTIAL: '部分待更新', FAILED: '未完成', CHECKED: '已检查', CANCELLED: '已停止', PUBLISHED: '有效内容发布' })[value as 'FAILED']}</option>)}</select><input type="date" aria-label="审计起始日期" value={filter.since} onChange={(event) => setFilter({ ...filter, since: event.target.value, offset: 0 })} /></div>
          {audit.items.map((item) => <article className="resource-audit-item" key={item.id}><strong>{date(item.occurredAt)} · {status.sources.find((source) => source.sourceId === item.sourceId)?.name || '资源中心'}</strong><p>{({ ITEM_FAILED: '条目未完成，原因见脱敏技术详情', PARTIAL: '部分资源待更新，完整成功时间尚未推进', CHECKED: '本次检查完成', FAILED: '本次更新未完成，保留旧快照', CANCELLED: '本次同步已停止', QUEUED: '已加入持久队列', PUBLISHED: '已发布有效业务变化' } as Record<string, string>)[item.status] || '资源操作记录'}</p><details><summary>技术详情</summary><pre>{JSON.stringify(JSON.parse(item.detailJson), null, 2)}</pre></details>{['ITEM_FAILED', 'PARTIAL', 'FAILED'].includes(item.status) && status.sources.some((source) => source.sourceId === item.sourceId && source.enabled) && <button disabled={busy} onClick={() => void act(() => api.enqueueChecks({ requestId: crypto.randomUUID(), sourceIds: [item.sourceId!], retryFailed: true }), '失败条目重试已加入队列')}>重试失败条目</button>}</article>)}
          {!audit.items.length && <p>当前筛选暂无记录</p>}<div className="resource-actions"><button disabled={!filter.offset} onClick={() => setFilter({ ...filter, offset: Math.max(0, filter.offset - 20) })}>上一页</button><span>{audit.total} 条记录</span><button disabled={filter.offset + 20 >= audit.total} onClick={() => setFilter({ ...filter, offset: filter.offset + 20 })}>下一页</button><button onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(audit.items, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = '资源脱敏诊断.json'; link.click(); URL.revokeObjectURL(url); }}>导出本页脱敏诊断</button></div></>}
        {details === 'history' && <>{history.map((release) => <p key={release.version}>{date(release.createdAt)} · {JSON.parse(release.changesJson).length} 项有效变化</p>)}{!history.length && <p>尚无有效内容发布</p>}</>}
        {details === 'repositories' && <><p>获取公开仓库候选与安装/执行授权分开；固定提交并校验完整包。</p>{repositories.items.map((item) => <article className="resource-audit-item" key={item.requestId}><strong>{JSON.parse(item.locatorJson).repo} / {JSON.parse(item.locatorJson).root || '自动识别技能目录'}</strong><p>{({ pending: '待处理', downloading: '已排队或正在获取', ready: '候选已准备', rejected: '已拒绝', failed: '获取未完成' } as Record<string, string>)[item.status] || item.status}</p><div className="resource-actions"><button disabled={busy || ['downloading', 'ready', 'rejected'].includes(item.status)} onClick={() => void act(() => api.repositoryDecision({ requestId: item.requestId, approve: true }), '已准入并排队获取')}>{item.status === 'failed' ? '重试获取' : '准入并排队获取'}</button><button disabled={busy || item.status !== 'pending'} onClick={() => void act(() => api.repositoryDecision({ requestId: item.requestId, approve: false }))}>拒绝</button></div></article>)}{!repositories.total && <p>暂无申请</p>}<div className="resource-actions"><button disabled={!repositoryOffset} onClick={() => setRepositoryOffset(Math.max(0,repositoryOffset-20))}>上一页</button><span>{repositories.total} 项申请</span><button disabled={repositoryOffset+20 >= repositories.total} onClick={() => setRepositoryOffset(repositoryOffset+20)}>下一页</button></div></>}
      </div><footer><button onClick={() => setDetails(null)}>关闭</button></footer>
    </ResourceDialog>}
    {location && <ResourceDialog title="所选镜像位置位于系统盘" close={() => setLocation(null)}><div className="resource-card-body"><p>{location.path} · 可用 {size(location.freeBytes)}。建议选择非系统盘，原镜像保持。</p></div><footer><button onClick={() => setLocation(null)}>重新选择（推荐）</button><button onClick={() => { setSettings({ ...settings, root: location.path }); setLocation(null); }}>仍然使用</button></footer></ResourceDialog>}
    {cleanup && <ResourceDialog title="确认清理暂存？" close={() => setCleanup(false)} busy={busy}><div className="resource-card-body"><p>仅清理无任务占用的中断下载和过期预览候选；镜像、历史、授权数据库与凭据保留。</p></div><footer><button disabled={busy} onClick={() => setCleanup(false)}>取消</button><button disabled={busy} onClick={() => void act(() => api.cleanup({ confirmed: true })).then((success) => { if (success) setCleanup(false); })}>确认清理暂存</button></footer></ResourceDialog>}
  </section>;
}
