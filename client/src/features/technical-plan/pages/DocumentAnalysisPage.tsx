import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { isLibreOfficeRequiredMessage, useDocumentParseNotice, useToast } from '../../../shared/ui';
import type { FileParserProvider } from '../../../shared/types';
import type { TechnicalPlanOriginalPlanFile, TechnicalPlanState, TechnicalPlanTenderFile, TechnicalPlanTenderSourceFile, TechnicalPlanWorkflowKind } from '../types';

interface Props {
  workflowKind: TechnicalPlanWorkflowKind;
  tenderFile: TechnicalPlanTenderFile | null;
  tenderFiles: TechnicalPlanTenderSourceFile[];
  tenderMarkdown: string;
  originalPlanFile: TechnicalPlanOriginalPlanFile | null;
  originalPlanMarkdown: string;
  analysisStale?: boolean;
  onFileImported: (state: TechnicalPlanState, markdown: string) => void;
  onOriginalPlanImported: (state: TechnicalPlanState, markdown: string) => void;
  onStartAnalysis: () => Promise<void>;
}

const parserLabels: Record<FileParserProvider, string> = {
  local: '本地解析',
  'mineru-accurate-api': 'MinerU 精准解析 API',
  'mineru-agent-api': 'MinerU-Agent 轻量解析 API',
};

