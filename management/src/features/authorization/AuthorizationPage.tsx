import { useEffect, useMemo, useState } from 'react';
import type { AuthorizationApplication, AuthorizedDevice, AuthorizedEmployee } from '../../shared/ipc';

type ConfirmAction =
  | { type: 'reject'; id: string; title: string }
  | { type: 'revoke'; id: string; title: string }
  | { type: 'renew'; id: string; title: string };

const statusLabels = {
  PENDING: '待审批',
  APPROVED: '已批准',
  REJECTED: '已拒绝',
  DEVICE_LIMIT: '设备已满',
  REVOKED: '已撤销',
  EXPIRED: '已过期',
};

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function AuthorizationPage() {
  const [applications, setApplications] = useState<AuthorizationApplication[]>([]);
  const [employees, setEmployees] = useState<AuthorizedEmployee[]>([]);
  const [activeView, setActiveView] = useState<'applications' | 'employees'>('applications');
  const [filter, setFilter] = useState('');
  const [busyId, setBusyId] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setError('');
    const result = await window.jatoManagement!.authorization.list();
    if (!result.success) {
      setError(result.message ?? '授权数据读取失败');
      return;
    }
    setApplications(result.applications ?? []);
    setEmployees(result.employees ?? []);
  };

  useEffect(() => { void load(); }, []);

  const visibleApplications = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    if (!keyword) return applications;
    return applications.filter((item) => [item.name, item.phone, item.clientId, item.deviceFingerprint]
      .some((value) => value.toLowerCase().includes(keyword)));
  }, [applications, filter]);

  const visibleEmployees = useMemo(() => {
    const keyword = filter.trim().toLowerCase();
    if (!keyword) return employees;
    return employees.filter((item) => [item.name, item.phone, ...item.devices.map((device) => device.clientId)]
      .some((value) => value.toLowerCase().includes(keyword)));
  }, [employees, filter]);

  const approve = async (applicationId: string) => {
    setBusyId(applicationId);
    const result = await window.jatoManagement!.authorization.approve(applicationId);
    setBusyId('');
    if (!result.success) setError(result.message ?? '批准授权失败');
    await load();
  };

  const runConfirmedAction = async () => {
    if (!confirmAction) return;
    setBusyId(confirmAction.id);
    const api = window.jatoManagement!.authorization;
    const result = confirmAction.type === 'reject'
      ? await api.reject(confirmAction.id)
      : confirmAction.type === 'revoke'
        ? await api.revoke(confirmAction.id)
        : await api.renew(confirmAction.id);
    setBusyId('');
    setConfirmAction(null);
    if (!result.success) setError(result.message ?? '授权操作失败');
    await load();
  };

  return (
    <>
      <section className="authorization-toolbar">
        <div className="segmented-control" aria-label="授权数据视图">
          <button type="button" className={activeView === 'applications' ? 'is-active' : ''} onClick={() => setActiveView('applications')}>申请记录 <span>{applications.filter((item) => item.status === 'PENDING').length}</span></button>
          <button type="button" className={activeView === 'employees' ? 'is-active' : ''} onClick={() => setActiveView('employees')}>员工与设备 <span>{employees.length}</span></button>
        </div>
        <input aria-label="搜索授权记录" type="search" placeholder="搜索姓名、手机号或客户端 ID" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <button type="button" className="secondary-button" onClick={() => { void load(); }}>刷新</button>
      </section>

      {error && <p className="form-message is-error" role="alert">{error}</p>}

      {activeView === 'applications' ? (
        <section className="data-panel">
          <div className="data-panel-heading"><div><h2>设备授权申请</h2><p>每台新设备需要单独审批，同一员工最多 3 台有效设备。</p></div></div>
          {visibleApplications.length === 0 ? <div className="table-empty">暂无授权申请</div> : (
            <div className="table-scroll"><table>
              <thead><tr><th>员工</th><th>设备</th><th>提交时间</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>{visibleApplications.map((application) => (
                <tr key={application.id}>
                  <td><strong>{application.name}</strong><span>{application.phone}</span></td>
                  <td><strong>{application.platform} / {application.arch}</strong><span title={application.deviceFingerprint}>{application.clientId}</span></td>
                  <td>{formatDate(application.submittedAt)}</td>
                  <td><span className={`status-tag is-${application.status.toLowerCase()}`}>{statusLabels[application.status]}</span></td>
                  <td><div className="table-actions">
                    {(application.status === 'PENDING' || application.status === 'DEVICE_LIMIT') && <button type="button" className="link-button" disabled={busyId === application.id} onClick={() => { void approve(application.id); }}>批准</button>}
                    {(application.status === 'PENDING' || application.status === 'DEVICE_LIMIT') && <button type="button" className="link-button is-danger" disabled={busyId === application.id} onClick={() => setConfirmAction({ type: 'reject', id: application.id, title: `拒绝 ${application.name} 的设备申请` })}>拒绝</button>}
                    {!['PENDING', 'DEVICE_LIMIT'].includes(application.status) && <span>已处理</span>}
                  </div></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      ) : (
        <section className="employee-list">
          {visibleEmployees.length === 0 ? <div className="data-panel table-empty">暂无员工授权记录</div> : visibleEmployees.map((employee) => (
            <article className="employee-card" key={employee.id}>
              <header><div><h2>{employee.name}</h2><p>{employee.phone}</p></div><span className="device-count">{employee.activeDeviceCount} / 3 台有效设备</span></header>
              <div className="device-list">{employee.devices.map((device: AuthorizedDevice) => (
                <div className="device-row" key={device.id}>
                  <div><strong>{device.platform} / {device.arch}</strong><span>{device.clientId}</span></div>
                  <div><span>到期时间</span><strong>{formatDate(device.expiresAt)}</strong></div>
                  <div><span>最近校验</span><strong>{formatDate(device.lastVerifiedAt)}</strong></div>
                  <span className={`status-tag is-${(device.licenseStatus ?? 'expired').toLowerCase()}`}>{device.licenseStatus === 'ACTIVE' ? '有效' : device.licenseStatus === 'REVOKED' ? '已撤销' : '已过期'}</span>
                  <div className="table-actions">
                    {device.licenseId && device.licenseStatus === 'ACTIVE' && <button type="button" className="link-button is-danger" onClick={() => setConfirmAction({ type: 'revoke', id: device.licenseId!, title: `撤销 ${employee.name} 的当前设备授权` })}>撤销</button>}
                    {device.licenseId && device.licenseStatus !== 'ACTIVE' && <button type="button" className="link-button" onClick={() => setConfirmAction({ type: 'renew', id: device.licenseId!, title: `为 ${employee.name} 的当前设备续期一年` })}>续期</button>}
                  </div>
                </div>
              ))}</div>
            </article>
          ))}
        </section>
      )}

      {confirmAction && (
        <div className="confirm-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmAction(null); }}>
          <section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
            <h2 id="confirm-title">确认授权操作</h2>
            <p>{confirmAction.title}？操作后客户端将在下一次联网校验时更新状态。</p>
            <div><button type="button" className="secondary-button" onClick={() => setConfirmAction(null)}>取消</button><button autoFocus type="button" className={confirmAction.type === 'renew' ? 'primary-button' : 'danger-button'} onClick={() => { void runConfirmedAction(); }}>确认</button></div>
          </section>
        </div>
      )}
    </>
  );
}

export default AuthorizationPage;
