import { useCallback, useEffect, useState } from 'react';
import type { AnalyticsDashboard, AnalyticsRange, NamedMetric } from '../../shared/ipc';

type AnalyticsTab = 'overview' | 'clients' | 'usage' | 'models' | 'agents' | 'events';

const rangeLabels: Record<AnalyticsRange, string> = {
  today: '今天',
  '7d': '近 7 天',
  '30d': '近 30 天',
  all: '全部历史',
};

const eventLabels: Record<string, string> = {
  app_open: '客户端启动',
  page_view: '页面访问',
  config_usage: '配置使用',
  resource_click: '资源点击',
  ai_request: 'AI 请求',
  agent_runtime: 'Agent 运行',
};

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value || 0);
}

function formatTime(value: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function MetricList({ title, items, empty = '暂无统计数据' }: { title: string; items: NamedMetric[]; empty?: string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <section className="analytics-panel">
      <h3>{title}</h3>
      {items.length === 0 ? <p className="analytics-empty">{empty}</p> : (
        <div className="metric-list">
          {items.slice(0, 12).map((item) => (
            <div className="metric-row" key={item.name}>
              <div><span>{item.name}</span><strong>{formatNumber(item.value)}</strong></div>
              <i><span style={{ width: `${Math.max(4, (item.value / max) * 100)}%` }} /></i>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const [tab, setTab] = useState<AnalyticsTab>('overview');
  const [dashboard, setDashboard] = useState<AnalyticsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [showCleanup, setShowCleanup] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await window.jatoManagement!.analytics.getDashboard(range);
    if (result.success && result.dashboard) {
      setDashboard(result.dashboard);
      setMessage('');
    } else {
      setMessage(result.message || '统计数据加载失败');
    }
    setLoading(false);
  }, [range]);

  useEffect(() => { void load(); }, [load]);

  const cleanup = async () => {
    const result = await window.jatoManagement!.analytics.cleanup(24);
    setShowCleanup(false);
    setMessage(result.success ? `已清理 ${result.deleted || 0} 条超过 24 个月的统计记录` : (result.message || '清理失败'));
    if (result.success) await load();
  };

  if (loading && !dashboard) return <div className="empty-dashboard" aria-busy="true">正在加载局域网统计…</div>;
  if (!dashboard) return <div className="empty-dashboard"><h2>统计数据不可用</h2><p>{message}</p></div>;

  const summaryCards = [
    ['客户端总量', dashboard.summary.totalClients],
    ['新增客户端', dashboard.summary.newClients],
    ['活跃客户端', dashboard.summary.activeClients],
    ['当前在线', dashboard.summary.onlineClients],
    ['AI 请求', dashboard.summary.aiRequests],
    ['Token 总量', dashboard.summary.totalTokens],
    ['Agent 成功', dashboard.summary.agentSuccess],
    ['Agent 失败', dashboard.summary.agentFailed],
  ] as const;

  return (
    <div className="analytics-page">
      <div className="analytics-toolbar">
        <div className="segmented-control" aria-label="统计时间范围">
          {(Object.keys(rangeLabels) as AnalyticsRange[]).map((item) => (
            <button key={item} type="button" className={range === item ? 'is-active' : ''} onClick={() => setRange(item)}>{rangeLabels[item]}</button>
          ))}
        </div>
        <button type="button" className="secondary-button" onClick={() => void load()}>刷新</button>
        <button type="button" className="secondary-button" onClick={() => setShowCleanup(true)}>清理 24 个月前数据</button>
      </div>
      {message && <p className="analytics-message" role="status">{message}</p>}

      <section className="summary-grid">
        {summaryCards.map(([label, value]) => <article key={label}><span>{label}</span><strong>{formatNumber(value)}</strong></article>)}
      </section>

      <div className="analytics-tabs" role="tablist">
        {([
          ['overview', '总览'], ['clients', '客户端'], ['usage', '功能与配置'],
          ['models', '模型与 Token'], ['agents', 'Agent'], ['events', '最近事件'],
        ] as Array<[AnalyticsTab, string]>).map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? 'is-active' : ''} onClick={() => setTab(value)}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="analytics-grid">
          <section className="analytics-panel is-wide">
            <h3>活跃趋势（北京时间）</h3>
            <div className="table-scroll"><table><thead><tr><th>日期</th><th>活跃客户端</th><th>事件数</th></tr></thead><tbody>
              {dashboard.dailyActive.map((day) => <tr key={day.date}><td>{day.date}</td><td>{formatNumber(day.clients)}</td><td>{formatNumber(day.events)}</td></tr>)}
            </tbody></table></div>
          </section>
          <section className="analytics-panel">
            <h3>授权概况</h3>
            <dl className="analytics-description">
              <div><dt>员工</dt><dd>{formatNumber(dashboard.authorization.employees)}</dd></div>
              <div><dt>有效设备</dt><dd>{formatNumber(dashboard.authorization.activeDevices)}</dd></div>
              <div><dt>有效授权</dt><dd>{formatNumber(dashboard.authorization.activeLicenses)}</dd></div>
              <div><dt>已撤销授权</dt><dd>{formatNumber(dashboard.authorization.revokedLicenses)}</dd></div>
            </dl>
          </section>
          <MetricList title="授权状态事件" items={dashboard.licenseStatuses} />
        </div>
      )}

      {tab === 'clients' && <div className="analytics-grid">
        <MetricList title="客户端版本" items={dashboard.versions} />
        <MetricList title="操作系统" items={dashboard.platforms} />
        <MetricList title="系统架构" items={dashboard.architectures} />
        <MetricList title="局域网来源 IP" items={dashboard.sourceIps} />
      </div>}

      {tab === 'usage' && <div className="analytics-grid">
        <MetricList title="页面 / 功能使用" items={dashboard.pages} />
        <MetricList title="资源入口点击" items={dashboard.resources} />
        <section className="analytics-panel is-wide"><h3>配置分布</h3><div className="table-scroll"><table><thead><tr><th>配置项</th><th>配置值</th><th>次数</th></tr></thead><tbody>
          {dashboard.configs.map((item) => <tr key={`${item.key}:${item.value}`}><td>{item.key || '—'}</td><td>{item.value || '—'}</td><td>{formatNumber(item.count)}</td></tr>)}
        </tbody></table></div></section>
      </div>}

      {tab === 'models' && <section className="analytics-panel"><div className="model-summary">
        <span>输入 Token <strong>{formatNumber(dashboard.summary.promptTokens)}</strong></span>
        <span>输出 Token <strong>{formatNumber(dashboard.summary.completionTokens)}</strong></span>
        <span>总 Token <strong>{formatNumber(dashboard.summary.totalTokens)}</strong></span>
      </div><div className="table-scroll"><table><thead><tr><th>服务商</th><th>接口域名</th><th>模型</th><th>请求数</th><th>Token</th></tr></thead><tbody>
        {dashboard.models.map((model) => <tr key={`${model.provider}:${model.endpoint}:${model.model}`}><td>{model.provider || '—'}</td><td>{model.endpoint || '—'}</td><td>{model.model || '—'}</td><td>{formatNumber(model.requests)}</td><td>{formatNumber(model.totalTokens)}</td></tr>)}
      </tbody></table></div></section>}

      {tab === 'agents' && <div className="agent-summary">
        <article><span>成功</span><strong>{formatNumber(dashboard.summary.agentSuccess)}</strong></article>
        <article><span>失败</span><strong>{formatNumber(dashboard.summary.agentFailed)}</strong></article>
        <article><span>重试次数</span><strong>{formatNumber(dashboard.summary.agentRetries)}</strong></article>
      </div>}

      {tab === 'events' && <section className="analytics-panel"><div className="table-scroll"><table><thead><tr><th>时间</th><th>事件</th><th>客户端</th><th>局域网来源 IP</th><th>版本 / 页面 / 模型</th></tr></thead><tbody>
        {dashboard.recentEvents.map((event) => <tr key={event.eventId}><td>{formatTime(event.occurredAt)}</td><td>{eventLabels[event.eventType] || event.eventType}</td><td>{event.clientId ? event.clientId.slice(0, 12) : '—'}</td><td>{event.sourceIp || '—'}</td><td>{String(event.payload.version || event.payload.page || event.payload.ai_model_name || '—')}</td></tr>)}
      </tbody></table></div></section>}

      {showCleanup && <div className="confirm-overlay" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cleanup-title">
        <h2 id="cleanup-title">清理历史统计</h2><p>将永久删除超过 24 个月的运维统计记录，不影响员工、设备和授权数据。</p>
        <div><button type="button" className="secondary-button" onClick={() => setShowCleanup(false)}>取消</button><button type="button" className="danger-button" onClick={() => void cleanup()}>确认清理</button></div>
      </section></div>}
    </div>
  );
}

export default AnalyticsPage;
