import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react';

export interface StudioViewerImage { url: string; label: string }

export function ImageStudioViewer({ images, initialIndex = 0, onClose }: {
  images: StudioViewerImage[]; initialIndex?: number; onClose: () => void;
}) {
  const [index, setIndex] = useState(initialIndex);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [failed, setFailed] = useState(false);
  const imageRef = useRef<HTMLImageElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key === 'ArrowLeft') setIndex((current) => (current - 1 + images.length) % images.length);
      if (event.key === 'ArrowRight') setIndex((current) => (current + 1) % images.length);
      if (event.key === 'Tab') {
        const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || []);
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [images.length]);
  useEffect(() => { setScale(1); setOffset({ x: 0, y: 0 }); setFailed(false); }, [index]);

  function actualSize() {
    const image = imageRef.current;
    if (!image) return;
    setScale(Math.max(1, image.naturalWidth / image.clientWidth));
    setOffset({ x: 0, y: 0 });
  }
  function toggleSize() {
    if (scale === 1 && offset.x === 0 && offset.y === 0) actualSize();
    else { setScale(1); setOffset({ x: 0, y: 0 }); }
  }
  const current = images[index];
  return <div ref={dialogRef} className="image-studio-viewer" role="dialog" aria-modal="true" aria-label="图片预览">
    <div className="image-studio-viewer-toolbar">
      <span>{current.label} · {index + 1}/{images.length}</span>
      <button type="button" title="切换原始尺寸与适应窗口" aria-label="切换预览尺寸" onClick={toggleSize}><Maximize2 size={18} /></button>
      <button type="button" title="关闭预览" aria-label="关闭预览" onClick={onClose}><X size={20} /></button>
    </div>
    <div className="image-studio-viewer-stage" onWheel={(event) => {
      if (!imageRef.current || !event.target || !(event.target as HTMLElement).closest('img')) return;
      event.preventDefault();
      const rect = imageRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const next = Math.min(8, Math.max(.25, scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const factor = next / scale;
      setOffset((old) => ({ x: old.x + (centerX - event.clientX) * (factor - 1),
        y: old.y + (centerY - event.clientY) * (factor - 1) }));
      setScale(next);
    }} onPointerMove={(event) => {
      if (!drag.current) return;
      setOffset({ x: drag.current.originX + event.clientX - drag.current.x,
        y: drag.current.originY + event.clientY - drag.current.y });
    }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {images.length > 1 && <button type="button" className="image-studio-viewer-prev" title="上一张" aria-label="上一张" onClick={() => setIndex((index - 1 + images.length) % images.length)}><ChevronLeft /></button>}
      {failed ? <p>原图无法读取，请检查受管图片是否仍存在。</p> : <img ref={imageRef} src={current.url} alt={current.label}
        onError={() => setFailed(true)} draggable={false} style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
        onPointerDown={(event) => { drag.current = { x: event.clientX, y: event.clientY, originX: offset.x, originY: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }} />}
      {images.length > 1 && <button type="button" className="image-studio-viewer-next" title="下一张" aria-label="下一张" onClick={() => setIndex((index + 1) % images.length)}><ChevronRight /></button>}
    </div>
  </div>;
}
