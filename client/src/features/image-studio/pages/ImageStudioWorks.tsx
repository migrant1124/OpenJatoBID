import { useMemo, useState } from 'react';
import { Download, Heart, ImagePlus, Search, Trash2 } from 'lucide-react';
import type { ImageStudioWork } from '../../../shared/types/ipc';
import { useToast } from '../../../shared/ui';

export function ImageStudioWorks({ works, refresh, openWork, continueWork }: {
  works: ImageStudioWork[];
  refresh: () => Promise<void>;
  openWork: (work: ImageStudioWork) => void;
  continueWork: (work: ImageStudioWork) => void;
}) {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [selected, setSelected] = useState<ImageStudioWork | null>(null);
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp'>('png');
  const visible = useMemo(() => works.filter((work) =>
    (!favoriteOnly || work.isFavorite) && (!query.trim() || work.prompt.includes(query.trim()))), [works, favoriteOnly, query]);
  const current = selected ? works.find((work) => work.workId === selected.workId) || null : null;
  const versions = current ? works.filter((work) => work.workId === current.workId || work.parentWorkId === current.workId || (current.parentWorkId && work.workId === current.parentWorkId)) : [];

  async function toggleFavorite(work: ImageStudioWork) {
    try { await window.yibiao!.imageStudio.setFavorite({ workId: work.workId, isFavorite: !work.isFavorite }); await refresh(); }
    catch (error) { showToast(String(error), 'error'); }
  }

  async function deleteWork(work: ImageStudioWork) {
    if (!window.confirm('从作品列表移除？子版本引用和受管文件不会自动删除。')) return;
    try { await window.yibiao!.imageStudio.deleteWork({ workId: work.workId }); setSelected(null); await refresh(); }
    catch (error) { showToast(String(error), 'error'); }
  }

  async function exportWork(work: ImageStudioWork) {
    try {
      const result = await window.yibiao!.imageStudio.exportImage({ workId: work.workId, format });
      if (!result.canceled) showToast('图片已导出', 'success');
    } catch (error) { showToast(String(error), 'error'); }
  }

  return <section className="image-studio-library image-studio-works-page">
    <div className="image-studio-library-head"><div><h2>我的作品</h2><p>{works.length} 张作品 · 原图和版本独立保留</p></div></div>
    <div className="image-studio-list-tools"><label className="image-studio-search"><Search size={16} /><input aria-label="搜索作品提示词" placeholder="搜索提示词" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="image-studio-checkbox"><input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} /> 只看收藏</label></div>
    {!visible.length && <div className="image-studio-library-empty">{works.length ? '没有符合条件的作品' : '作品将在首次生成后出现在这里'}</div>}
    <div className="image-studio-grid">{visible.map((work) => <article key={work.workId} className="image-studio-work-item"><button type="button" className="image-studio-work-image" onClick={() => setSelected(work)}><img src={work.assetUrl} alt={work.prompt} loading="lazy" /></button><div><strong>{work.width} × {work.height}</strong><p title={work.prompt}>{work.prompt}</p><small>{new Date(work.createdAt).toLocaleString('zh-CN')}</small></div><footer><button type="button" onClick={() => setSelected(work)}>详情</button><button type="button" title="收藏" aria-label={work.isFavorite ? '取消收藏' : '收藏'} onClick={() => void toggleFavorite(work)}><Heart size={16} fill={work.isFavorite ? 'currentColor' : 'none'} /></button><button type="button" title="删除" aria-label="删除作品" onClick={() => void deleteWork(work)}><Trash2 size={16} /></button></footer></article>)}</div>
    {current && <div className="image-studio-overlay"><section role="dialog" aria-modal="true" aria-label="作品详情" className="image-studio-dialog image-studio-work-detail"><div className="image-studio-panel-head"><h2>作品详情</h2><button type="button" aria-label="关闭" onClick={() => setSelected(null)}>×</button></div><div className="image-studio-detail-body"><img src={current.assetUrl} alt={current.prompt} /><div><strong>本次生成提示词</strong><p>{current.prompt}</p><dl><dt>模型</dt><dd>{current.modelName}</dd><dt>尺寸</dt><dd>{current.width} × {current.height}</dd><dt>格式</dt><dd>{current.mimeType}</dd><dt>时间</dt><dd>{new Date(current.createdAt).toLocaleString('zh-CN')}</dd></dl><strong>版本记录</strong><div className="image-studio-version-list">{versions.map((work) => <button key={work.workId} type="button" onClick={() => setSelected(work)}><img src={work.assetUrl} alt="" /><span>{work.workId === current.workId ? '当前版本' : work.parentWorkId === current.workId ? '后续版本' : '原版本'}</span></button>)}</div></div></div><footer><button type="button" onClick={() => { openWork(current); setSelected(null); }}>在创作页查看</button><button type="button" onClick={() => { continueWork(current); setSelected(null); }}><ImagePlus size={16} /> 继续创作</button><select aria-label="下载格式" value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WEBP</option></select><button type="button" className="image-studio-primary" onClick={() => void exportWork(current)}><Download size={16} /> 下载</button></footer></section></div>}
  </section>;
}
