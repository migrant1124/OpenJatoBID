import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import type { PptProject } from '../../shared/types/ipc';
import { useToast } from '../../shared/ui';

export function PptProjectTools({ project, onRefresh, disabled = false }: { disabled?: boolean; project: PptProject; onRefresh: () => Promise<unknown> }) {
  const api = window.yibiao!.ppt, { showToast } = useToast();
  const [action, setAction] = useState<'history' | 'move' | 'personal' | 'cache' | 'rename' | null>(null);
  const [name, setName] = useState(project.title), [directory, setDirectory] = useState(''), [system, setSystem] = useState(false), [acceptedSystem, setAcceptedSystem] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(''), [busy, setBusy] = useState(false), [cache, setCache] = useState<{ root: string; bytes: number } | null>(null);
  const [clearCache, setClearCache] = useState(false);
  const running = disabled || project.jobs.some((job) => ['running', 'queued'].includes(job.status));
  async function run(callback: () => Promise<unknown>) { setBusy(true); try { await callback(); await onRefresh(); } catch (error) { showToast(String(error), 'error'); } finally { setBusy(false); } }
  async function choose() { const value = await api.selectDirectory(); if (value) { setDirectory(value.path); setSystem(value.systemVolume); setAcceptedSystem(!value.systemVolume); } }
  function open(next: typeof action) { setName(project.title); setDirectory(''); setSystem(false); setAcceptedSystem(false); setAction(next); if (next === 'cache') void run(async () => setCache(await window.yibiao!.resources.cacheStatus())); }
  return <><div className="ppt-actions"><button disabled={running} onClick={() => open('rename')}>重命名</button><button disabled={running} onClick={() => open('history')}>历史与恢复</button><button disabled={running} onClick={() => open('move')}>迁移项目</button><button disabled={running || !project.pages.length} onClick={() => open('personal')}>保存为我的模板</button><button onClick={() => open('cache')}>资源缓存位置</button></div>
    <Dialog.Root open={Boolean(action)} onOpenChange={(value) => { if (!value && !busy) setAction(null); }}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog"><header><Dialog.Title>{action === 'rename' ? '重命名项目' : action === 'history' ? '历史版本' : action === 'move' ? '迁移项目' : action === 'personal' ? '保存个人模板' : '资源缓存位置'}</Dialog.Title><Dialog.Close disabled={busy} aria-label="关闭项目操作">×</Dialog.Close></header><Dialog.Description>{action === 'rename' ? '名称保存在当前项目，目录和外部原件保持。' : action === 'history' ? '恢复会创建新修订，现稿保存在历史中。' : action === 'move' ? '停写后复制、校验，再切换索引；原目录副本保留。' : action === 'personal' ? '重新检查并导出项目副本，公共模板不会受影响。' : '复制并校验缓存后切换位置，旧文件保留。'}</Dialog.Description>
      {action === 'rename' ? <><label>项目名称<input value={name} onChange={(event) => setName(event.target.value)} /></label><button disabled={busy || !name.trim()} onClick={() => void run(async () => { await api.rename({ projectId: project.projectId, revision: project.revision, title: name }); setAction(null); })}>保存名称</button></> : action === 'history' ? <><select aria-label="历史修订" value={historyRevision} onChange={(event) => setHistoryRevision(event.target.value)}><option value="">选择历史</option>{project.history.map((item) => <option key={item.revision} value={item.revision}>修订 {item.revision} · {new Date(item.createdAt).toLocaleString()}</option>)}</select><button disabled={busy || !historyRevision} onClick={() => void run(async () => { await api.restore({ projectId: project.projectId, revision: project.revision, historyRevision: Number(historyRevision) }); setAction(null); })}>恢复所选版本</button></> : <>
        {action === 'cache' && <><p>当前位置：{cache?.root}<br />索引登记原始缓存 {((cache?.bytes || 0) / 1024 ** 2).toFixed(1)} MB</p><button disabled={busy} onClick={() => setClearCache(true)}>清理当前本地资源缓存</button>{clearCache && <section className="ppt-confirm-card"><strong>清理本地缓存？</strong><p>只清理当前缓存目录中的资源副本。管理端镜像、已复制到项目中的文件和迁移后留下的旧目录均保留；再次使用需重新获取。</p><button onClick={() => setClearCache(false)}>取消</button><button disabled={busy} onClick={() => void run(async () => { const value = await window.yibiao!.resources.clearCache({ confirmed: true }); setCache(await window.yibiao!.resources.cacheStatus()); setClearCache(false); showToast(`已清理 ${(value.releasedBytes / 1024 ** 2).toFixed(1)} MB 当前副本`, 'success'); })}>确认清理当前缓存</button></section>}</>}
        {action === 'personal' && <label>模板名称<input value={name} onChange={(event) => setName(event.target.value)} /></label>}
        <label>目标父目录<input value={directory} readOnly /><button disabled={busy} onClick={() => void run(choose)}>选择目录</button></label>
        {system && !acceptedSystem && <section className="ppt-confirm-card"><strong>所选位置在系统盘</strong><p>页面、图片和历史可能持续占用空间，建议选择非系统盘。</p><button onClick={() => void run(choose)}>重新选择（推荐）</button><button onClick={() => setAcceptedSystem(true)}>仍然使用</button></section>}
        <button className="image-studio-primary" disabled={busy || !directory || !acceptedSystem || action === 'personal' && !name.trim()} onClick={() => void run(async () => {
          if (action === 'move') await api.relocate({ projectId: project.projectId, revision: project.revision, parent: directory, confirmed: true });
          else if (action === 'personal') await api.savePersonalTemplate({ projectId: project.projectId, revision: project.revision, title: name, parent: directory, confirmed: true });
          else await window.yibiao!.resources.configureCache({ parent: directory });
          setAction(null);
        })}>确认{action === 'move' ? '迁移' : action === 'personal' ? '保存模板' : '迁移缓存'}</button>
      </>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
