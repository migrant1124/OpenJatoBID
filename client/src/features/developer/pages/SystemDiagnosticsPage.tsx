import { useEffect, useState } from 'react';
import type { DiagnosticsSnapshot } from '../../../shared/types';
import { useToast } from '../../../shared/ui';

const emptySnapshot: DiagnosticsSnapshot = {
  status: 'idle',
  checked_at: '',
  results: [],
};

function SystemDiagnosticsPage() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot>(emptySnapshot);
  const [running, setRunning] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    let disposed = false;
    void window.yibiao?.diagnostics?.getLast()
      .then((snapshot) => {
        if (!disposed && snapshot) setDiagnostics(snapshot);
      })
      .catch(() => undefined);
    window.yibiao?.diagnostics?.subscribe();
    const unsubscribe = window.yibiao?.diagnostics?.onUpdate((snapshot) => {
      if (!disposed) setDiagnostics(snapshot);
    }) ?? (() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const runDiagnostics = async (full: boolean) => {
    try {
      setRunning(true);
      const snapshot = await window.yibiao?.diagnostics?.runAll({ full });
      if (snapshot) setDiagnostics(snapshot);
      showToast(full ? '完整诊断已完成' : '快速诊断已完成', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '系统诊断失败', 'error');
    } finally {
      setRunning(false);
    }
  };

  const exportReport = async (format: 'json' | 'markdown') => {
    try {
      const result = await window.yibiao?.diagnostics?.exportReport(format);
      showToast(result?.success ? `诊断报告已导出：${result.path}` : '诊断报告导出失败', result?.success ? 'success' : 'error');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '诊断报告导出失败', 'error');
    }
  };

  return (
    <div className="page-stack developer-test-page">
      <section className="panel developer-test-hero">
        <div className="hero-copy">
          <span className="eyebrow">SYSTEM DIAGNOSTICS</span>
          <h2>系统诊断</h2>
          <p>仅用于开发者排查运行时、本地转图、DSL、存储和外部能力状态；不会展示 API Key、许可证正文或业务正文。</p>
        </div>
      </section>

      <section className="panel developer-test-panel is-wide">
        <div className="agent-self-check-status">
          <div>
            <strong>总体状态：{diagnostics.status === 'idle' ? '未执行' : diagnostics.status}</strong>
            <span>{diagnostics.checked_at ? `最近检查：${new Date(diagnostics.checked_at).toLocaleString('zh-CN')}` : '快速诊断不会调用收费模型；完整诊断会标注需要配置或人工确认的能力。'}</span>
          </div>
          <em>{diagnostics.results.length} 项</em>
        </div>
        <div className="settings-list">
          <div className="settings-row">
            <div className="settings-row-copy"><strong>快速诊断</strong><span>检查运行时版本、本地转图、DSL、存储和已配置的本地能力。</span></div>
            <button className="secondary-action" type="button" disabled={running} onClick={() => void runDiagnostics(false)}>{running ? '检查中…' : '开始'}</button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy"><strong>完整诊断</strong><span>额外列出需要配置、授权或人工确认的外部能力，不自动消耗模型额度。</span></div>
            <button className="secondary-action" type="button" disabled={running} onClick={() => void runDiagnostics(true)}>执行</button>
          </div>
          <div className="settings-row">
            <div className="settings-row-copy"><strong>导出报告</strong><span>报告只包含安全状态、耗时和建议动作，不包含 API Key、许可证正文或业务正文。</span></div>
            <div className="settings-inline-actions"><button className="secondary-action" type="button" onClick={() => void exportReport('json')}>JSON</button><button className="secondary-action" type="button" onClick={() => void exportReport('markdown')}>Markdown</button></div>
          </div>
        </div>
        {diagnostics.results.length > 0 && (
          <div className="settings-list">
            {diagnostics.results.map((item) => (
              <div className="settings-row" key={item.id}>
                <div className="settings-row-copy"><strong>{item.id}</strong><span>{item.message}{item.impact ? `；影响：${item.impact}` : ''}</span></div>
                <em>{item.status}</em>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default SystemDiagnosticsPage;
