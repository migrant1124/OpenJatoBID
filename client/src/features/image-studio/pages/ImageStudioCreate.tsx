import { useEffect, useRef, useState } from 'react';
import { Download, Heart, ImagePlus, Layers3, Lightbulb, RotateCcw, Save, Sparkles, WandSparkles } from 'lucide-react';
import type { ImageStudioAsset, ImageStudioState, ImageStudioWork } from '../../../shared/types/ipc';
import { useToast } from '../../../shared/ui';

export type StudioReference = { assetId?: string; workId?: string; role: string; assetUrl: string };

const presets = ['商品图', '海报图', '宣传图', '插画图', '写实图片', '图标／小元素', '背景图', '局部修图'];
const roles = ['主体', '风格', '构图', '色彩'];

interface Props {
  state: ImageStudioState;
  prompt: string;
  setPrompt: (value: string) => void;
  applyPrompt: (value: string) => void;
  undoAppliedPrompt: () => void;
  canUndoAppliedPrompt: boolean;
  preset: string;
  setPreset: (value: string) => void;
  count: number;
  setCount: (value: number) => void;
  references: StudioReference[];
  setReferences: (value: StudioReference[]) => void;
  selectedWork: ImageStudioWork | null;
  selectWork: (id: string) => void;
  newResult: boolean;
  showLatest: () => void;
  start: () => Promise<void>;
  savePrompt: (text: string, originKind?: string) => Promise<void>;
}

