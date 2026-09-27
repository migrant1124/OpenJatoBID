import { useEffect, useRef, useState } from 'react';
import { Eraser, MousePointer2, Paintbrush, Plus, WandSparkles, X } from 'lucide-react';
import { useToast } from '../../../shared/ui';

type Point = { x: number; y: number };
type Region = { id: number; prompt: string; center?: Point };
export type StudioEditRegion = { prompt: string; maskDataUrl: string };

export function ImageStudioRegionEditor({ source, onClose, onSubmit }: {
  source: { workId?: string; assetId?: string }; onClose: () => void;
  onSubmit: (regions: StudioEditRegion[]) => Promise<string | void>;
}) {
  const { showToast } = useToast();
  const [image, setImage] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [regions, setRegions] = useState<Region[]>([{ id: 1, prompt: '' }]);
  const [active, setActive] = useState(1);
  const [tool, setTool] = useState<'rectangle' | 'brush' | 'magic'>('rectangle');
  const [subtract, setSubtract] = useState(false);
  const [radius, setRadius] = useState(24);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState('');
  const canvases = useRef(new Map<number, HTMLCanvasElement>());
  const stageRef = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const drag = useRef<{ start: Point; last: Point; id: number; moving?: ImageData } | null>(null);

  useEffect(() => {
    let live = true;
    void window.yibiao!.imageStudio.readManagedImage(source).then((result) => { if (live) setImage(result); })
      .catch((error) => showToast(String(error), 'error'));
    return () => { live = false; };
  }, [source.workId, source.assetId, showToast]);

  useEffect(() => {
    if (!taskId) return;
    let live = true;
    const inspect = (tasks: Array<{ taskId: string; status: string; error: string | null }>) => {
      const task = tasks.find((item) => item.taskId === taskId);
      if (task?.status === 'completed') onClose();
      if (task && ['failed', 'partial', 'unknown', 'cancelled', 'stopped_waiting'].includes(task.status)) {
        setTaskId(''); showToast(task.error || '局部修改未完成，选区已保留。', 'error');
      }
    };
    const unsubscribe = window.yibiao!.imageStudio.onEvent((event) => inspect(event.tasks));
    void window.yibiao!.imageStudio.getState().then((state) => { if (live) inspect(state.tasks); });
    return () => { live = false; unsubscribe(); };
  }, [taskId, onClose, showToast]);

  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width,
      y: (event.clientY - rect.top) * event.currentTarget.height / rect.height };
  }
  function updateCenter(id: number) {
    const canvas = canvases.current.get(id);
    if (!canvas) return;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width; let right = 0; let top = canvas.height; let bottom = 0;
    for (let y = 0; y < canvas.height; y += 1) for (let x = 0; x < canvas.width; x += 1) {
      if (pixels[(y * canvas.width + x) * 4 + 3] < 128) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    setRegions((items) => items.map((region) => region.id === id ? {
      ...region, center: left <= right ? { x: (left + right) / 2, y: (top + bottom) / 2 } : undefined,
    } : region));
  }
  function paint(a: Point, b: Point, id: number) {
    const ctx = canvases.current.get(id)?.getContext('2d');
    if (!ctx) return;
    ctx.save(); ctx.globalCompositeOperation = subtract ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#ed3d48'; ctx.fillStyle = '#ed3d48'; ctx.lineWidth = radius * 2;
    ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (a.x === b.x && a.y === b.y) { ctx.beginPath(); ctx.arc(a.x, a.y, radius, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  async function magic(pointValue: Point) {
    if (!image) return;
    setBusy(true);
    try {
      const result = await window.yibiao!.imageStudio.segmentObject({ ...source, point: pointValue });
      const picture = new Image();
      picture.src = result.maskDataUrl;
      await picture.decode();
      const ctx = canvases.current.get(active)?.getContext('2d');
      if (!ctx) return;
      ctx.save(); ctx.globalCompositeOperation = subtract ? 'destination-out' : 'source-over';
      ctx.drawImage(picture, 0, 0, image.width, image.height); ctx.restore();
      updateCenter(active);
    } catch (error) { showToast(String(error), 'error'); }
    finally { setBusy(false); }
  }
  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!image || busy || event.button === 1) return;
    const current = point(event);
    if (tool === 'magic') { void magic(current); return; }
    if (tool === 'rectangle') {
      for (const region of regions.slice().reverse()) {
        if (canvases.current.get(region.id)?.getContext('2d')?.getImageData(Math.min(image.width - 1, Math.floor(current.x)), Math.min(image.height - 1, Math.floor(current.y)), 1, 1).data[3]) {
          setActive(region.id);
          drag.current = { start: current, last: current, id: region.id,
            moving: canvases.current.get(region.id)!.getContext('2d')!.getImageData(0, 0, image.width, image.height) };
          event.currentTarget.setPointerCapture(event.pointerId);
          return;
        }
      }
    }
    drag.current = { start: current, last: current, id: active };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === 'brush') paint(current, current, active);
  }
  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag.current) return;
    const next = point(event);
    if (drag.current.moving) {
      const ctx = canvases.current.get(drag.current.id)?.getContext('2d');
      if (ctx) { ctx.clearRect(0, 0, image!.width, image!.height);
        ctx.putImageData(drag.current.moving, Math.round(next.x - drag.current.start.x), Math.round(next.y - drag.current.start.y)); }
      return;
    }
    if (tool !== 'brush') return;
    paint(drag.current.last, next, drag.current.id);
    drag.current.last = next;
  }
  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const current = drag.current;
    if (!current) return;
    if (tool === 'rectangle' && !current.moving) {
      const end = point(event); const ctx = canvases.current.get(current.id)?.getContext('2d');
      if (ctx) {
        ctx.save(); ctx.globalCompositeOperation = subtract ? 'destination-out' : 'source-over';
        ctx.fillStyle = '#ed3d48'; ctx.fillRect(Math.min(current.start.x, end.x), Math.min(current.start.y, end.y),
          Math.abs(end.x - current.start.x), Math.abs(end.y - current.start.y)); ctx.restore();
      }
    }
    drag.current = null; updateCenter(current.id);
  }
  async function submit() {
    if (!image) return;
    const masks = regions.map((region) => {
      const canvas = canvases.current.get(region.id)!;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, image.width, image.height).data;
      return { prompt: region.prompt.trim(), pixels };
    });
    if (masks.some((region) => !region.prompt)) { showToast('请填写每个修改区域的要求。', 'info'); return; }
    const occupied = new Uint8Array(image.width * image.height);
    for (const region of masks) {
      let count = 0;
      for (let i = 0; i < occupied.length; i += 1) {
        if (region.pixels[i * 4 + 3] < 128) continue;
        if (occupied[i]) { showToast('修改区域重叠，请调整后再提交。', 'error'); return; }
        occupied[i] = 1; count += 1;
      }
      if (!count) { showToast('每个修改区域都需要选区。', 'info'); return; }
    }
    setBusy(true);
    try {
      const output = document.createElement('canvas'); output.width = image.width; output.height = image.height;
      const ctx = output.getContext('2d')!;
      const payload = masks.map((region) => {
        const pixels = ctx.createImageData(image.width, image.height);
        pixels.data.fill(255);
        for (let i = 0; i < occupied.length; i += 1) if (region.pixels[i * 4 + 3] >= 128) pixels.data[i * 4 + 3] = 0;
        ctx.putImageData(pixels, 0, 0);
        return { prompt: region.prompt, maskDataUrl: output.toDataURL('image/png') };
      });
      const result = await onSubmit(payload);
      if (result) setTaskId(result);
    } catch (error) { showToast(String(error), 'error'); }
    finally { setBusy(false); }
  }

  return <div className="image-studio-overlay image-studio-overlay-top"><section className="image-studio-dialog image-studio-mask-dialog" role="dialog" aria-modal="true" aria-label="局部修改选区">
    <div className="image-studio-panel-head"><h2>局部修改</h2><button type="button" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button></div>
    <div className="image-studio-mask-tools">
      <button type="button" aria-pressed={tool === 'rectangle'} onClick={() => setTool('rectangle')}><MousePointer2 size={17} /> 矩形框选</button>
      <button type="button" aria-pressed={tool === 'brush'} onClick={() => setTool('brush')}><Paintbrush size={17} /> 画笔圈选</button>
      <button type="button" aria-pressed={tool === 'magic'} onClick={() => setTool('magic')} disabled={busy}><WandSparkles size={17} /> 魔法套选</button>
      <button type="button" aria-pressed={subtract} onClick={() => setSubtract(!subtract)}><Eraser size={17} /> {subtract ? '减选' : '补选'}</button>
      <button type="button" onClick={() => { const id = regions.length + 1; setRegions((items) => [...items, { id, prompt: '' }]); setActive(id); }}><Plus size={17} /> 新增修改区域</button>
      <label>笔刷 <input type="range" min="5" max="100" value={radius} onChange={(event) => setRadius(Number(event.target.value))} /></label>
      <label>缩放 <input type="range" min="1" max="8" step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
      <button type="button" onClick={() => { setZoom(1); if (stageRef.current) stageRef.current.scrollTo(0, 0); }}>适应窗口</button>
      <button type="button" onClick={() => { if (image && stageRef.current) setZoom(Math.max(1, image.width / stageRef.current.clientWidth)); }}>原始尺寸</button>
    </div>
    <div ref={stageRef} className="image-studio-mask-stage" onWheel={(event) => { if ((event.target as HTMLElement).closest('.image-studio-mask-frame')) {
      event.preventDefault(); const stage = stageRef.current!; const next = Math.min(8, Math.max(1, zoom * (event.deltaY < 0 ? 1.25 : .8)));
      const factor = next / zoom; const x = event.clientX - stage.getBoundingClientRect().left; const y = event.clientY - stage.getBoundingClientRect().top;
      const left = (stage.scrollLeft + x) * factor - x; const top = (stage.scrollTop + y) * factor - y;
      setZoom(next); requestAnimationFrame(() => stage.scrollTo(left, top));
    } }} onPointerDownCapture={(event) => { if (event.button !== 1) return; const stage = stageRef.current!;
      pan.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop }; stage.setPointerCapture(event.pointerId); event.preventDefault();
    }} onPointerMove={(event) => { if (!pan.current || !stageRef.current) return;
      stageRef.current.scrollTo(pan.current.left + pan.current.x - event.clientX, pan.current.top + pan.current.y - event.clientY);
    }} onPointerUp={() => { pan.current = null; }} onPointerCancel={() => { pan.current = null; }}><div className="image-studio-mask-frame" style={{ width: `${zoom * 100}%`, aspectRatio: image ? `${image.width}/${image.height}` : '4/3' }}>
      {image && <img src={image.dataUrl} alt="待处理原图" />}
      {image && regions.map((region) => <canvas key={region.id} ref={(node) => {
        if (node) { canvases.current.set(region.id, node); if (node.width !== image.width) { node.width = image.width; node.height = image.height; } }
        else canvases.current.delete(region.id);
      }} style={{ opacity: region.id === active ? .55 : .28, pointerEvents: 'none' }} />)}
      {image && regions.map((region) => region.center && <button key={region.id} type="button" className={`image-studio-region-number${region.id === active ? ' active' : ''}`}
        style={{ left: `${region.center.x / image.width * 100}%`, top: `${region.center.y / image.height * 100}%` }} onClick={() => setActive(region.id)}>{region.id}</button>)}
      {image && <canvas ref={(node) => { if (node && node.width !== image.width) { node.width = image.width; node.height = image.height; } }}
        aria-label="图片选区画布" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; }} />}
    </div></div>
    <div className="image-studio-region-inputs">{regions.map((region) => <label key={region.id} className={region.id === active ? 'active' : ''}>
      修改区域 {region.id}<textarea value={region.prompt} onFocus={() => setActive(region.id)} onChange={(event) => setRegions((items) => items.map((item) => item.id === region.id ? { ...item, prompt: event.target.value } : item))} />
    </label>)}</div>
    <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="image-studio-primary" disabled={busy || Boolean(taskId) || !image} onClick={() => void submit()}>{busy || taskId ? '处理中' : '提交局部修改'}</button></footer>
  </section></div>;
}
