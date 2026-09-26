import { useEffect, useState } from 'react';
import { BookmarkPlus, Check, Copy, Heart, Pencil, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import type { ImageStudioMyPrompt, ImageStudioReferenceItem, ImageStudioSource, ImageStudioStyle, PromptGroup } from '../../../shared/types/ipc';
import { useToast } from '../../../shared/ui';

type Tab = 'references' | 'mine' | 'styles';

export function ImageStudioPrompts({ applyPrompt, currentPrompt }: { applyPrompt: (text: string) => void; currentPrompt: string }) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>('references');
  const [sources, setSources] = useState<ImageStudioSource[]>([]);
  const [items, setItems] = useState<ImageStudioReferenceItem[]>([]);
  const [myPrompts, setMyPrompts] = useState<ImageStudioMyPrompt[]>([]);
  const [styles, setStyles] = useState<ImageStudioStyle[]>([]);
  const [groups, setGroups] = useState<PromptGroup[]>([]);
  const [selectedSource, setSelectedSource] = useState('');
  const [selectedItem, setSelectedItem] = useState<ImageStudioReferenceItem | null>(null);
  const [query, setQuery] = useState('');
  const [managerOpen, setManagerOpen] = useState(false);
  const [sourceDraft, setSourceDraft] = useState<Partial<ImageStudioSource> | null>(null);
  const [sourceCheck, setSourceCheck] = useState<{ url: string; count: number } | null>(null);
  const [checkingUrl, setCheckingUrl] = useState(false);
  const [busySource, setBusySource] = useState('');
  const [promptDraft, setPromptDraft] = useState<Partial<ImageStudioMyPrompt> | null>(null);
  const [styleDraft, setStyleDraft] = useState<Partial<ImageStudioStyle> | null>(null);
  const [groupName, setGroupName] = useState('');
  const [renamingGroupId, setRenamingGroupId] = useState('');
  const [offset, setOffset] = useState(0);

  async function reload() {
    const [nextSources, nextPrompts, nextStyles, nextGroups] = await Promise.all([
      window.yibiao!.imageStudio.listSources(), window.yibiao!.imageStudio.listMyPrompts(),
      window.yibiao!.imageStudio.listStyles(), window.yibiao!.promptLibrary.listGroups(),
    ]);
    setSources(nextSources); setMyPrompts(nextPrompts); setStyles(nextStyles); setGroups(nextGroups);
  }

  useEffect(() => { void reload().catch((error) => showToast(String(error), 'error')); }, [showToast]);
  useEffect(() => {
    if (tab !== 'references') return;
    void window.yibiao!.imageStudio.listReferenceItems({ sourceId: selectedSource, query, limit: 40, offset })
      .then(setItems).catch((error) => showToast(String(error), 'error'));
  }, [tab, selectedSource, query, offset, sources, showToast]);

  async function sourceAction(sourceId: string, action: 'check' | 'refresh' | 'delete' | 'restore' | 'toggle') {
    setBusySource(sourceId);
    try {
      const source = sources.find((item) => item.sourceId === sourceId);
      if (action === 'check') {
        const result = await window.yibiao!.imageStudio.checkSource(sourceId);
        showToast(`地址有效，共 ${result.count} 条；尚未更新本地内容。`, 'success');
      } else if (action === 'refresh') {
        let result;
        try { result = await window.yibiao!.imageStudio.refreshSource(sourceId); }
        catch (error) {
          if (!String(error).includes('版本无可比较顺序') ||
            !window.confirm('来源内容已变化但缺少可比较的版本号。确认用新内容替换当前来源快照？个人副本不会改变。')) throw error;
          result = await window.yibiao!.imageStudio.refreshSource(sourceId, { confirmedReplace: true });
        }
        showToast(result.unchanged ? '内容没有变化' : `已载入 ${result.count} 条，其中 ${result.untranslated || 0} 条待中文化`, 'success');
      } else if (action === 'delete') {
        if (!window.confirm(`删除来源“${source?.name || sourceId}”？个人副本和作品不会删除。`)) return;
        await window.yibiao!.imageStudio.deleteSource(sourceId);
      } else if (action === 'restore') {
        await window.yibiao!.imageStudio.restoreSource(sourceId);
      } else if (source) {
        await window.yibiao!.imageStudio.saveSource({ sourceId, enabled: !source.enabled });
      }
      await reload();
    } catch (error) { showToast(String(error), 'error'); }
    finally { setBusySource(''); }
  }

  async function saveSource() {
    if (!sourceDraft) return;
    try {
      await window.yibiao!.imageStudio.saveSource(sourceDraft);
      setSourceDraft(null); await reload(); showToast('来源设置已保存', 'success');
    } catch (error) { showToast(String(error), 'error'); }
  }

  async function checkDraftSourceUrl() {
    const url = sourceDraft?.url?.trim();
    if (!url) return;
    setCheckingUrl(true);
    try {
      const result = await window.yibiao!.imageStudio.checkSourceUrl(url);
      setSourceCheck({ url, count: result.count });
    } catch (error) { showToast(String(error), 'error'); }
    finally { setCheckingUrl(false); }
  }

  async function saveReference(item: ImageStudioReferenceItem) {
    try {
      await window.yibiao!.imageStudio.saveMyPrompt({ title: item.title, contentMarkdown: item.prompt,
        tags: item.tags, originKind: 'reference', originSourceId: item.sourceId,
        originItemId: item.itemId, originVersion: sources.find((source) => source.sourceId === item.sourceId)?.contentHash || '' });
      await reload(); showToast('已保存个人副本', 'success');
    } catch (error) { showToast(String(error), 'error'); }
  }

  async function savePersonal() {
    if (!promptDraft) return;
    try {
      await window.yibiao!.imageStudio.saveMyPrompt({
        promptId: promptDraft.promptId, groupId: promptDraft.groupId,
        title: promptDraft.title || '未命名提示词', contentMarkdown: promptDraft.contentMarkdown || '',
        tags: promptDraft.tags || [], notes: promptDraft.notes || '', ratio: promptDraft.ratio || '',
      });
      setPromptDraft(null); await reload(); showToast('提示词已保存', 'success');
    } catch (error) { showToast(String(error), 'error'); }
  }

  async function deletePersonal(item: ImageStudioMyPrompt) {
    if (!window.confirm(`删除“${item.title}”？`)) return;
    try { await window.yibiao!.promptLibrary.deletePrompt({ promptId: item.promptId }); await reload(); }
    catch (error) { showToast(String(error), 'error'); }
  }

  async function toggleFavorite(item: ImageStudioMyPrompt) {
    try { await window.yibiao!.promptLibrary.setFavorite({ promptId: item.promptId, isFavorite: !item.isFavorite }); await reload(); }
    catch (error) { showToast(String(error), 'error'); }
  }

  async function saveStyle() {
    if (!styleDraft) return;
    try { setStyles(await window.yibiao!.imageStudio.saveStyle(styleDraft)); setStyleDraft(null); showToast('风格已保存', 'success'); }
    catch (error) { showToast(String(error), 'error'); }
  }

  async function createGroup() {
    try {
      if (renamingGroupId) await window.yibiao!.promptLibrary.updateGroup({ groupId: renamingGroupId, groupName });
      else await window.yibiao!.promptLibrary.createGroup({ groupName });
      setGroupName(''); setRenamingGroupId(''); await reload();
    }
    catch (error) { showToast(String(error), 'error'); }
  }

  return <section className="image-studio-library image-studio-prompt-center">
    <div className="image-studio-library-head"><div><h2>提示词中心</h2><p>参考、个人积累与常用风格</p></div><div className="image-studio-segments"><button type="button" aria-pressed={tab === 'references'} onClick={() => setTab('references')}>参考提示词</button><button type="button" aria-pressed={tab === 'mine'} onClick={() => setTab('mine')}>我的提示词</button><button type="button" aria-pressed={tab === 'styles'} onClick={() => setTab('styles')}>常用风格</button></div></div>
    {tab === 'references' && <div className="image-studio-library-layout">
      <aside className="image-studio-source-rail"><div className="image-studio-panel-head"><h3>来源</h3><button type="button" title="管理来源" aria-label="管理来源" onClick={() => setManagerOpen(true)}><Settings2 size={17} /></button></div><button type="button" className={!selectedSource ? 'active' : ''} onClick={() => { setSelectedSource(''); setOffset(0); }}>全部参考</button>{sources.filter((source) => source.enabled).map((source) => <button type="button" key={source.sourceId} className={selectedSource === source.sourceId ? 'active' : ''} onClick={() => { setSelectedSource(source.sourceId); setOffset(0); }}>{source.name}<small>{source.itemCount}</small></button>)}</aside>
      <div className="image-studio-reference-main"><div className="image-studio-list-tools"><input aria-label="搜索参考提示词" placeholder="搜索参考提示词" value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} /><button type="button" onClick={() => setManagerOpen(true)}><Settings2 size={16} /> 管理来源</button></div>
        {!items.length && <div className="image-studio-library-empty"><p>当前没有可浏览的本地参考条目。</p><span>来源元数据已预置；内容需在权利确认后随包分发，或由用户主动从来源更新。</span></div>}
        <div className="image-studio-reference-grid">{items.map((item) => <article key={item.itemId} className="image-studio-reference-card"><div className="image-studio-reference-preview">{item.coverUrl ? <span>图片预览未随包分发</span> : <span>无示例图</span>}</div><strong>{item.title}</strong><p>{item.prompt}</p><small>{sources.find((source) => source.sourceId === item.sourceId)?.name || item.sourceId}</small><footer><button type="button" onClick={() => setSelectedItem(item)}>详情</button><button type="button" onClick={() => applyPrompt(item.prompt)}>用于生成</button></footer></article>)}</div>
        <div className="image-studio-pagination"><button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 40))}>上一页</button><span>第 {Math.floor(offset / 40) + 1} 页</span><button type="button" disabled={items.length < 40} onClick={() => setOffset(offset + 40)}>下一页</button></div>
      </div>
    </div>}
    {tab === 'mine' && <div className="image-studio-personal-layout"><div className="image-studio-list-tools"><h3>我的提示词 <small>{myPrompts.length}</small></h3><button type="button" onClick={() => setPromptDraft({ title: '', contentMarkdown: currentPrompt, tags: [] })}><Plus size={16} /> 新建提示词</button></div><div className="image-studio-group-tools"><input aria-label="分组名称" placeholder="新分组名称" value={groupName} onChange={(event) => setGroupName(event.target.value)} /><button type="button" disabled={!groupName.trim()} onClick={() => void createGroup()}>{renamingGroupId ? '保存名称' : '新建分组'}</button>{renamingGroupId && <button type="button" onClick={() => { setRenamingGroupId(''); setGroupName(''); }}>取消</button>}</div><div className="image-studio-group-list">{groups.map((group) => <div key={group.groupId}><span>{group.groupName} · {group.promptCount}</span>{!group.isSystem && <button type="button" title={`重命名 ${group.groupName}`} aria-label={`重命名 ${group.groupName}`} onClick={() => { setRenamingGroupId(group.groupId); setGroupName(group.groupName); }}><Pencil size={13} /></button>}</div>)}</div><div className="image-studio-personal-list">{myPrompts.map((item) => <article key={item.promptId}><div><strong>{item.title}</strong><small>{groups.find((group) => group.groupId === item.groupId)?.groupName || '未分组'} · {item.originKind}</small><p>{item.contentMarkdown}</p><small>{item.tags.join(' · ')}</small></div><footer><button type="button" title="用于生成" onClick={() => applyPrompt(item.contentMarkdown)}><Check size={16} /> 应用</button><button type="button" title="收藏" onClick={() => void toggleFavorite(item)}><Heart size={16} fill={item.isFavorite ? 'currentColor' : 'none'} /></button><button type="button" title="编辑" onClick={() => setPromptDraft(item)}><Pencil size={16} /></button><button type="button" title="删除" onClick={() => void deletePersonal(item)}><Trash2 size={16} /></button></footer></article>)}</div></div>}
    {tab === 'styles' && <div className="image-studio-personal-layout"><div className="image-studio-list-tools"><h3>常用风格</h3><button type="button" onClick={() => setStyleDraft({ name: '', body: '' })}><Plus size={16} /> 新建风格</button></div><div className="image-studio-style-grid">{styles.map((style) => <article key={style.styleId}><h3>{style.name}</h3><p>{style.body}</p><small>{style.ratio ? `推荐比例 ${style.ratio}` : '通用比例'}</small><footer><button type="button" onClick={() => applyPrompt(`${currentPrompt.trim()}\n${style.body}`.trim())}>应用到当前输入</button><button type="button" title="编辑" onClick={() => setStyleDraft(style)}><Pencil size={16} /></button><button type="button" title="删除" onClick={() => void window.yibiao!.imageStudio.deleteStyle({ styleId: style.styleId }).then(setStyles).catch((error) => showToast(String(error), 'error'))}><Trash2 size={16} /></button></footer></article>)}</div></div>}
    {selectedItem && <div className="image-studio-overlay"><section role="dialog" aria-modal="true" aria-label="参考提示词详情" className="image-studio-dialog"><div className="image-studio-panel-head"><h2>{selectedItem.title}</h2><button type="button" aria-label="关闭" onClick={() => setSelectedItem(null)}>×</button></div><p>{selectedItem.prompt}</p><small>{selectedItem.author} · {selectedItem.sourceUrl}</small><footer><button type="button" onClick={() => void navigator.clipboard.writeText(selectedItem.prompt)}><Copy size={16} /> 复制</button><button type="button" onClick={() => void saveReference(selectedItem)}><BookmarkPlus size={16} /> 另存个人提示词</button><button type="button" className="image-studio-primary" onClick={() => { applyPrompt(selectedItem.prompt); setSelectedItem(null); }}>用于生成</button></footer></section></div>}
    {promptDraft && <div className="image-studio-overlay"><section role="dialog" aria-modal="true" aria-label="编辑个人提示词" className="image-studio-dialog"><div className="image-studio-panel-head"><h2>{promptDraft.promptId ? '编辑提示词' : '新建提示词'}</h2><button type="button" aria-label="关闭" onClick={() => setPromptDraft(null)}>×</button></div><label>名称<input value={promptDraft.title || ''} onChange={(event) => setPromptDraft({ ...promptDraft, title: event.target.value })} /></label><label>分组<select value={promptDraft.groupId || groups[0]?.groupId || ''} onChange={(event) => setPromptDraft({ ...promptDraft, groupId: event.target.value })}>{groups.map((group) => <option key={group.groupId} value={group.groupId}>{group.groupName}</option>)}</select></label><label>提示词<textarea value={promptDraft.contentMarkdown || ''} onChange={(event) => setPromptDraft({ ...promptDraft, contentMarkdown: event.target.value })} /></label><label>标签<input value={(promptDraft.tags || []).join('，')} onChange={(event) => setPromptDraft({ ...promptDraft, tags: event.target.value.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean) })} /></label><label>备注<input value={promptDraft.notes || ''} onChange={(event) => setPromptDraft({ ...promptDraft, notes: event.target.value })} /></label><footer><button type="button" onClick={() => setPromptDraft(null)}>取消</button><button type="button" className="image-studio-primary" onClick={() => void savePersonal()}>保存</button></footer></section></div>}
    {styleDraft && <div className="image-studio-overlay"><section role="dialog" aria-modal="true" aria-label="编辑常用风格" className="image-studio-dialog"><div className="image-studio-panel-head"><h2>常用风格</h2><button type="button" aria-label="关闭" onClick={() => setStyleDraft(null)}>×</button></div><label>名称<input value={styleDraft.name || ''} onChange={(event) => setStyleDraft({ ...styleDraft, name: event.target.value })} /></label><label>风格描述<textarea value={styleDraft.body || ''} onChange={(event) => setStyleDraft({ ...styleDraft, body: event.target.value })} /></label><label>推荐比例<input value={styleDraft.ratio || ''} onChange={(event) => setStyleDraft({ ...styleDraft, ratio: event.target.value })} /></label><label>备注<input value={styleDraft.notes || ''} onChange={(event) => setStyleDraft({ ...styleDraft, notes: event.target.value })} /></label><footer><button type="button" onClick={() => setStyleDraft(null)}>取消</button><button type="button" className="image-studio-primary" onClick={() => void saveStyle()}>保存</button></footer></section></div>}
    {managerOpen && <div className="image-studio-overlay"><section role="dialog" aria-modal="true" aria-label="管理提示词来源" className="image-studio-dialog image-studio-source-manager"><div className="image-studio-panel-head"><h2>管理提示词来源</h2><button type="button" aria-label="关闭" onClick={() => setManagerOpen(false)}>×</button></div><p className="image-studio-muted">来源内容由用户主动检测或更新；GitHub Raw 不是国内稳定镜像。</p><div className="image-studio-source-list">{sources.map((source) => <article key={source.sourceId}><div><strong>{source.name}</strong><small>{source.itemCount} 条本地内容 · {source.lastSuccessAt || '未联网更新'}</small><small title={source.url}>{source.url}</small></div><div className="image-studio-source-actions"><label><input type="checkbox" checked={source.enabled} disabled={busySource === source.sourceId} onChange={() => void sourceAction(source.sourceId, 'toggle')} /> 启用</label><button type="button" disabled={Boolean(busySource)} title="检测地址" onClick={() => void sourceAction(source.sourceId, 'check')}><Check size={16} /></button><button type="button" disabled={Boolean(busySource)} title="刷新来源" onClick={() => void sourceAction(source.sourceId, 'refresh')}><RefreshCw size={16} /></button><button type="button" title="编辑来源" onClick={() => setSourceDraft(source)}><Pencil size={16} /></button><button type="button" title="删除来源" onClick={() => void sourceAction(source.sourceId, 'delete')}><Trash2 size={16} /></button></div></article>)}</div><button type="button" onClick={() => setSourceDraft({ name: '', url: '', homepage: '', enabled: true })}><Plus size={16} /> 新增来源</button><details><summary>恢复已删除的内置来源</summary><button type="button" onClick={() => void window.yibiao!.imageStudio.listSources({ includeDeleted: true }).then((all) => setSources(all)).catch((error) => showToast(String(error), 'error'))}>查看已删除来源</button>{sources.filter((source) => source.deletedAt && source.builtIn).map((source) => <button type="button" key={source.sourceId} onClick={() => void sourceAction(source.sourceId, 'restore')}>恢复 {source.name}</button>)}</details></section></div>}
    {sourceDraft && <div className="image-studio-overlay image-studio-overlay-top"><section role="dialog" aria-modal="true" aria-label="编辑来源" className="image-studio-dialog"><div className="image-studio-panel-head"><h2>{sourceDraft.sourceId ? '编辑来源' : '新增来源'}</h2><button type="button" aria-label="关闭" onClick={() => setSourceDraft(null)}>×</button></div><label>名称<input maxLength={80} value={sourceDraft.name || ''} onChange={(event) => setSourceDraft({ ...sourceDraft, name: event.target.value })} /></label><label>JSON 下载地址<input value={sourceDraft.url || ''} onChange={(event) => { setSourceDraft({ ...sourceDraft, url: event.target.value }); setSourceCheck(null); }} /></label><div className="image-studio-field-title"><button type="button" disabled={!sourceDraft.url?.trim() || checkingUrl} onClick={() => void checkDraftSourceUrl()}><Check size={16} /> {checkingUrl ? '检测中' : '检测候选地址'}</button>{sourceCheck && sourceCheck.url === sourceDraft.url?.trim() && <small>地址可用 · {sourceCheck.count} 条，未保存</small>}</div><label>出处主页<input value={sourceDraft.homepage || ''} onChange={(event) => setSourceDraft({ ...sourceDraft, homepage: event.target.value })} /></label><label>备用 JSON 地址<input value={sourceDraft.fallbackUrl || ''} onChange={(event) => setSourceDraft({ ...sourceDraft, fallbackUrl: event.target.value })} /></label><footer><button type="button" onClick={() => setSourceDraft(null)}>取消</button><button type="button" className="image-studio-primary" onClick={() => void saveSource()}>保存</button></footer></section></div>}
  </section>;
}