export function ImageStudioCreate(props: Props) {
  const { showToast } = useToast();
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp'>('png');
  const [busy, setBusy] = useState<'optimize' | 'invert' | 'import' | null>(null);
  const [candidate, setCandidate] = useState<{ kind: 'optimize' | 'invert'; original: string; text: string; sourceKey: string } | null>(null);
  const [candidateText, setCandidateText] = useState('');
  const [mode, setMode] = useState('优化');
  const requestSerial = useRef(0);
  const selectedSourceKey = props.references[0]?.assetId || props.references[0]?.workId || props.selectedWork?.workId || '';
  const latestSourceKey = useRef(selectedSourceKey);
  latestSourceKey.current = selectedSourceKey;
  const running = props.state.tasks.some((task) => ['queued', 'running', 'sent', 'downloading'].includes(task.status));
  const latestTask = props.state.tasks[0];

  useEffect(() => () => { requestSerial.current += 1; }, []);

  async function importImage() {
    if (props.references.length >= 4) return;
    setBusy('import');
    try {
      const result = await window.yibiao!.imageStudio.importAsset();
      if (!result.canceled && result.asset) {
        const asset: ImageStudioAsset = result.asset;
        props.setReferences([...props.references, { assetId: asset.assetId, assetUrl: asset.assetUrl, role: '主体' }]);
      }
    } catch (error) { showToast(String(error), 'error'); }
    finally { setBusy(null); }
  }

  async function optimize() {
    if (!props.prompt.trim()) return;
    const serial = ++requestSerial.current;
    const original = props.prompt;
    setBusy('optimize');
    try {
      const result = await window.yibiao!.imageStudio.optimizePrompt({ prompt: original, mode });
      if (serial !== requestSerial.current) return;
      setCandidate({ kind: 'optimize', original, text: result.optimized, sourceKey: '' });
      setCandidateText(result.optimized);
    } catch (error) { showToast(String(error), 'error'); }
    finally { if (serial === requestSerial.current) setBusy(null); }
  }

  async function invert() {
    const target = props.references[0] || (props.selectedWork ? { workId: props.selectedWork.workId } : null);
    if (!target) { showToast('请先上传参考图或选择作品。', 'info'); return; }
    const serial = ++requestSerial.current;
    const sourceKey = 'assetId' in target ? target.assetId || '' : target.workId || '';
    setBusy('invert');
    try {
      const result = await window.yibiao!.imageStudio.invertImage({
        assetId: 'assetId' in target ? target.assetId : undefined,
        workId: 'workId' in target ? target.workId : undefined,
      });
      if (serial !== requestSerial.current || latestSourceKey.current !== sourceKey) return;
      setCandidate({ kind: 'invert', original: props.prompt, text: result.prompt, sourceKey });
      setCandidateText(result.prompt);
    } catch (error) { showToast(String(error), 'error'); }
    finally { if (serial === requestSerial.current) setBusy(null); }
  }

  async function exportWork() {
    if (!props.selectedWork) return;
    try {
      const result = await window.yibiao!.imageStudio.exportImage({ workId: props.selectedWork.workId, format });
      if (!result.canceled) showToast('图片已导出', 'success');
    } catch (error) { showToast(String(error), 'error'); }
  }

  const applyAllowed = candidate && props.prompt === candidate.original &&
    (candidate.kind === 'optimize' || selectedSourceKey === candidate.sourceKey);

  return <div className="image-studio-create-shell">
    <div className="image-studio-model-line">沿用设置 <span>文本：{props.state.textModelName || '未配置'}</span><span>生图：{props.state.imageModel.name || '未配置'} · {props.state.imageModel.size || '未配置尺寸'}</span></div>
    <div className="image-studio-workspace">
      <section className="image-studio-compose" aria-label="创作输入">
        <div className="image-studio-panel-head"><h2>创作输入</h2><small>自动保存草稿</small></div>
        <label htmlFor="image-studio-prompt">图片需求</label>
        <textarea id="image-studio-prompt" maxLength={10001} value={props.prompt} onChange={(event) => props.setPrompt(event.target.value)} placeholder="用中文描述主体、场景、光线与希望保留的细节" />
        <div className="image-studio-field-foot"><span>{props.prompt.length.toLocaleString()} / 10,000</span></div>
        <div className="image-studio-tool-row">
          <button type="button" onClick={() => void optimize()} disabled={!props.prompt.trim() || Boolean(busy)} title="优化提示词"><WandSparkles size={16} /> 优化提示词</button>
          <button type="button" onClick={() => void invert()} disabled={Boolean(busy)} title="根据图片生成参考描述"><ImagePlus size={16} /> 反推提示词</button>
          <button type="button" onClick={() => void props.savePrompt(props.prompt)} disabled={!props.prompt.trim()} title="保存到我的提示词"><Save size={16} /> 保存</button>
          {props.canUndoAppliedPrompt && <button type="button" onClick={props.undoAppliedPrompt} title="撤销刚应用的提示词"><RotateCcw size={16} /> 撤销应用</button>}
        </div>
        <label>任务类型</label>
        <div className="image-studio-presets">{presets.map((item) => <button key={item} type="button" className={props.preset === item ? 'active' : ''} aria-pressed={props.preset === item} onClick={() => props.setPreset(item)}>{item}</button>)}</div>
        <div className="image-studio-field-title"><label>参考图片 <span>可选</span></label><small>{props.references.length} / 4</small></div>
        <div className="image-studio-reference-list">
          {props.references.map((reference, index) => <div className="image-studio-reference" key={reference.assetId || reference.workId}>
            <img src={reference.assetUrl} alt={`参考图片 ${index + 1}`} />
            <select aria-label={`参考图片 ${index + 1} 用途`} value={reference.role} onChange={(event) => props.setReferences(props.references.map((item, position) => position === index ? { ...item, role: event.target.value } : item))}>{roles.map((role) => <option key={role}>{role}</option>)}</select>
            <button type="button" aria-label={`移除参考图片 ${index + 1}`} title="移除参考图片" onClick={() => props.setReferences(props.references.filter((_, position) => position !== index))}>×</button>
          </div>)}
          {props.references.length < 4 && <button type="button" className="image-studio-add-reference" onClick={() => void importImage()} disabled={busy === 'import'} title="添加参考图片"><ImagePlus size={20} /><span>添加</span></button>}
        </div>
        {props.references.length > 0 && <p className="image-studio-warning">参考图已保存在草稿中；当前渠道的多图请求合同尚待验证，提交前会明确阻止，不会忽略图片。</p>}
        <label>图片尺寸</label><div className="image-studio-static-choice">{props.state.imageModel.size || '由设置决定'} <small>仅使用当前已测试配置</small></div>
        <div className="image-studio-two-fields"><label>生成张数<select value={props.count} onChange={(event) => props.setCount(Number(event.target.value))}><option value={1}>1 张</option><option value={2}>2 张</option><option value={4}>4 张</option></select></label><label>画质<select value="current" disabled><option value="current">当前渠道设置</option></select></label></div>
        <button type="button" className="image-studio-primary image-studio-generate" onClick={() => void props.start()} disabled={!props.state.imageModel.available || !props.prompt.trim() || props.prompt.length > 10000 || running}><Sparkles size={17} /> {running ? '生成中' : '生成图片'}</button>
        {!props.state.imageModel.available && <p className="image-studio-warning">请先在设置中配置可用的生图模型。</p>}
      </section>
      <section className="image-studio-result" aria-label="生成结果">
        <div className="image-studio-panel-head"><h2>生成结果</h2><div className="image-studio-task-head">{latestTask && <small>{latestTask.status} · {latestTask.completedCount}/{latestTask.requestedCount}</small>}{running && latestTask && <button type="button" onClick={() => void window.yibiao!.imageStudio.cancelTask({ taskId: latestTask.taskId }).catch((error) => showToast(String(error), 'error'))}>停止等待</button>}</div></div>
        <div className="image-studio-image-stage">{props.selectedWork ? <img src={props.selectedWork.assetUrl} alt="当前生成作品" /> : <div className="image-studio-empty"><Lightbulb size={30} /><span>作品将在这里显示</span></div>}</div>
        {props.newResult && <button type="button" className="image-studio-new-result" onClick={props.showLatest}>新结果已就绪，点击查看</button>}
        {latestTask && ['unknown', 'paused', 'failed', 'partial'].includes(latestTask.status) && <p className="image-studio-task-warning">{latestTask.status === 'unknown' ? '结果待确认，不会自动重新计费。' : latestTask.error || '任务未完整完成。'}</p>}
        <div className="image-studio-filmstrip">{props.state.works.slice(0, 12).map((work) => <button type="button" key={work.workId} className={work.workId === props.selectedWork?.workId ? 'active' : ''} onClick={() => props.selectWork(work.workId)} title={`查看作品 ${work.createdAt}`}><img src={work.assetUrl} alt="" loading="lazy" /></button>)}</div>
        <div className="image-studio-result-bar">
          <span>{props.selectedWork ? `${props.selectedWork.width} × ${props.selectedWork.height}` : ''}</span>
          <select aria-label="下载格式" value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="png">PNG</option><option value="jpg">JPG</option><option value="webp">WEBP</option></select>
          <button type="button" disabled={!props.selectedWork} onClick={() => void exportWork()} title="下载图片"><Download size={16} /> 下载</button>
          <button type="button" disabled title="分层 PSD 仍需真实像素分割验证"><Layers3 size={16} /> 分层 PSD</button>
        </div>
      </section>
      <aside className="image-studio-inspector">
        <div className="image-studio-panel-head"><h2>当前图片信息</h2><Heart size={16} /></div>
        {props.selectedWork ? <><strong>本次生成提示词</strong><p className="image-studio-inspector-prompt">{props.selectedWork.prompt}</p><dl><dt>图片模型</dt><dd>{props.selectedWork.modelName}</dd><dt>输出尺寸</dt><dd>{props.selectedWork.width} × {props.selectedWork.height}</dd><dt>生成方式</dt><dd>{props.selectedWork.kind === 'generate' ? '文生图' : props.selectedWork.kind}</dd></dl><strong>版本记录</strong><p>{props.selectedWork.parentWorkId ? '由上一版本创作' : '初始作品'}</p></> : <p className="image-studio-muted">选择图片后显示详情。</p>}
      </aside>
    </div>
    {candidate && <div className="image-studio-overlay" role="presentation"><section role="dialog" aria-modal="true" aria-label={candidate.kind === 'optimize' ? '提示词优化' : '图片反推提示词'} className="image-studio-dialog">
      <div className="image-studio-panel-head"><h2>{candidate.kind === 'optimize' ? '提示词优化与对比' : '图片反推提示词'}</h2><button type="button" aria-label="关闭" onClick={() => setCandidate(null)}>×</button></div>
      {candidate.kind === 'optimize' ? <><label>方向<select value={mode} onChange={(event) => setMode(event.target.value)}><option>优化</option><option>扩写</option><option>简化</option><option>英文</option><option>双语</option><option>商业海报</option><option>产品摄影</option><option>写实</option><option>插画</option></select></label><div className="image-studio-compare"><div><strong>原文</strong><p>{candidate.original}</p></div><div><strong>优化稿</strong><textarea value={candidateText} onChange={(event) => setCandidateText(event.target.value)} /></div></div></> : <><p className="image-studio-muted">根据图片生成参考描述，不代表原始提示词。</p><textarea value={candidateText} onChange={(event) => setCandidateText(event.target.value)} /></>}
      {!applyAllowed && <p className="image-studio-warning">输入或图片已变化；请重新发起操作。</p>}
      <footer><button type="button" onClick={() => setCandidate(null)}>取消</button><button type="button" disabled={!candidateText.trim()} onClick={() => void props.savePrompt(candidateText, candidate.kind)}>保存到我的提示词</button><button type="button" className="image-studio-primary" disabled={!applyAllowed || !candidateText.trim()} onClick={() => { props.applyPrompt(candidateText); setCandidate(null); }}>应用到输入框</button></footer>
    </section></div>}
  </div>;
}
