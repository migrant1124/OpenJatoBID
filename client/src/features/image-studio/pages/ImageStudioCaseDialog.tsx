import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronLeft, ChevronRight, Copy, FileText, Info, X } from 'lucide-react';
import type { ImageStudioOptimizationCase, ImageStudioOptimizationCaseSummary } from '../../../shared/types/ipc';
import { ImageStudioViewer } from './ImageStudioViewer';

export function ImageStudioCaseDialog({ active, sessionId, cases, sentStatus, initialSelected, onSelected, onClose, onSave, onApply }: {
  active: boolean; sessionId: string; cases: ImageStudioOptimizationCaseSummary[]; onClose: () => void;
  sentStatus: 'pending' | 'submitted' | 'historical' | 'unknown';
  initialSelected: number; onSelected: (index: number) => void;
  onSave: (text: string, detail: ImageStudioOptimizationCase, language: 'zh' | 'original') => void;
  onApply: (text: string, detail: ImageStudioOptimizationCase, language: 'zh' | 'original') => void;
}) {
  const [selected, setSelected] = useState(initialSelected);
  const [details, setDetails] = useState<Record<string, ImageStudioOptimizationCase>>({});
  const [images, setImages] = useState<Record<string, string>>({});
  const [imageIndex, setImageIndex] = useState(0);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState('');
  const [detailErrors, setDetailErrors] = useState<Record<string, string>>({});
  const [language, setLanguage] = useState<'zh' | 'original'>('zh');
  const [translatingIds, setTranslatingIds] = useState<string[]>([]);
  const [translationErrors, setTranslationErrors] = useState<Record<string, string>>({});
  const [viewerOpen, setViewerOpen] = useState(false);
  const [sentOpen, setSentOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const generation = useRef(0);
  const positions = useRef<Record<string, number>>({});
  const languages = useRef<Record<string, 'zh' | 'original'>>({});
  const cancelledTranslations = useRef(new Set<string>());
  const item = cases[selected];
  const selectedId = useRef(item?.caseSnapshotId);
  selectedId.current = item?.caseSnapshotId;
  const detail = item && details[item.caseSnapshotId];
  const detailError = item ? detailErrors[item.caseSnapshotId] : '';
  const translating = Boolean(detail && translatingIds.includes(detail.caseSnapshotId));
  const translationError = detail ? translationErrors[detail.caseSnapshotId] : '';
  const imageKey = item ? `${item.caseSnapshotId}:${imageIndex}` : '';
  const currentImageKey = useRef(imageKey);
  currentImageKey.current = imageKey;
  const imageUrl = images[imageKey];
  const shownText = language === 'zh' ? detail?.promptZh || '' : detail?.promptOriginal || '';
  const operationLabel = language === 'zh' ? '案例中文提示词' : '案例原文';

  useEffect(() => { if (active) titleRef.current?.focus(); }, [active]);
  useEffect(() => { if (detail && !detail.promptZh) setLanguage('original'); }, [detail?.caseSnapshotId, detail?.promptZh]);
  useEffect(() => {
    let live = true;
    cases.forEach((summary) => {
      void window.yibiao!.imageStudio.optimizationCase({ sessionId, caseSnapshotId: summary.caseSnapshotId }).then(async (value) => {
        if (!live) return;
        setDetails((current) => ({ ...current, [summary.caseSnapshotId]: value }));
        setDetailErrors((current) => ({ ...current, [summary.caseSnapshotId]: '' }));
        if (value.media.length) {
          try {
            const image = await window.yibiao!.imageStudio.optimizationCaseImage({ sessionId,
              caseSnapshotId: summary.caseSnapshotId, imageIndex: 0 });
            if (live) setImages((current) => ({ ...current, [`${summary.caseSnapshotId}:0`]: image.assetUrl }));
          } catch { /* 当前案例的图片错误由主预览区显示。 */ }
        }
      }).catch((error) => { if (live) setDetailErrors((current) => ({ ...current, [summary.caseSnapshotId]: String(error) })); });
    });
    return () => { live = false; generation.current += 1; };
  }, [sessionId, cases]);

  useEffect(() => {
    if (!detail?.media.length || imageUrl) { setImageBusy(false); setImageError(''); return; }
    let live = true;
    const token = ++generation.current;
    setImageBusy(true); setImageError('');
    void window.yibiao!.imageStudio.optimizationCaseImage({ sessionId, caseSnapshotId: detail.caseSnapshotId, imageIndex })
      .then((result) => { if (live && token === generation.current) setImages((current) => ({ ...current, [imageKey]: result.assetUrl })); })
      .catch((error) => { if (live && token === generation.current) setImageError(String(error)); })
      .finally(() => { if (live && token === generation.current) setImageBusy(false); });
    return () => { live = false; };
  }, [detail?.caseSnapshotId, detail?.media.length, imageIndex, imageKey, imageUrl, sessionId]);

  useEffect(() => {
    if (bodyRef.current && item) bodyRef.current.scrollTop = positions.current[`${item.caseSnapshotId}:${language}`] || 0;
  }, [item?.caseSnapshotId, language, detail?.promptZh]);

  function switchCase(index: number) {
    if (bodyRef.current && item) { positions.current[`${item.caseSnapshotId}:${language}`] = bodyRef.current.scrollTop; languages.current[item.caseSnapshotId] = language; }
    setSelected(index); onSelected(index); setImageIndex(0);
    setLanguage(languages.current[cases[index]?.caseSnapshotId] || 'zh'); setImageError('');
  }
  function switchLanguage(next: 'zh' | 'original') {
    if (bodyRef.current && item) positions.current[`${item.caseSnapshotId}:${language}`] = bodyRef.current.scrollTop;
    setLanguage(next);
  }
  async function translate() {
    if (!detail || translating) return;
    const id = detail.caseSnapshotId;
    cancelledTranslations.current.delete(id);
    setTranslatingIds((current) => [...current, id]);
    setTranslationErrors((current) => ({ ...current, [id]: '' }));
    try {
      const result = await window.yibiao!.imageStudio.translateOptimizationCase({ sessionId, caseSnapshotId: detail.caseSnapshotId });
      if (cancelledTranslations.current.has(id)) return;
      setDetails((current) => ({ ...current, [detail.caseSnapshotId]: { ...current[detail.caseSnapshotId], ...result } }));
      if (selectedId.current === id) setLanguage('zh');
    } catch (error) { if (!cancelledTranslations.current.has(id)) setTranslationErrors((current) => ({ ...current, [id]: String(error) })); }
    finally { cancelledTranslations.current.delete(id); setTranslatingIds((current) => current.filter((value) => value !== id)); }
  }
  function cancelTranslation(id: string) {
    cancelledTranslations.current.add(id);
    void window.yibiao!.imageStudio.cancelCaseTranslation({ sessionId, caseSnapshotId: id })
      .catch((error) => setTranslationErrors((current) => ({ ...current, [id]: String(error) })));
  }
  async function retryImage() {
    if (!detail) return;
    const key = imageKey; const token = ++generation.current;
    setImageError(''); setImageBusy(true);
    try {
      const result = await window.yibiao!.imageStudio.optimizationCaseImage({ sessionId,
        caseSnapshotId: detail.caseSnapshotId, imageIndex, retry: true });
      if (token === generation.current && key === currentImageKey.current) setImages((current) => ({ ...current, [key]: result.assetUrl }));
    } catch (error) {
      if (token === generation.current && key === currentImageKey.current) setImageError(String(error));
    } finally {
      if (token === generation.current && key === currentImageKey.current) setImageBusy(false);
    }
  }
  function close() {
    translatingIds.forEach(cancelTranslation);
    onClose();
  }
  function keyDown(event: KeyboardEvent) {
    if (viewerOpen) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]') || [])]
      .filter((node) => node.offsetParent !== null);
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1]?.focus(); }
    else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0]?.focus(); }
  }

  return <div className="image-studio-overlay image-studio-case-overlay" style={active ? undefined : { display: 'none' }} role="presentation">
    <section ref={dialogRef} role="dialog" aria-modal={active} aria-label="查看实际提供的案例" className="image-studio-dialog image-studio-case-dialog" onKeyDown={keyDown}>
      <header className="image-studio-opt-head"><h2 tabIndex={-1} ref={titleRef}>查看实际提供的案例</h2><button type="button" aria-label="关闭案例详情" onClick={close}><X size={20} /></button></header>
      <div className="image-studio-case-body">
        <div className="image-studio-opt-status"><FileText size={19} /><span>{sentStatus === 'pending' ? `已选 ${cases.length} 条案例，待提供给模型` : sentStatus === 'unknown' ? `已选 ${cases.length} 条案例，请求是否送达待确认` : sentStatus === 'historical' ? `历史结果引用 ${cases.length} 条参考案例` : `本次向 AI 提供 ${cases.length} 条参考案例`} · 仅用于提示词优化参考</span><button type="button" onClick={close}>返回优化对比</button></div>
        <div className="image-studio-case-tabs" role="tablist" aria-label="本轮案例">{cases.map((summary, index) => <button type="button" key={summary.caseSnapshotId} role="tab" aria-selected={selected === index} onClick={() => switchCase(index)}><span className="image-studio-case-thumb">{images[`${summary.caseSnapshotId}:0`] ? <img src={images[`${summary.caseSnapshotId}:0`]} alt="" /> : <FileText size={22} />}</span><span><strong>案例 {index + 1}　{summary.title}</strong>{summary.tags?.length > 0 && <small>{summary.tags.slice(0, 2).join('　')}</small>}</span></button>)}</div>
        <div className="image-studio-case-content">
          <section className="image-studio-case-image" aria-label="案例样例图"><div className="image-studio-case-image-stage">{imageUrl ? <button type="button" title="放大案例图片" onClick={() => setViewerOpen(true)}><img src={imageUrl} alt={`案例 ${selected + 1} 样例图`} /></button> : <p>{!detail ? '正在加载案例' : !detail.media.length ? '该案例未提供样例图' : imageBusy ? '正在加载图片' : imageError ? '图片暂未加载成功' : '正在加载图片'}</p>}</div><div className="image-studio-case-image-controls">{detail && detail.media.length > 1 && <button type="button" aria-label="上一张案例图片" onClick={() => setImageIndex((imageIndex - 1 + detail.media.length) % detail.media.length)}><ChevronLeft size={18} /></button>}<span>{detail?.media.length ? `案例图片 ${imageIndex + 1} / ${detail.media.length}` : '无案例图片'}</span>{detail && detail.media.length > 1 && <button type="button" aria-label="下一张案例图片" onClick={() => setImageIndex((imageIndex + 1) % detail.media.length)}><ChevronRight size={18} /></button>}{imageError && <button type="button" onClick={() => void retryImage()}>重试</button>}</div></section>
          <section className="image-studio-case-reader"><header><h3>{language === 'zh' ? '中文提示词' : '原始提示词'}</h3><div>{detail?.promptZh && detail.promptOriginal && detail.promptOriginal !== detail.promptZh && <button type="button" onClick={() => switchLanguage(language === 'zh' ? 'original' : 'zh')}>{language === 'zh' ? '查看原文' : '查看中文'}</button>}<button type="button" disabled={!shownText} onClick={() => void navigator.clipboard.writeText(shownText)}><Copy size={15} /> 复制</button></div></header><div ref={bodyRef} className="image-studio-case-reader-text">{detailError ? `案例读取失败：${detailError}` : !detail ? '正在读取完整案例…' : shownText || (language === 'zh' ? '该案例暂未提供中文全文。' : '该案例原文缺失，不能以摘要代替。')}</div><div className="image-studio-case-reader-foot">{detail && <><span>{detail.translationStatus === 'original' ? '原始中文' : detail.translationStatus === 'source' ? '来源提供' : detail.translationStatus === 'ai' ? 'AI 译文，未人工核对' : '原文可读，中文未提供'}</span>{!detail.promptZh && <><button type="button" disabled={translating || !detail.promptOriginal} onClick={() => void translate()}>{translating ? '翻译中' : '翻译为中文'}</button>{translating && <button type="button" onClick={() => cancelTranslation(detail.caseSnapshotId)}>取消翻译</button>}<small>将使用当前文本模型，可能产生接口费用</small></>}</>}{translationError && <small className="image-studio-warning">{translationError}</small>}</div></section>
        </div>
        <div className="image-studio-case-sent"><button type="button" aria-expanded={sentOpen} onClick={() => setSentOpen(!sentOpen)}>{sentOpen ? '⌄' : '›'}　本次实际提供给 AI 的内容</button>{sentOpen && <div>{detail ? <><p>{detail.sentStatus === 'historical' ? '历史结果及其原始参考资料' : detail.sentStatus === 'pending' ? '已选案例，待提供给模型' : detail.sentStatus === 'unknown' ? '请求是否送达待确认；以下是准备提交的片段。' : '以下文字已随本次优化请求提交；不代表模型逐条采纳。'}</p><pre>{detail.sentText}</pre><small>本次仅发送以上片段；完整提示词与图片供阅读。</small></> : '正在读取引用记录…'}</div>}</div>
        <p className="image-studio-opt-note"><Info size={16} /> 来源：{detail?.sourceUrl || detail?.sourceId || '读取中'}。当前操作对象：{operationLabel}；案例图片不会加入创作参考图。</p>
      </div>
      <footer className="image-studio-opt-footer"><span /> <div><button type="button" onClick={close}>关闭</button><button type="button" disabled={!shownText} onClick={() => detail && onSave(shownText, detail, language)}>保存到我的提示词</button><button type="button" className="image-studio-primary" disabled={!shownText || shownText.length > 10000} onClick={() => detail && onApply(shownText, detail, language)}>应用到输入框</button></div></footer>
    </section>
    {viewerOpen && imageUrl && <ImageStudioViewer images={[{ url: imageUrl, label: `案例 ${selected + 1} 样例图` }]} onClose={() => setViewerOpen(false)} />}
  </div>;
}
