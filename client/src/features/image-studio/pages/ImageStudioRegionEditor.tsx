import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleHelp, Maximize, Minus, Paintbrush, Plus, Redo2, RotateCcw, SquareDashed, Trash2, Undo2, WandSparkles, X } from 'lucide-react';
import { useToast } from '../../../shared/ui';
import { ImageStudioEditSession, type EditPoint, type EditRegion } from './ImageStudioEditSession';

export type StudioEditRegion = { regionId: number; tool: Tool; prompt: string; maskDataUrl: string };
type Tool = EditRegion['tool'];
type Picture = { dataUrl: string; width: number; height: number; sourceSha256: string };
const COLORS = ['#ef3947', '#2867ee', '#49bd4a', '#b15de0', '#e89022', '#0eaaaf'];
const MAGIC_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="m3 21 12-12m-2-6 1 3m6 0-3 1m2 7-3-1M9 3 8 6" fill="none" stroke="#2165e8" stroke-width="2" stroke-linecap="round"/><path d="m2 19 3 3" stroke="#fff" stroke-width="3"/></svg>')}") 2 21, crosshair`;

export function ImageStudioRegionEditor({ source, onClose, onSubmit }: {
  source: { workId: string; width: number; height: number };
  onClose: () => void;
  onSubmit: (regions: StudioEditRegion[], sourceWorkId: string, sourceSha256: string, requestId: string) => Promise<string | void>;
}) {
  const { showToast } = useToast();
  const frozen = useRef(source).current;
  const session = useRef(new ImageStudioEditSession()).current;
  const [view, setView] = useState(session.state);
  const [image, setImage] = useState<Picture | null>(null);
  const [tool, setTool] = useState<Tool>('brush');
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);
  const [fitMode, setFitMode] = useState(true);
  const [sorting, setSorting] = useState<'asc' | 'desc'>('asc');
  const [space, setSpace] = useState(false);
  const [segmenting, setSegmenting] = useState(false);
  const [magicFeedback, setMagicFeedback] = useState<EditPoint | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'close' | 'clear' | null>(null);
  const [viewport, setViewport] = useState({ left: 0, top: 0, width: 1, height: 1 });
  const stageRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const scratchRef = useRef<HTMLCanvasElement>(null);
  const cardRefs = useRef(new Map<number, HTMLTextAreaElement>());
  const pixels = useRef(new Map<number, Uint8Array>());
  const gesture = useRef<{ start: EditPoint; points: EditPoint[]; pointerId: number } | null>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const miniDragging = useRef(false);
  const magicSerial = useRef(0);
  const submitLock = useRef(false);
  const live = useRef(true);

  const refresh = () => {
    const retained = new Set([session.state, ...session.past, ...session.future].flatMap((snapshot) => snapshot.regions.map((item) => item.id)));
    for (const id of pixels.current.keys()) if (!retained.has(id)) pixels.current.delete(id);
    setView({ ...session.state });
  };
  const valid = view.regions.filter((region) => region.prompt.trim());
  const pending = view.regions.some((region) => !region.prompt.trim());
  const ordered = sorting === 'asc' ? view.regions : [...view.regions].reverse();
  const color = (id: number) => COLORS[(id - 1) % COLORS.length];

  useEffect(() => { dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, []);

  useEffect(() => {
    if (view.activeId == null) return;
    const field = cardRefs.current.get(view.activeId);
    field?.scrollIntoView({ block: 'nearest' });
    field?.focus({ preventScroll: true });
  }, [view.activeId, view.regions.length]);

  useEffect(() => {
    live.current = true;
    void window.yibiao!.imageStudio.readManagedImage({ workId: frozen.workId }).then(async (result) => {
      const picture = new Image(); picture.src = result.dataUrl; await picture.decode();
      if (!live.current) return;
      if (result.width !== frozen.width || result.height !== frozen.height) throw new Error('编辑源图尺寸已变化，请重新打开。');
      setImage(result);
    }).catch((reason) => { if (live.current) setError(String(reason)); });
    return () => { live.current = false; magicSerial.current += 1; };
  }, [frozen.workId, frozen.width, frozen.height]);

  useEffect(() => {
    if (!taskId) return;
    let active = true;
    const inspect = (tasks: Array<{ taskId: string; status: string; error: string | null }>) => {
      if (!active) return;
      const task = tasks.find((item) => item.taskId === taskId);
      if (task?.status === 'completed') onClose();
      if (task && ['failed', 'partial', 'unknown', 'cancelled', 'stopped_waiting'].includes(task.status)) {
        submitLock.current = false; setTaskId(''); setError(task.error || '局部修改未完成，选区和意见已保留。');
      }
    };
    const unsubscribe = window.yibiao!.imageStudio.onEvent((event) => inspect(event.tasks));
    void window.yibiao!.imageStudio.getState().then((state) => inspect(state.tasks));
    return () => { active = false; unsubscribe(); };
  }, [taskId, onClose]);

  function syncViewport() {
    const stage = stageRef.current;
    if (stage) setViewport({ left: stage.scrollLeft, top: stage.scrollTop, width: stage.clientWidth, height: stage.clientHeight });
  }
  function navigateMiniMap(event: React.PointerEvent<HTMLDivElement>) {
    const stage = stageRef.current; const frame = frameRef.current;
    if (!stage || !frame || !image) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(image.width, (event.clientX - rect.left) / mapScale));
    const y = Math.max(0, Math.min(image.height, (event.clientY - rect.top) / mapScale));
    stage.scrollTo(frame.offsetLeft + x * scale - stage.clientWidth / 2,
      frame.offsetTop + y * scale - stage.clientHeight / 2);
  }
  function applyScale(next: number, clientX?: number, clientY?: number) {
    if (!image || gesture.current) return;
    const stage = stageRef.current; const frame = frameRef.current;
    const bounded = Math.max(.1, Math.min(8, next));
    if (!stage || !frame || bounded === scaleRef.current) return;
    const stageRect = stage.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const x = clientX ?? stageRect.left + stage.clientWidth / 2;
    const y = clientY ?? stageRect.top + stage.clientHeight / 2;
    const imageX = (x - frameRect.left) / scaleRef.current;
    const imageY = (y - frameRect.top) / scaleRef.current;
    scaleRef.current = bounded; setScale(bounded); setFitMode(false);
    requestAnimationFrame(() => {
      const updated = frameRef.current;
      if (!updated) return;
      stage.scrollTo(updated.offsetLeft + imageX * bounded - (x - stageRect.left),
        updated.offsetTop + imageY * bounded - (y - stageRect.top));
      syncViewport();
    });
  }
  function fit() {
    if (!image || !stageRef.current) return;
    const stage = stageRef.current;
    const next = Math.min(stage.clientWidth / image.width, stage.clientHeight / image.height);
    scaleRef.current = next; setScale(next); setFitMode(true);
    requestAnimationFrame(() => { stage.scrollTo(0, 0); syncViewport(); });
  }
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !image) return;
    const resize = new ResizeObserver(() => { if (fitMode) fit(); else syncViewport(); });
    resize.observe(stage);
    if (fitMode) fit();
    return () => resize.disconnect();
  }, [image, fitMode]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
      applyScale(scaleRef.current * Math.exp(-delta * .002), event.clientX, event.clientY);
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    return () => stage.removeEventListener('wheel', wheel);
  }, [image]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.isComposing) return;
      if (event.code === 'Space') {
        if (event.target instanceof HTMLElement && event.target.closest('button,[role="button"]')) return;
        event.preventDefault(); setSpace(true);
      }
      if (event.key === 'Escape') { cancelGesture(); magicSerial.current += 1; setSegmenting(false); setConfirm(null); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    };
    const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') setSpace(false); };
    const blur = () => { setSpace(false); cancelGesture(); };
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur); };
  }, [view, image]);

  function focusRegion(id: number) {
    requestAnimationFrame(() => {
      const field = cardRefs.current.get(id);
      field?.scrollIntoView({ block: 'nearest' }); field?.focus({ preventScroll: true });
    });
  }
  function activate(id: number) { session.activate(id); refresh(); focusRegion(id); }
  function cancelGesture() {
    gesture.current = null;
    scratchRef.current?.getContext('2d')?.clearRect(0, 0, frozen.width, frozen.height);
  }
  function undo() {
    magicSerial.current += 1; setSegmenting(false);
    if (gesture.current) { cancelGesture(); return; }
    if (session.undo()) refresh();
  }
  function redo() { if (session.redo()) refresh(); }
  function close() {
    magicSerial.current += 1; setSegmenting(false); cancelGesture();
    session.commitText();
    if (session.valid.length && !taskId) setConfirm('close'); else onClose();
  }
  function trapTab(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Tab') return;
    const root = confirm ? dialogRef.current?.querySelector('.local-edit-confirm') : dialogRef.current;
    const controls = [...(root?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled)') || [])]
      .filter((element) => element.getClientRects().length > 0);
    if (!controls.length) return;
    const first = controls[0]; const last = controls[controls.length - 1];
    if (!root?.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  function imagePoint(event: React.PointerEvent<HTMLCanvasElement>): EditPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(frozen.width, (event.clientX - rect.left) * frozen.width / rect.width)),
      y: Math.max(0, Math.min(frozen.height, (event.clientY - rect.top) * frozen.height / rect.height)) };
  }
  function drawDraft() {
    const ctx = scratchRef.current?.getContext('2d'); const current = gesture.current;
    if (!ctx || !current) return;
    ctx.clearRect(0, 0, frozen.width, frozen.height);
    ctx.save(); ctx.strokeStyle = '#2867ee'; ctx.fillStyle = '#2867ee33'; ctx.lineWidth = Math.max(2, 2 / scaleRef.current);
    ctx.setLineDash([9 / scaleRef.current, 5 / scaleRef.current]); ctx.beginPath();
    if (tool === 'rectangle') {
      const end = current.points[current.points.length - 1];
      ctx.rect(current.start.x, current.start.y, end.x - current.start.x, end.y - current.start.y);
    } else {
      ctx.moveTo(current.start.x, current.start.y);
      current.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    }
    ctx.fill('evenodd'); ctx.stroke(); ctx.restore();
  }
  function selectCanvas(canvas: HTMLCanvasElement, selectedTool: Tool) {
    const ctx = canvas.getContext('2d')!;
    const alpha = ctx.getImageData(0, 0, frozen.width, frozen.height).data;
    const selected = new Uint8Array(frozen.width * frozen.height);
    let left = frozen.width; let top = frozen.height; let right = -1; let bottom = -1; let count = 0;
    for (let y = 0; y < frozen.height; y += 1) for (let x = 0; x < frozen.width; x += 1) {
      const index = y * frozen.width + x;
      if (alpha[index * 4 + 3] < 128) continue;
      selected[index] = 1; count += 1;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (count < 4) return;
    let duplicate: number | undefined;
    if (selectedTool === 'magic') for (const region of session.state.regions) {
      const prior = pixels.current.get(region.id); if (!prior) continue;
      let common = 0; let priorCount = 0;
      for (let i = 0; i < selected.length; i += 1) { if (prior[i]) priorCount += 1; if (selected[i] && prior[i]) common += 1; }
      if (common / (count + priorCount - common) > .9) { duplicate = region.id; break; }
    }
    if (duplicate) { activate(duplicate); showToast('该区域已有修改。', 'info'); return; }
    const edge = document.createElement('canvas'); edge.width = frozen.width; edge.height = frozen.height;
    const edgeCtx = edge.getContext('2d')!; const outline = edgeCtx.createImageData(frozen.width, frozen.height);
    for (let y = 0; y < frozen.height; y += 1) for (let x = 0; x < frozen.width; x += 1) {
      const index = y * frozen.width + x;
      if (!selected[index]) continue;
      if (x < 2 || y < 2 || x >= frozen.width - 2 || y >= frozen.height - 2 ||
        !selected[index - 2] || !selected[index + 2] || !selected[index - 2 * frozen.width] || !selected[index + 2 * frozen.width]) {
        outline.data.set([255, 255, 255, 255], index * 4);
      }
    }
    edgeCtx.putImageData(outline, 0, 0);
    const id = session.add({ tool: selectedTool, maskDataUrl: canvas.toDataURL('image/png'), edgeDataUrl: edge.toDataURL('image/png'),
      center: { x: (left + right) / 2, y: (top + bottom) / 2 },
      bounds: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 } });
    pixels.current.set(id, selected); refresh(); focusRegion(id);
  }
  async function magic(point: EditPoint) {
    const serial = ++magicSerial.current;
    setMagicFeedback(point);
    setTimeout(() => { if (live.current) setMagicFeedback(null); }, 180);
    setSegmenting(true); setError('');
    try {
      const result = await window.yibiao!.imageStudio.segmentObject({ workId: frozen.workId, point });
      const mask = new Image(); mask.src = result.maskDataUrl; await mask.decode();
      if (serial !== magicSerial.current || !live.current) return;
      const canvas = document.createElement('canvas'); canvas.width = frozen.width; canvas.height = frozen.height;
      canvas.getContext('2d')!.drawImage(mask, 0, 0, frozen.width, frozen.height);
      selectCanvas(canvas, 'magic');
    } catch (reason) { if (serial === magicSerial.current) setError(`对象识别失败：${String(reason)}`); }
    finally { if (serial === magicSerial.current) setSegmenting(false); }
  }
  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!image || submitting || taskId || segmenting || event.button !== 0 || space) return;
    const start = imagePoint(event);
    if (tool === 'magic') { void magic(start); return; }
    gesture.current = { start, points: [start], pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId); drawDraft();
  }
  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!gesture.current || gesture.current.pointerId !== event.pointerId) return;
    gesture.current.points.push(imagePoint(event)); drawDraft();
  }
  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    current.points.push(imagePoint(event)); cancelGesture();
    const end = current.points[current.points.length - 1];
    if (tool === 'rectangle' && Math.abs(end.x - current.start.x) * Math.abs(end.y - current.start.y) < 9) return;
    if (tool === 'brush' && (current.points.length < 4 ||
      current.points.reduce((sum, point, index) => index ? sum + Math.hypot(point.x - current.points[index - 1].x, point.y - current.points[index - 1].y) : 0, 0) < 12)) return;
    const canvas = document.createElement('canvas'); canvas.width = frozen.width; canvas.height = frozen.height;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.beginPath();
    if (tool === 'rectangle') ctx.rect(Math.min(current.start.x, end.x), Math.min(current.start.y, end.y), Math.abs(end.x - current.start.x), Math.abs(end.y - current.start.y));
    else { ctx.moveTo(current.start.x, current.start.y); current.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y)); ctx.closePath(); }
    ctx.fill('evenodd'); selectCanvas(canvas, tool);
  }

  function conflicts() {
    const ids = new Set<number>();
    for (let a = 0; a < valid.length; a += 1) for (let b = a + 1; b < valid.length; b += 1) {
      const first = pixels.current.get(valid[a].id); const second = pixels.current.get(valid[b].id);
      if (!first || !second) continue;
      let sharedInterior = 0;
      for (let y = 1; y < frozen.height - 1 && sharedInterior < 4; y += 1) for (let x = 1; x < frozen.width - 1; x += 1) {
        const i = y * frozen.width + x;
        if (first[i] && second[i] && [i - 1, i + 1, i - frozen.width, i + frozen.width].every((j) => first[j] && second[j])) sharedInterior += 1;
      }
      if (sharedInterior >= 4) { ids.add(valid[a].id); ids.add(valid[b].id); }
    }
    return ids;
  }
  const maskKey = valid.map((region) => region.id).join(',');
  // Masks never change for an ID; text edits and zoom must not rescan millions of pixels.
  const conflictIds = useMemo(conflicts, [maskKey]);
  async function submit() {
    if (!image || submitLock.current || taskId) return;
    session.settle(); refresh();
    const items = session.valid;
    if (!items.length) { setError('请先选择并填写一处修改。'); return; }
    if (items.some((item) => item.prompt.length > 500)) { setError('修改意见不能超过500字。'); return; }
    if (conflictIds.size) { setError('修改区域重叠，请删除冲突区域后重新选择。'); return; }
    submitLock.current = true; setSubmitting(true); setError('');
    try {
      const output = document.createElement('canvas'); output.width = frozen.width; output.height = frozen.height;
      const ctx = output.getContext('2d')!;
      const payload = items.map((item) => {
        const selected = pixels.current.get(item.id)!;
        const data = ctx.createImageData(frozen.width, frozen.height); data.data.fill(255);
        for (let i = 0; i < selected.length; i += 1) if (selected[i]) data.data[i * 4 + 3] = 0;
        ctx.putImageData(data, 0, 0);
        return { regionId: item.id, tool: item.tool, prompt: item.prompt.trim(), maskDataUrl: output.toDataURL('image/png') };
      });
      const result = await onSubmit(payload, frozen.workId, image.sourceSha256, crypto.randomUUID());
      if (result) setTaskId(result);
      else submitLock.current = false;
    } catch (reason) { submitLock.current = false; setError(`局部修改未提交：${String(reason)}`); }
    finally { setSubmitting(false); }
  }

  const mapScale = image ? Math.min(166 / image.width, 108 / image.height) : 1;
  return <div className="image-studio-overlay image-studio-overlay-top local-edit-overlay"><section ref={dialogRef} className="image-studio-dialog local-edit-dialog" role="dialog" aria-modal="true" aria-label="局部修改" onKeyDown={trapTab}>
    <header className="local-edit-head"><div><h2>局部修改</h2><p>选择图片中的区域，输入修改要求，AI 将在保持其它内容不变的情况下进行局部修改</p></div><div className="local-edit-head-actions"><button type="button" onClick={() => showToast('选一次，写一条。滚轮移动画面，Ctrl＋滚轮缩放，空格＋拖动平移。', 'info')}><CircleHelp size={17} /> 使用说明</button><button type="button" aria-label="关闭" onClick={close}><X size={20} /></button></div></header>
    <div className="image-studio-mask-tools local-edit-tools">
      <div className="local-edit-tool-group">{([['brush', Paintbrush, '画笔圈选'], ['rectangle', SquareDashed, '矩形框选'], ['magic', WandSparkles, '魔法套选']] as const).map(([value, Icon, label]) => <button key={value} type="button" aria-pressed={tool === value} disabled={submitting || Boolean(taskId)} onClick={() => { magicSerial.current += 1; setSegmenting(false); cancelGesture(); setTool(value); }}><Icon size={18} /> {label}</button>)}</div>
      <div className="local-edit-tool-group"><button type="button" disabled={!session.past.length && !pending && !gesture.current && !segmenting} onClick={undo} title="撤回选区或修改"><Undo2 size={18} /> 撤回</button><button type="button" disabled={!session.future.length} onClick={redo} title="重做"><Redo2 size={18} /> 重做</button><button type="button" disabled={!view.regions.length || submitting || Boolean(taskId)} onClick={() => { magicSerial.current += 1; setSegmenting(false); if (session.valid.length) setConfirm('clear'); else { session.clear(); refresh(); } }}><Trash2 size={18} /> 清空选区</button></div>
      <div className="local-edit-tool-group local-edit-zoom"><button type="button" aria-label="缩小" onClick={() => applyScale(scale / 1.25)}><Minus size={18} /></button><input aria-label="缩放比例" type="range" min="10" max="800" step="1" value={Math.max(10, Math.min(800, Math.round(scale * 100)))} onChange={(event) => applyScale(Number(event.target.value) / 100)} /><button type="button" aria-label="放大" onClick={() => applyScale(scale * 1.25)}><Plus size={18} /></button><output>{Math.round(scale * 100)}%</output><button type="button" onClick={fit}><Maximize size={17} /> 适应窗口</button><button type="button" onClick={() => applyScale(1)}><RotateCcw size={17} /> 原始尺寸</button></div>
    </div>
    <div className="local-edit-body"><div className="local-edit-canvas-wrap"><div ref={stageRef} className="image-studio-mask-stage local-edit-stage" onScroll={syncViewport}
      onPointerDownCapture={(event) => { if (!space || event.button !== 0 || !stageRef.current) return; const stage = stageRef.current; pan.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop }; stage.setPointerCapture(event.pointerId); event.preventDefault(); }}
      onPointerMove={(event) => { if (!pan.current || !stageRef.current) return; stageRef.current.scrollTo(pan.current.left + pan.current.x - event.clientX, pan.current.top + pan.current.y - event.clientY); }}
      onPointerUp={() => { pan.current = null; }} onPointerCancel={() => { pan.current = null; cancelGesture(); }}>
      {image && <div ref={frameRef} className="image-studio-mask-frame local-edit-frame" style={{ width: image.width * scale, height: image.height * scale }}><img src={image.dataUrl} alt="待修改原图" />
        {view.regions.map((region) => <div key={region.id} className={`local-edit-mask${region.id === view.activeId ? ' active' : ''}`} style={{ backgroundColor: color(region.id), WebkitMaskImage: `url(${region.maskDataUrl})`, maskImage: `url(${region.maskDataUrl})` }} aria-hidden="true" />)}
        {view.regions.map((region) => <div key={region.id} className={`local-edit-edge${region.id === view.activeId ? ' active' : ''}`} style={{ backgroundColor: color(region.id), WebkitMaskImage: `url(${region.edgeDataUrl})`, maskImage: `url(${region.edgeDataUrl})` }} aria-hidden="true" />)}
        <canvas ref={(node) => { if (node && node.width !== image.width) { node.width = image.width; node.height = image.height; } scratchRef.current = node; }} className="local-edit-scratch" aria-label="图片选区画布" style={{ cursor: space ? 'grab' : tool === 'magic' ? MAGIC_CURSOR : 'crosshair' }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={cancelGesture} onLostPointerCapture={() => { if (gesture.current) cancelGesture(); }} />
        {magicFeedback && <span className="local-edit-click" style={{ left: `${magicFeedback.x / image.width * 100}%`, top: `${magicFeedback.y / image.height * 100}%` }} aria-hidden="true" />}
        {view.regions.map((region, index) => <button key={region.id} type="button" className={`image-studio-region-number${region.id === view.activeId ? ' active' : ''}`} style={{ left: `${region.center.x / image.width * 100}%`, top: `${region.center.y / image.height * 100}%`, backgroundColor: color(region.id) }} onClick={() => activate(region.id)} aria-label={`激活修改区域 ${index + 1}`}>{index + 1}</button>)}
        {view.regions.find((region) => region.id === view.activeId && !region.prompt.trim()) && <div className="local-edit-bubble">已选择区域 {view.regions.findIndex((region) => region.id === view.activeId) + 1}<br />请输入要修改的内容</div>}
      </div>}</div>
      {image && <div className="local-edit-minimap" aria-label="图片导航图" onPointerDown={(event) => { miniDragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); navigateMiniMap(event); }} onPointerMove={(event) => { if (miniDragging.current) navigateMiniMap(event); }} onPointerUp={() => { miniDragging.current = false; }} onPointerCancel={() => { miniDragging.current = false; }}><img src={image.dataUrl} alt="原图导航" style={{ width: image.width * mapScale, height: image.height * mapScale }} /><span style={{ left: Math.max(0, (viewport.left - (frameRef.current?.offsetLeft || 0)) / scale * mapScale), top: Math.max(0, (viewport.top - (frameRef.current?.offsetTop || 0)) / scale * mapScale), width: Math.min(image.width * mapScale, viewport.width / scale * mapScale), height: Math.min(image.height * mapScale, viewport.height / scale * mapScale) }} /></div>}
      <div className="local-edit-pan-hint">滚轮移动 · Ctrl＋滚轮缩放 · 空格拖动</div>
    </div><aside className="local-edit-panel"><div className="local-edit-panel-head"><strong>修改列表（{valid.length}）</strong><select aria-label="修改列表排序" value={sorting} onChange={(event) => setSorting(event.target.value as 'asc' | 'desc')}><option value="asc">按编号升序</option><option value="desc">按编号降序</option></select></div>
      <div className="local-edit-cards">{!view.regions.length && <p className="local-edit-empty">在图片上选择一处区域，完成后在这里输入修改要求。</p>}{ordered.map((region) => { const number = view.regions.findIndex((item) => item.id === region.id) + 1; return <article key={region.id} className={`local-edit-card${region.id === view.activeId ? ' active' : ''}${conflictIds.has(region.id) ? ' conflict' : ''}`} style={{ borderLeftColor: color(region.id) }} onClick={() => activate(region.id)}><div className="local-edit-card-head"><span className="local-edit-card-number" style={{ backgroundColor: color(region.id) }}>{number}</span><strong>修改区域 {number}</strong><button type="button" aria-label={`删除修改区域 ${number}`} disabled={submitting || Boolean(taskId)} onClick={(event) => { event.stopPropagation(); magicSerial.current += 1; setSegmenting(false); session.delete(region.id); refresh(); }}><Trash2 size={17} /></button></div><div className="local-edit-card-content"><div className="local-edit-thumb" style={{ backgroundImage: `url(${image?.dataUrl || ''})`, backgroundSize: image ? `${image.width / region.bounds.width * 100}% ${image.height / region.bounds.height * 100}%` : undefined, backgroundPosition: image ? `${region.bounds.x / Math.max(1, image.width - region.bounds.width) * 100}% ${region.bounds.y / Math.max(1, image.height - region.bounds.height) * 100}%` : undefined }} aria-label={`区域 ${number} 缩略图`} /><textarea ref={(node) => { if (node) cardRefs.current.set(region.id, node); else cardRefs.current.delete(region.id); }} value={region.prompt} maxLength={501} disabled={submitting || Boolean(taskId)} placeholder="请输入要修改的内容" aria-label={`修改区域 ${number} 的要求`} onFocus={() => { if (session.state.activeId !== region.id) { session.activate(region.id); refresh(); } }} onChange={(event) => { session.setPrompt(region.id, event.target.value); refresh(); }} onBlur={() => { if (region.prompt.trim()) { session.commitText(); refresh(); } }} /></div><div className="local-edit-card-foot">{conflictIds.has(region.id) ? '与其他修改区域重叠，请删除后重新选择' : !region.prompt.trim() ? '待填写' : ''}<span>{region.prompt.length}/500</span></div></article>; })}</div><p className="local-edit-tip">选一次，写一条。未填写的选区将在离开该项时放弃；每条修改都可删除。</p></aside></div>
    <footer className="local-edit-footer"><span>{segmenting ? '正在识别对象…' : error || (pending ? '1处待填写' : `${frozen.width} × ${frozen.height} · ${Math.round(scale * 100)}%`)}</span><button type="button" onClick={close}>取消</button><button type="button" className="image-studio-primary" disabled={!valid.length || submitting || Boolean(taskId) || Boolean(conflictIds.size)} onClick={() => void submit()}><WandSparkles size={17} /> {submitting || taskId ? '处理中' : '提交局部修改'}<small>共 {valid.length} 处修改</small></button></footer>
    {confirm && <div className="local-edit-confirm" role="alertdialog" aria-modal="true" aria-label="确认放弃修改"><p>{confirm === 'clear' ? '清空全部选区和修改意见？此操作可以撤回。' : '放弃尚未提交的局部修改？'}</p><button type="button" autoFocus onClick={() => setConfirm(null)}>继续编辑</button><button type="button" onClick={() => { if (confirm === 'clear') { magicSerial.current += 1; setSegmenting(false); session.clear(); refresh(); } else onClose(); setConfirm(null); }}>{confirm === 'clear' ? '清空全部' : '放弃修改'}</button></div>}
  </section></div>;
}
