import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import type { ManagedResource } from '../types/ipc';

export function ResourceThumbnail({ item, version }: { item: ManagedResource; version?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false), [page, setPage] = useState(0), [preview, setPreview] = useState(''), [previewError, setPreviewError] = useState('');
  const cover = item.assets.find((asset) => asset.role === 'cover');
  const previews = item.assets.filter((asset) => ['cover', 'preview'].includes(asset.role)).sort((a, b) => (a.page || 0) - (b.page || 0));
  const selected = previews[page];
  useEffect(() => {
    if (!open || !selected) return;
    let live = true; setPreview(''); setPreviewError('');
    void window.yibiao!.resources.asset({ resourceId: item.resourceId, assetId: selected.assetId, version, retry: retry > 0 }).then((result) => { if (live) setPreview(result.assetUrl || ''); }).catch((error) => { if (live) setPreviewError(String(error)); });
    return () => { live = false; };
  }, [open, selected?.assetId, item.resourceId, version, retry]);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) setVisible(true); });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !cover) return;
    let active = true; setUrl(''); setError('');
    void window.yibiao!.resources.asset({ resourceId: item.resourceId, assetId: cover.assetId, version, retry: retry > 0 })
      .then((result) => { if (active) { if (result.assetUrl) setUrl(result.assetUrl); else setError('资源没有可用图像'); } })
      .catch((error) => { if (active) setError(String(error)); });
    return () => { active = false; };
  }, [visible, cover?.assetId, item.resourceId, version, retry]);
  return <div ref={ref} className="resource-thumbnail">
    {url ? <Dialog.Root open={open} onOpenChange={setOpen}><Dialog.Trigger asChild><button type="button" aria-label={`预览${item.title}`}><img src={url} alt={item.title} onError={() => { setUrl(''); setError('本地图片无法解码'); }} /></button></Dialog.Trigger>
      <Dialog.Portal><Dialog.Overlay className="resource-preview-overlay" /><Dialog.Content className="resource-preview-dialog">
        <header><Dialog.Title>{item.title}</Dialog.Title><Dialog.Close aria-label="关闭图片预览">×</Dialog.Close></header>
        <Dialog.Description>对应文件版本的真实预览，保持原始画幅。{item.pageCount ? `${item.pageCount}页 · ` : ''}{['native_reuse_verified', 'mixed_reuse_verified', 'visual_reference_verified'].includes(item.capability) ? '能力范围见模板详情' : '实际套用仍待验证'}</Dialog.Description>
        {previewError ? <p role="status">{previewError}<button onClick={() => setRetry((value) => value + 1)}>重试大图</button></p> : preview ? <img src={preview} alt={`${item.title} 第${(selected?.page || 0) + 1}页`} onError={() => setPreviewError('大图无法解码')} /> : <p>正在加载对应页…</p>}
        <footer><button disabled={!page} onClick={() => setPage(page - 1)}>上一页</button><span>{page + 1} / {previews.length} 张已准备预览{item.pageCount && previews.length < item.pageCount ? ' · 其余页待准备' : ''}</span><button disabled={page + 1 >= previews.length} onClick={() => setPage(page + 1)}>下一页</button></footer>
      </Dialog.Content></Dialog.Portal></Dialog.Root>
      : error ? <div role="status"><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>重试图片</button></div>
        : <span>{cover ? '正在加载真实预览…' : item.status === 'ready' ? '该条目无关联图片' : '预览待管理端准备'}</span>}
  </div>;
}
