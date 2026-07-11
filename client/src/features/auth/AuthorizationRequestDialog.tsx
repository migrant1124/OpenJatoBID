import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import type { AuthorizationApplicationResult } from '../../shared/types/ipc';

interface AuthorizationRequestDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

function maskPhone(phone: string) {
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : phone;
}

function AuthorizationRequestDialog({ open, onOpenChange }: AuthorizationRequestDialogProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [application, setApplication] = useState<AuthorizationApplicationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refreshStatus = async () => {
    try {
      const result = await window.yibiao!.license.getApplicationStatus();
      setApplication(result);
      if (result.status === 'APPROVED' && result.runtimeStatus?.status !== 'active') {
        setError('授权已批准，但本地授权校验失败，请联系管理员。');
      }
    } catch (refreshError) {
      const code = refreshError instanceof Error ? refreshError.message : '';
      setError(code.includes('LAN_SERVER_UNREACHABLE') ? '暂时无法连接局域网管理端，请检查服务器 IP。' : '授权状态刷新失败，请稍后重试。');
    }
  };

  useEffect(() => {
    if (!open || application?.status !== 'PENDING') return undefined;
    const timer = window.setInterval(() => { void refreshStatus(); }, 5000);
    return () => window.clearInterval(timer);
  }, [open, application?.status]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const normalizedName = name.trim();
    const normalizedPhone = phone.replace(/\D/g, '');
    if (!normalizedName) return setError('请输入员工姓名');
    if (!/^1[3-9]\d{9}$/.test(normalizedPhone)) return setError('请输入有效的 11 位手机号码');
    if (!serverAddress.trim()) return setError('请输入管理端服务器 IP');
    setBusy(true);
    try {
      const result = await window.yibiao!.license.submitApplication({
        name: normalizedName,
        phone: normalizedPhone,
        serverAddress: serverAddress.trim(),
      });
      setName(normalizedName);
      setPhone(normalizedPhone);
      setApplication(result);
    } catch (submitError) {
      const code = submitError instanceof Error ? submitError.message : '';
      if (code.includes('APPLICATION_CONFLICT')) setError('当前设备已有待审批申请，请刷新申请状态。');
      else if (code.includes('LAN_SERVER_UNREACHABLE')) setError('无法连接局域网管理端，请检查服务器 IP 和端口。');
      else if (code.includes('INVALID_LAN_SERVER_ADDRESS')) setError('服务器 IP 格式无效，可填写 IP 或 IP:端口。');
      else setError('授权申请提交失败，请稍后重试。');
    } finally {
      setBusy(false);
    }
  };

  const resetApplication = () => {
    setApplication(null);
    setError('');
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="startup-dialog-overlay" />
        <Dialog.Content className="startup-dialog-card">
          <div className="startup-dialog-heading">
            <div><span>DEVICE AUTHORIZATION</span><Dialog.Title>授权申请</Dialog.Title></div>
            <Dialog.Close aria-label="关闭授权申请">×</Dialog.Close>
          </div>
          <Dialog.Description>新用户或新设备需要提交姓名、手机号和局域网管理端地址，等待管理员审批。</Dialog.Description>

          {!application && (
            <form onSubmit={submit}>
              <label>姓名<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入员工真实姓名" /></label>
              <label>手机号<input inputMode="numeric" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="请输入 11 位手机号码" /></label>
              <label>服务器 IP<input value={serverAddress} onChange={(event) => setServerAddress(event.target.value)} placeholder="例如 192.168.1.10 或 192.168.1.10:47821" /></label>
              <p className="startup-field-help">服务器地址由公司管理员提供，首次成功连接后将保存在当前电脑。</p>
              {error && <p className="startup-form-message is-error" role="alert">{error}</p>}
              <div className="startup-dialog-actions"><Dialog.Close className="startup-secondary-button">取消</Dialog.Close><button type="submit" className="startup-primary-button" disabled={busy}>{busy ? '正在提交…' : '提交授权申请'}</button></div>
            </form>
          )}

          {application && (
            <div className="application-status-view">
              <span className={`application-status-icon is-${application.status.toLowerCase()}`} aria-hidden="true" />
              <h3>{application.status === 'PENDING' ? '等待管理员审批' : application.status === 'APPROVED' ? '授权申请已批准' : application.status === 'DEVICE_LIMIT' ? '有效设备已达上限' : application.status === 'REVOKED' ? '设备授权已被撤销' : application.status === 'EXPIRED' ? '设备授权已过期' : '授权申请已被拒绝'}</h3>
              <p>{application.status === 'PENDING' ? '管理端批准后，本页面会自动刷新状态。' : application.status === 'APPROVED' ? '请关闭弹窗，在启动页输入姓名和手机号后登录。' : application.status === 'DEVICE_LIMIT' ? '该员工已有 3 台有效设备，请管理员先撤销旧设备。' : application.status === 'REVOKED' ? '如需继续使用，请为当前设备重新提交授权申请。' : application.status === 'EXPIRED' ? '请联系管理员续期，或重新提交当前设备授权申请。' : '如需继续使用，请联系管理员或重新提交申请。'}</p>
              <dl><div><dt>姓名</dt><dd>{application.name || name}</dd></div><div><dt>手机号</dt><dd>{maskPhone(application.phone || phone)}</dd></div><div><dt>当前设备</dt><dd>{application.clientId || '已识别'}</dd></div></dl>
              {error && <p className="startup-form-message is-error" role="alert">{error}</p>}
              <div className="startup-dialog-actions">
                {application.status === 'PENDING' && <button type="button" className="startup-secondary-button" onClick={() => { void refreshStatus(); }}>刷新状态</button>}
                {(['REJECTED', 'DEVICE_LIMIT', 'REVOKED', 'EXPIRED'] as AuthorizationApplicationResult['status'][]).includes(application.status) && <button type="button" className="startup-secondary-button" onClick={resetApplication}>重新申请</button>}
                <Dialog.Close className="startup-primary-button">{application.status === 'APPROVED' ? '返回登录' : '关闭'}</Dialog.Close>
              </div>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default AuthorizationRequestDialog;
