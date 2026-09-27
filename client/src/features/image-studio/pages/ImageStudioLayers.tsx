import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Eye, EyeOff, Paintbrush, Plus, X } from 'lucide-react';
import type { ImageStudioLayerSet } from '../../../shared/types/ipc';
import { useToast } from '../../../shared/ui';
import { ImageStudioMaskEditor } from './ImageStudioMaskEditor';

export function ImageStudioLayers({ source, onClose }: {
  source: { workId?: string; assetId?: string }; onClose: () => void;
}) {
  const { showToast } = useToast();
  const [sessions, setSessions] = useState<ImageStudioLayerSet[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [refining, setRefining] = useState(false);
  const selected = sessions.find((session) => session.setId === selectedId) || sessions[0];

  useEffect(() => {
    void window.yibiao!.imageStudio.listLayerSets(source).then((items) => { setSessions(items); setSelectedId(items[0]?.setId || ''); })
      .catch((error) => showToast(String(error), 'error'));
  }, [source.workId, source.assetId, showToast]);

  async function create() {
    setBusy(true);
    try {
      const session = await window.yibiao!.imageStudio.createLayerSet(source);
      setSessions((items) => [session, ...items]); setSelectedId(session.setId);
    } catch (error) { showToast(String(error), 'error'); }
    finally { setBusy(false); }
  }
  async function update(layerId: string, values: { name?: string; visible?: boolean; sortOrder?: number }) {
    if (!selected) return;
    try {
      const session = await window.yibiao!.imageStudio.updateLayer({ setId: selected.setId, layerId, ...values });
      setSessions((items) => items.map((item) => item.setId === session.setId ? session : item));
    } catch (error) { showToast(String(error), 'error'); }
  }
  async function move(index: number, direction: number) {
    if (!selected) return;
    const other = selected.layers[index + direction];
    if (!other) return;
    const layer = selected.layers[index];
    await update(other.layerId, { sortOrder: layer.sortOrder });
    await update(layer.layerId, { sortOrder: other.sortOrder });
  }
  async function exportPsd() {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await window.yibiao!.imageStudio.exportLayeredPsd({ setId: selected.setId });
      if (!result.canceled) showToast(`已导出 ${result.layerCount} 个真实像素层`, 'success');
    } catch (error) { showToast(String(error), 'error'); }
    finally { setBusy(false); }
  }

  return <div className="image-studio-overlay"><section className="image-studio-dialog image-studio-layer-dialog" role="dialog" aria-modal="true" aria-label="分层 PSD">
    <div className="image-studio-panel-head"><h2>分层 PSD</h2><button type="button" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button></div>
    <div className="image-studio-layer-toolbar"><button type="button" disabled={busy} onClick={() => void create()}><Plus size={16} /> {busy ? '分析中' : '自动拆层'}</button>
      {sessions.length > 1 && <select aria-label="拆层会话" value={selected?.setId || ''} onChange={(event) => setSelectedId(event.target.value)}>{sessions.map((session) => <option key={session.setId} value={session.setId}>{new Date(session.createdAt).toLocaleString()}</option>)}</select>}
      <button type="button" disabled={!selected || busy} onClick={() => void exportPsd()}><Download size={16} /> 导出 PSD</button></div>
    {selected ? <div className="image-studio-layer-layout">
      <div className="image-studio-layer-preview" style={{ aspectRatio: `${selected.width}/${selected.height}` }}>
        {selected.layers.filter((layer) => layer.visible).map((layer) => <img key={layer.layerId} src={layer.assetUrl} alt={layer.name} />)}
      </div>
      <div className="image-studio-layer-list">{selected.layers.map((layer, index) => <div key={layer.layerId}>
        <img src={layer.assetUrl} alt="" /><input aria-label={`${layer.name}名称`} value={layer.name} onChange={(event) => {
          const name = event.target.value;
          setSessions((items) => items.map((item) => item.setId === selected.setId ? { ...item,
            layers: item.layers.map((entry) => entry.layerId === layer.layerId ? { ...entry, name } : entry) } : item));
        }} onBlur={() => void update(layer.layerId, { name: layer.name })} />
        <button type="button" title={layer.visible ? '隐藏图层' : '显示图层'} aria-label={layer.visible ? '隐藏图层' : '显示图层'} onClick={() => void update(layer.layerId, { visible: !layer.visible })}>{layer.visible ? <Eye size={16} /> : <EyeOff size={16} />}</button>
        <button type="button" title="上移图层" aria-label="上移图层" disabled={index === 0} onClick={() => void move(index, -1)}><ArrowUp size={16} /></button>
        <button type="button" title="下移图层" aria-label="下移图层" disabled={index === selected.layers.length - 1} onClick={() => void move(index, 1)}><ArrowDown size={16} /></button>
      </div>)}<button type="button" disabled={busy} onClick={() => setRefining(true)}><Paintbrush size={16} /> 细修主体边缘</button>
      <p className="image-studio-muted">像素图层可独立隐藏、移动；未补全的主体背面或背景会保留透明空洞。</p></div>
    </div> : <p className="image-studio-muted">选择自动拆层后检查前景和背景，再细修并导出。</p>}
    {refining && selected?.subjectLayerId && <ImageStudioMaskEditor source={source} initialLayerId={selected.subjectLayerId} mode="refine" onClose={() => setRefining(false)} onSubmit={async (maskDataUrl) => {
      const session = await window.yibiao!.imageStudio.refineLayerSet({ setId: selected.setId, maskDataUrl });
      setSessions((items) => items.map((item) => item.setId === session.setId ? session : item));
    }} />}
  </section></div>;
}
