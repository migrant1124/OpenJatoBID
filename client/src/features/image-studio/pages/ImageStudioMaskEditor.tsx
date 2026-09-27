import { useEffect, useRef, useState } from 'react';
import { Eraser, Paintbrush, Redo2, RotateCcw, Undo2, X } from 'lucide-react';
import { useToast } from '../../../shared/ui';

type Point = { x: number; y: number };
type Stroke = { points: Point[]; erase: boolean; radius: number };

export function ImageStudioMaskEditor({ source, initialLayerId, mode, onClose, onSubmit }: {
  source: { workId?: string; assetId?: string }; initialLayerId?: string;
  mode: 'edit' | 'refine'; onClose: () => void; onSubmit: (maskDataUrl: string) => Promise<string | void>;
}) {
  const { showToast } = useToast();
  const [image, setImage] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [erase, setErase] = useState(false);
  const [radius, setRadius] = useState(28);
  const [zoom, setZoom] = useState(1);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [taskId, setTaskId] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const cursor = useRef(0);
  const current = useRef<Stroke | null>(null);
  const base = useRef<ImageData | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([window.yibiao!.imageStudio.readManagedImage(source),
      initialLayerId ? window.yibiao!.imageStudio.readManagedImage({ layerId: initialLayerId }) : Promise.resolve(null)])
      .then(([original, layer]) => {
        if (!live) return;
        setImage(original);
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = original.width; canvas.height = original.height;
        const ctx = canvas.getContext('2d')!;
        if (layer) {
          const picture = new Image();
          picture.onload = () => {
            ctx.drawImage(picture, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < pixels.data.length; i += 4) {
              pixels.data[i] = 236; pixels.data[i + 1] = 62; pixels.data[i + 2] = 68;
            }
            ctx.putImageData(pixels, 0, 0);
            base.current = pixels;
            setRevision((value) => value + 1);
          };
          picture.src = layer.dataUrl;
        } else base.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }).catch((error) => showToast(String(error), 'error'));
    return () => { live = false; };
  }, [source.workId, source.assetId, initialLayerId, showToast]);

  useEffect(() => {
    if (!taskId) return;
    let live = true;
    const inspect = (tasks: Array<{ taskId: string; status: string; error: string | null }>) => {
      const task = tasks.find((item) => item.taskId === taskId);
      if (task?.status === 'completed') onClose();
      if (task && ['failed', 'partial', 'unknown', 'cancelled', 'stopped_waiting'].includes(task.status)) {
        setTaskId('');
        showToast(task.error || '局部修改未完成，选区已保留。', 'error');
      }
    };
    const unsubscribe = window.yibiao!.imageStudio.onEvent((event) => inspect(event.tasks));
    void window.yibiao!.imageStudio.getState().then((state) => { if (live) inspect(state.tasks); });
    return () => { live = false; unsubscribe(); };
  }, [taskId, onClose, showToast]);

  function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
    if (!stroke.points.length) return;
    ctx.save();
    ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = '#ec3e44'; ctx.fillStyle = '#ec3e44'; ctx.lineWidth = stroke.radius * 2;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.stroke();
    if (stroke.points.length === 1) {
      ctx.beginPath(); ctx.arc(stroke.points[0].x, stroke.points[0].y, stroke.radius, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas || !base.current) return;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(base.current, 0, 0);
    strokes.current.slice(0, cursor.current).forEach((stroke) => drawStroke(ctx, stroke));
    if (current.current) drawStroke(ctx, current.current);
    setRevision((value) => value + 1);
  }
  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width,
      y: (event.clientY - rect.top) * event.currentTarget.height / rect.height };
  }
  async function submit() {
    const canvas = canvasRef.current;
    if (!canvas || (!cursor.current && !initialLayerId)) { showToast('请先标记需要处理的区域。', 'info'); return; }
    setBusy(true);
    try {
      if (mode === 'refine') { await onSubmit(canvas.toDataURL('image/png')); onClose(); }
      else {
        const output = document.createElement('canvas');
        output.width = canvas.width; output.height = canvas.height;
        const ctx = output.getContext('2d')!;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, output.width, output.height);
        ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(canvas, 0, 0);
        const submittedTaskId = await onSubmit(output.toDataURL('image/png'));
        if (submittedTaskId) setTaskId(submittedTaskId);
      }
    } catch (error) { showToast(String(error), 'error'); }
    finally { setBusy(false); }
  }

  return <div className="image-studio-overlay image-studio-overlay-top"><section className="image-studio-dialog image-studio-mask-dialog" role="dialog" aria-modal="true" aria-label={mode === 'edit' ? '局部修改选区' : '细修图层轮廓'}>
    <div className="image-studio-panel-head"><h2>{mode === 'edit' ? '局部修改' : '细修主体图层'}</h2><button type="button" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button></div>
    <div className="image-studio-mask-tools">
      <button type="button" aria-pressed={!erase} onClick={() => setErase(false)} title="保留或选择区域"><Paintbrush size={17} /> 画笔</button>
      <button type="button" aria-pressed={erase} onClick={() => setErase(true)} title="擦除已选区域"><Eraser size={17} /> 橡皮</button>
      <label>笔刷 <input type="range" min="5" max="100" value={radius} onChange={(event) => setRadius(Number(event.target.value))} /></label>
      <button type="button" title="撤销" aria-label="撤销" disabled={!cursor.current} onClick={() => { cursor.current -= 1; redraw(); }}><Undo2 size={17} /></button>
      <button type="button" title="重做" aria-label="重做" disabled={cursor.current >= strokes.current.length} onClick={() => { cursor.current += 1; redraw(); }}><Redo2 size={17} /></button>
      <button type="button" title="清空笔画" onClick={() => { strokes.current = []; cursor.current = 0; redraw(); }}><RotateCcw size={17} /> 清空</button>
      <label>缩放 <input type="range" min="1" max="3" step="0.25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label>
    </div>
    <div className="image-studio-mask-stage"><div className="image-studio-mask-frame" style={{ width: `${zoom * 100}%`, aspectRatio: image ? `${image.width}/${image.height}` : '4/3' }}>
      {image && <img src={image.dataUrl} alt="待处理原图" />}
      <canvas ref={canvasRef} style={{ opacity: .45 }} aria-label="图片选区画布"
        onPointerDown={(event) => { current.current = { points: [point(event)], erase, radius }; event.currentTarget.setPointerCapture(event.pointerId); redraw(); }}
        onPointerMove={(event) => { if (!current.current) return; current.current.points.push(point(event)); redraw(); }}
        onPointerUp={() => { if (!current.current) return; strokes.current = strokes.current.slice(0, cursor.current); strokes.current.push(current.current); cursor.current += 1; current.current = null; redraw(); }} />
    </div></div>
    <p className="image-studio-muted">{mode === 'edit' ? '红色区域允许修改，选区之外的原图像素会在结果中保留。' : '红色区域属于主体；隐藏主体后未补全的背景可能露出透明区域。'}</p>
    <footer><button type="button" onClick={onClose}>取消</button><button type="button" className="image-studio-primary" disabled={busy || Boolean(taskId) || !image} onClick={() => void submit()}>{busy || taskId ? '处理中' : mode === 'edit' ? '提交局部修改' : '保存细修'}</button></footer>
    <span hidden>{revision}</span>
  </section></div>;
}
