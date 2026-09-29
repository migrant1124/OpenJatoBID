import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Copy, FileText, Info, X } from 'lucide-react';
import type { ImageStudioOptimizationCaseSummary } from '../../../shared/types/ipc';

const directions = ['商业海报', '产品摄影', '包装设计', '电商主图', '优化', '扩写', '简化', '英文', '双语', '写实', '插画'];
const working = new Set(['searching', 'queued', 'dispatching', 'streaming']);
const statusNames: Record<string, string> = {
  selecting: '请选择优化方向',
  searching: '正在查找资料', queued: '文本优化排队中', dispatching: '等待文本模型响应', streaming: '正在生成优化稿', completed: '已完成优化',
  needs_review: '需核对', failed: '失败', cancelled: '已停止', cached: '历史结果',
};

export function ImageStudioOptimizationDialog({ active, modelName, status, sourceStatus, sentStatus, sources,
  original, originalResultText, text, setText, mode, completedMode, setMode, canApply, canSave, onClose, onStop,
  onRetry, onSave, onApply, onCases, onEditBlur, onRestoreResult, applyReason, hasReferences }: {
  active: boolean; modelName: string; status: string; sourceStatus: string;
  sentStatus: 'pending' | 'submitted' | 'historical' | 'unknown';
  sources: ImageStudioOptimizationCaseSummary[]; original: string; originalResultText: string; text: string;
  setText: (value: string) => void; mode: string; completedMode: string; setMode: (value: string) => void;
  canApply: boolean; canSave: boolean; onClose: () => void; onStop: () => void;
  onRetry: () => void; onSave: () => void; onApply: () => void; onCases: () => void; onEditBlur: () => void;
  onRestoreResult: () => void; applyReason: string;
  hasReferences: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [confirmRetry, setConfirmRetry] = useState(false);
  const running = working.has(status);
  const caseText = status === 'selecting' ? '选择方向后开始检索参考案例'
    : sourceStatus === 'disabled' ? '参考案例已关闭'
    : sources.length ? sentStatus === 'pending' ? `已选 ${sources.length} 条参考案例，待提供给模型`
      : sentStatus === 'unknown' ? `已选 ${sources.length} 条参考案例，请求是否送达待确认`
      : sentStatus === 'historical' ? `历史结果引用 ${sources.length} 条参考案例`
        : `本次向 AI 提供 ${sources.length} 条参考案例`
      : sourceStatus === 'no_match' ? '未找到相关案例，已按普通优化处理'
        : ['loading', 'timeout', 'error'].includes(sourceStatus) ? '案例知识暂不可用，已按普通优化处理'
          : '本次未提供参考案例';

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    return () => previous?.focus();
  }, [active]);

  function keyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), [tabindex="0"]') || [])]
      .filter((node) => node.offsetParent !== null);
    const first = focusable[0]; const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  function directionKey(event: React.KeyboardEvent, current: string) {
    if (running || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const offset = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
    const next = directions[(directions.indexOf(current) + offset + directions.length) % directions.length];
    setMode(next);
    dialogRef.current?.querySelector<HTMLElement>(`[data-direction="${next}"]`)?.focus();
  }

  return <div className="image-studio-overlay image-studio-opt-overlay" style={active ? undefined : { display: 'none' }} role="presentation">
    <section ref={dialogRef} role="dialog" aria-modal={active} aria-label="提示词优化与对比" className="image-studio-dialog image-studio-prompt-dialog" onKeyDown={keyDown}>
      <header className="image-studio-opt-head"><h2 tabIndex={-1} ref={titleRef}>提示词优化与对比</h2><button type="button" aria-label="关闭优化对比" onClick={() => onClose()}><X size={20} /></button></header>
      <div className="image-studio-opt-body">
        <div className={`image-studio-opt-status ${status === 'completed' || status === 'cached' ? 'complete' : ''}`}>{status === 'completed' || status === 'cached' ? <CheckCircle2 size={19} /> : <Info size={19} />}<span>当前生图模型：{modelName} · {statusNames[status] || status}{completedMode && mode !== completedMode ? ` · 原结果方向：${completedMode}；方向已调整，点击重新优化生效` : ''}</span></div>
        <div className="image-studio-opt-directions"><strong>优化方向</strong><div role="radiogroup" aria-label="优化方向">{directions.map((item, index) => <button type="button" key={item} role="radio" data-direction={item} aria-checked={mode === item} disabled={running} tabIndex={mode === item || (!mode && index === 0) ? 0 : -1} onKeyDown={(event) => directionKey(event, item)} onClick={() => setMode(item)}>{item === '优化' ? '通用优化' : item}</button>)}</div></div>
        <div className="image-studio-opt-casebar"><FileText size={20} /><strong>{caseText}</strong><span>{sources.length ? '参考相关案例中的表达方式，不改变你的明确要求。' : ''}</span><button type="button" disabled={!sources.length} onClick={onCases}>查看实际提供的案例</button></div>
        <div className="image-studio-opt-compare">
          <section className="image-studio-opt-panel"><header><h3>原文</h3></header><div className="image-studio-opt-reader">{original}</div></section>
          <section className="image-studio-opt-panel image-studio-opt-result"><header><h3>优化稿</h3><button type="button" disabled={!text} onClick={() => void navigator.clipboard.writeText(text)}><Copy size={15} /> 复制</button></header><textarea aria-label="优化稿" value={text} readOnly={running || status === 'selecting'} onChange={(event) => setText(event.target.value)} onBlur={onEditBlur} /><small>{text.length.toLocaleString()} / 10,000{ text.length > 10000 ? ' · 超出应用上限，请缩短后应用' : ''}</small></section>
        </div>
        <p className="image-studio-opt-note"><Info size={16} /> {caseText}。{hasReferences ? '本次未分析图片内容，仅使用参考图用途。' : '案例图片仅供阅读，未提供给优化模型。'}</p>
        {!canApply && !running && text && <p className="image-studio-warning">{applyReason} {(status === 'completed' || status === 'cached') && text !== originalResultText && (applyReason.includes('缺少') || applyReason.includes('超过')) && <button type="button" onClick={onRestoreResult}>恢复模型优化稿</button>}</p>}
        {confirmRetry && <div className="image-studio-opt-confirm"><span>重新优化会替换当前优化稿；现有编辑稿将保存在本轮会话中。</span><button type="button" onClick={() => setConfirmRetry(false)}>返回编辑</button><button type="button" onClick={() => { setConfirmRetry(false); onRetry(); }}>确认重新优化</button></div>}
      </div>
      <footer className="image-studio-opt-footer"><button type="button" disabled={!sources.length} onClick={onCases}>查看实际提供的案例</button><div><button type="button" onClick={() => onClose()}>取消</button>{running && <button type="button" onClick={onStop}>停止</button>}<button type="button" disabled={running || (status === 'selecting' && !mode)} onClick={() => status === 'selecting' || text === originalResultText ? onRetry() : setConfirmRetry(true)}>{status === 'selecting' ? '开始优化' : '重新优化'}</button><button type="button" disabled={!canSave} onClick={onSave}>保存到我的提示词</button><button type="button" className="image-studio-primary" disabled={!canApply} onClick={onApply}>应用到输入框</button></div></footer>
    </section>
  </div>;
}
