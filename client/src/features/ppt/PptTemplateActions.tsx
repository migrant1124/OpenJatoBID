import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import type { PptProject, YibiaoBridge } from '../../shared/types/ipc';
import { useToast } from '../../shared/ui';

export function PptTemplateButton({ project, ratio, resourceId, templateId, local, beautify, disabled, onPrepared }: { project: PptProject | null; ratio?: string | number; resourceId?: string; templateId?: string; local?: boolean; beautify?: boolean; disabled?: boolean; onPrepared: () => Promise<unknown> }) {
  const { showToast } = useToast();
  const [choose, setChoose] = useState(false), [busy, setBusy] = useState(false);
  const [localFile, setLocalFile] = useState<{ filePath: string; aspectRatio: string } | null>(null);
  const actualRatio = localFile?.aspectRatio || (typeof ratio === 'number' ? Math.abs(ratio - 4 / 3) < .02 ? '4:3' : Math.abs(ratio - 16 / 9) < .02 ? '16:9' : String(ratio) : ratio);
  async function prepare(ratioDecision: 'keep' | 'reflow', filePath = localFile?.filePath) { if (!project) return; setBusy(true); try { await window.yibiao!.ppt.prepareTemplate({ projectId: project.projectId, revision: project.revision, resourceId, templateId, filePath, preserveContent: local, beautify, ratioDecision }); setChoose(false); setLocalFile(null); await onPrepared(); } catch (error) { showToast(String(error), 'error'); } finally { setBusy(false); } }
  async function select() {
    if (!project) return;
    if (!local) { if (project.pages.length || !actualRatio || actualRatio !== project.requirements.aspectRatio) setChoose(true); else await prepare('keep'); return; }
    setBusy(true);
    try { const filePath = await window.yibiao!.ppt.selectPpt(); if (!filePath) return; const structure = await window.yibiao!.ppt.inspectTemplate(filePath); setLocalFile({ filePath, aspectRatio: structure.aspectRatio }); if (project.pages.length || structure.aspectRatio !== project.requirements.aspectRatio) setChoose(true); else await prepare('keep', filePath); }
    catch (error) { showToast(String(error), 'error'); } finally { setBusy(false); }
  }
  return <><button disabled={disabled || busy || !project} onClick={() => void select()}>{!project ? '先新建或打开项目' : local ? beautify ? '保留原文重新美化' : '导入自己的旧 PPT' : '准备并检查此模板'}</button>
    <Dialog.Root open={choose} onOpenChange={setChoose}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog"><Dialog.Title>确认模板与画幅</Dialog.Title><Dialog.Description>模板为 {actualRatio || '待检查比例'}，项目要求 {String(project?.requirements.aspectRatio || '尚未指定')}。保持原画幅不会拉伸；重新布局会进入新稿制作路线，需要重新规划与确认。{project?.pages.length ? `当前${project.pages.length}页会进入历史，准备成功后以所选模板开始新修订；可从历史恢复。` : ''}</Dialog.Description><div className="ppt-actions"><button disabled={busy} onClick={() => void prepare('keep')}>确认替换，保持模板原画幅</button><button disabled={busy} onClick={() => void prepare('reflow')}>确认替换，按项目画幅重新布局</button><Dialog.Close disabled={busy}>取消</Dialog.Close></div></Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}

type PersonalTemplate = Awaited<ReturnType<YibiaoBridge['ppt']['personalTemplates']>>[number];
export function PptTemplateCacheButton({ resourceId, title }: { resourceId: string; title: string }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false); const { showToast } = useToast();
  return <><button onClick={() => setOpen(true)}>清理本地缓存</button><Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog"><Dialog.Title>清理 {title} 的本地缓存？</Dialog.Title><Dialog.Description>只删除当前缓存副本；公共镜像、个人模板和项目内已复制的原件保留。该资源可再次从管理端获取。</Dialog.Description><Dialog.Close disabled={busy}>取消</Dialog.Close><button disabled={busy} onClick={() => { setBusy(true); void window.yibiao!.resources.clearCache({ resourceId, confirmed: true }).then((value) => { showToast(`已清理 ${(value.releasedBytes / 1024 ** 2).toFixed(1)} MB`, 'success'); setOpen(false); }).catch((error) => showToast(String(error), 'error')).finally(() => setBusy(false)); }}>确认清理副本</button></Dialog.Content></Dialog.Portal></Dialog.Root></>;
}
export function PptInsertLayoutButton({ project, resourceId, disabled, onPrepared }: { project: PptProject | null; resourceId: string; disabled?: boolean; onPrepared: () => Promise<unknown> }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false); const { showToast } = useToast();
  return <><button disabled={!project || disabled || busy} onClick={() => setOpen(true)}>插入单页视觉参考</button><Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog"><Dialog.Title>在当前项目增加单页？</Dialog.Title><Dialog.Description>保留已有页与原生对象，在项目画幅下增加待制作页，并复制此版式作为视觉参考。不会把跨模板母版和旧事实直接写进当前稿件；确认新增页内容后，让 Agent 仅制作该页。</Dialog.Description><Dialog.Close disabled={busy}>取消</Dialog.Close><button disabled={busy} onClick={() => { setBusy(true); void window.yibiao!.ppt.insertLayout({ projectId: project!.projectId, revision: project!.revision, resourceId }).then(async () => { setOpen(false); await onPrepared(); }).catch((error) => showToast(String(error), 'error')).finally(() => setBusy(false)); }}>确认增加并准备参考</button></Dialog.Content></Dialog.Portal></Dialog.Root></>;
}
export function PptPersonalTemplates({ project, query, ratio, onPrepared }: { project: PptProject | null; query: string; ratio: string; onPrepared: () => Promise<unknown> }) {
  const [items, setItems] = useState<PersonalTemplate[]>([]), [preview, setPreview] = useState<PersonalTemplate | null>(null), [remove, setRemove] = useState<PersonalTemplate | null>(null);
  const { showToast } = useToast();
  async function refresh() { try { setItems(await window.yibiao!.ppt.personalTemplates()); } catch (error) { showToast(String(error), 'error'); } }
  useEffect(() => { void refresh(); }, []);
  return <><div className="ppt-template-grid">{items.filter((item) => item.title.includes(query) && (!ratio || item.aspectRatio === ratio)).map((item) => <article key={item.templateId}><button aria-label={`预览 ${item.title}`} onClick={() => setPreview(item)}>{item.coverUrl ? <img style={{ width: '100%', aspectRatio: item.aspectRatio === '4:3' ? '4/3' : '16/9', objectFit: 'contain' }} src={item.coverUrl} alt={item.title} /> : '预览文件不可用'}</button><div className="ppt-template-copy"><strong>{item.title}</strong><small>{item.pageCount} 页 · {item.aspectRatio} · 个人模板</small><PptTemplateButton project={project} ratio={item.aspectRatio} templateId={item.templateId} disabled={project?.jobs.some((job) => job.status === 'running')} onPrepared={onPrepared} /><button onClick={() => setRemove(item)}>删除个人模板副本</button></div></article>)}</div>{!items.length && <p className="ppt-empty">尚无个人模板。可从制作工作区的已检查项目保存。</p>}
    <Dialog.Root open={Boolean(preview)} onOpenChange={(open) => { if (!open) setPreview(null); }}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog"><header><Dialog.Title>{preview?.title}</Dialog.Title><Dialog.Close aria-label="关闭个人模板大图">×</Dialog.Close></header><Dialog.Description>{preview?.aspectRatio} · {preview?.pageCount} 页，完整首页</Dialog.Description>{preview?.coverUrl && <img style={{ width: '100%', objectFit: 'contain' }} src={preview.coverUrl} alt={preview.title} />}</Dialog.Content></Dialog.Portal></Dialog.Root>
    <Dialog.Root open={Boolean(remove)} onOpenChange={(open) => { if (!open) setRemove(null); }}><Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="ppt-form-dialog"><Dialog.Title>删除个人模板 {remove?.title}？</Dialog.Title><Dialog.Description>只移入回收站此安装副本；已经复制到项目中的文件保留，磁盘空间不会立即释放。</Dialog.Description><p>{remove?.root}</p><Dialog.Close>取消</Dialog.Close><button onClick={() => { void window.yibiao!.ppt.removePersonalTemplate({ templateId: remove!.templateId, confirmed: true }).then(async () => { setRemove(null); await refresh(); }).catch((error) => showToast(String(error), 'error')); }}>确认移入回收站</button></Dialog.Content></Dialog.Portal></Dialog.Root>
  </>;
}