function DocumentAnalysisPage({ workflowKind, tenderFile, tenderFiles, originalPlanFile, analysisStale, onFileImported, onOriginalPlanImported, onStartAnalysis }: Props) {
  const [parserLabel, setParserLabel] = useState('本地解析');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ token: string; names: string[] } | null>(null);
  const { showToast } = useToast();
  const { showDocumentParseNotice } = useDocumentParseNotice();
  const expansion = workflowKind === 'existing-plan-expansion';

  useEffect(() => {
    let mounted = true;
    window.yibiao?.config.load().then((config) => {
      if (mounted) setParserLabel(parserLabels[config.file_parser.provider] || parserLabels.local);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const finishTenderImport = (result: { success: boolean; message?: string; errors?: string[]; skipped?: string[]; state?: TechnicalPlanState; markdown?: string }) => {
    if (!result.success) {
      const message = result.message || '未导入文件';
      if (isLibreOfficeRequiredMessage(message)) showDocumentParseNotice(message);
      else showToast(message, message === '已取消选择' ? 'info' : 'error');
      return;
    }
    if (result.state) onFileImported(result.state, result.markdown || '');
    showToast([result.message || '招标资料已保存', result.errors?.length ? `失败：${result.errors.slice(0, 3).join('；')}` : '', result.skipped?.length ? `跳过重复文件 ${result.skipped.length} 份` : ''].filter(Boolean).join('。'), result.errors?.length ? 'info' : 'success');
  };

  const addFiles = async () => {
    setBusy(true);
    try {
      const result = await window.yibiao?.technicalPlan.importTenderDocument();
      if (result?.requiresChoice && result.token) {
        setConflict({ token: result.token, names: result.conflicts || [] });
      } else if (result) finishTenderImport(result);
    } catch (error) { showToast(error instanceof Error ? error.message : '添加文件失败', 'error'); }
    finally { setBusy(false); }
  };

  const chooseConflict = async (action: 'keep' | 'replace' | 'cancel') => {
    if (!conflict) return;
    setBusy(true);
    try {
      const result = await window.yibiao!.technicalPlan.resolveTenderImport(conflict.token, action);
      setConflict(null);
      if (!result.canceled) finishTenderImport(result);
    } catch (error) { showToast(error instanceof Error ? error.message : '处理同名文件失败', 'error'); }
    finally { setBusy(false); }
  };

  const replaceFile = async (id: string) => {
    setBusy(true);
    try {
      const result = await window.yibiao!.technicalPlan.replaceTenderSource(id);
      finishTenderImport(result);
    } catch (error) { showToast(error instanceof Error ? error.message : '替换文件失败，原资料已保留', 'error'); }
    finally { setBusy(false); }
  };

  const removeFile = async (id: string) => {
    setBusy(true);
    try {
      const result = await window.yibiao!.technicalPlan.removeTenderSource(id);
      onFileImported(result.state, result.markdown);
      showToast(result.message || '已移除文件', 'success');
    } catch (error) { showToast(error instanceof Error ? error.message : '移除文件失败', 'error'); }
    finally { setBusy(false); }
  };

  const addOriginalPlan = async () => {
    setBusy(true);
    try {
      const result = await window.yibiao?.technicalPlan.importOriginalPlanDocument();
      if (!result?.success) {
        const message = result?.message || '未导入原方案';
        if (isLibreOfficeRequiredMessage(message)) showDocumentParseNotice(message);
        else showToast(message, message === '已取消选择' ? 'info' : 'error');
      } else if (result.state) {
        onOriginalPlanImported(result.state, result.markdown || '');
        showToast(result.message || '原方案已导入', 'success');
      }
    } catch (error) { showToast(error instanceof Error ? error.message : '原方案导入失败', 'error'); }
    finally { setBusy(false); }
  };

  return <div className="plan-step-body document-analysis-page technical-tender-page">
    <section className="technical-tender-card">
      <div className="technical-tender-head"><div><span className="section-kicker">STEP 01</span><h2>招标资料</h2><p>添加本项目招标文件，解析结果将在下一页单独查看。</p></div>
        <button type="button" className="primary-action" onClick={() => void onStartAnalysis()} disabled={busy || !tenderFile || Boolean(expansion && !originalPlanFile)}>开始招标文档解析</button>
      </div>
      <div className="technical-tender-actions"><button type="button" className="secondary-action" onClick={() => void addFiles()} disabled={busy}>{busy ? '正在处理…' : '添加文件'}</button><span>当前解析方式：{parserLabel}；支持格式以文件选择窗口为准。</span></div>
      {analysisStale ? <p className="analysis-section-hint">招标资料已变化，已有解析结果需重新核对；目录、正文和图片未自动清空。</p> : null}
      {tenderFile?.selectedSectionTitle ? <p className="analysis-section-hint">投标范围：{tenderFile.selectedSectionTitle}</p> : null}
      <div className="technical-tender-table-scroll"><table><thead><tr><th>文件名称</th><th>文件类型</th><th>上传时间</th><th>操作</th></tr></thead><tbody>
        {tenderFiles.map((file) => <tr key={file.id}><td title={file.fileName}>{file.fileName}</td><td>{file.fileName.split('.').pop()?.toUpperCase() || '文件'}</td><td>{file.importedAt ? new Date(file.importedAt).toLocaleString('zh-CN') : '—'}</td><td><button type="button" onClick={() => void removeFile(file.id)} disabled={busy}>移除</button><details><summary>更多</summary><button type="button" onClick={() => void replaceFile(file.id)} disabled={busy}>替换</button></details></td></tr>)}
      </tbody></table>{tenderFiles.length === 0 ? <div className="technical-project-empty">暂无招标资料，请先添加文件</div> : null}</div>
    </section>
    {expansion ? <section className="technical-tender-original"><div><strong>原方案</strong><p>{originalPlanFile ? originalPlanFile.fileName : '尚未导入原方案'}</p></div><button type="button" className="secondary-action" onClick={() => void addOriginalPlan()} disabled={busy}>{originalPlanFile ? '替换原方案' : '上传原方案'}</button></section> : null}
    <Dialog.Root open={Boolean(conflict)} onOpenChange={(open) => { if (!open && !busy) void chooseConflict('cancel'); }}><Dialog.Portal><Dialog.Overlay className="content-regenerate-modal" /><Dialog.Content className="content-regenerate-card technical-project-dialog">
      <Dialog.Title>同名文件内容不同</Dialog.Title><Dialog.Description>{conflict?.names.join('、')} 与已有文件同名。可保留两份；若要替换，请明确选择目标旧文件，同名旧文件多份时使用目标行的“更多→替换”。</Dialog.Description>
      <div className="content-regenerate-actions"><button type="button" className="secondary-action" autoFocus onClick={() => void chooseConflict('cancel')} disabled={busy}>取消</button><button type="button" className="secondary-action" onClick={() => void chooseConflict('keep')} disabled={busy}>保留两份</button><button type="button" className="primary-action" onClick={() => void chooseConflict('replace')} disabled={busy}>替换旧文件</button></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}

export default DocumentAnalysisPage;
