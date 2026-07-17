import { useEffect, useState } from 'react';
import logoUrl from '../../../assets/logo.png';
import type { LicenseRuntimeStatus } from '../../shared/types';
import { getAppVersion } from '../../shared/runtime/appVersion';
import AuthorizationRequestDialog from './AuthorizationRequestDialog';

interface StartupAuthPageProps {
  initialStatus: LicenseRuntimeStatus | null;
  onAuthorized(status: LicenseRuntimeStatus): void;
}

function statusMessage(status: LicenseRuntimeStatus | null) {
  if (!status || status.status === 'missing') return '';
  if (status.status === 'revoked') return '当前设备授权已被管理员撤销，请重新申请。';
  if (status.status === 'not_authorized') return '当前设备已不在有效授权列表中，请重新申请授权。';
  if (status.status === 'expired') return '当前设备授权已到期，请联系管理员续期。';
  if (status.status === 'offline_expired') return '已超过 30 天未连接管理端，请接入公司局域网后重试。';
  if (status.status === 'machine_mismatch') return '本地授权与当前设备不匹配，请为当前设备重新申请。';
  if (status.status === 'invalid') return '本地授权签名无效或管理端身份已变化，请联系管理员。';
  return '';
}

function StartupAuthPage({ initialStatus, onAuthorized }: StartupAuthPageProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [serverAddress, setServerAddress] = useState('');
  const [requestOpen, setRequestOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(statusMessage(initialStatus));
  const [appVersion, setAppVersion] = useState('');
  const [versionLoaded, setVersionLoaded] = useState(false);
  const needsServerRestore = !initialStatus?.serverAddress;

  useEffect(() => {
    void getAppVersion().then((version) => {
      setAppVersion(version);
      setVersionLoaded(true);
    });
  }, []);

  useEffect(() => {
    const message = statusMessage(initialStatus);
    if (message) setError(message);
  }, [initialStatus]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const normalizedName = name.trim();
    const normalizedPhone = phone.replace(/\D/g, '');
    if (!normalizedName) return setError('请输入员工姓名');
    if (!/^1[3-9]\d{9}$/.test(normalizedPhone)) return setError('请输入有效的 11 位手机号码');
    if (needsServerRestore && !serverAddress.trim()) return setError('请输入管理端服务器 IP');
    setBusy(true);
    try {
      const status = await window.yibiao!.license.login({
        name: normalizedName,
        phone: normalizedPhone,
        ...(needsServerRestore ? { serverAddress: serverAddress.trim() } : {}),
      });
      if (status.status === 'active' || status.status === 'debug_disabled') {
        onAuthorized(status);
      } else {
        setError(statusMessage(status) || '姓名、手机号或当前设备尚未获得授权。');
      }
    } catch (loginError) {
      const code = loginError instanceof Error ? loginError.message : '';
      setError(code.includes('INVALID_LAN_SERVER_ADDRESS')
        ? '服务器 IP 格式无效，可填写 IP 或 IP:端口。'
        : '登录校验失败，请检查局域网连接后重试。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="startup-auth-page">
      <div className="startup-auth-content">
        <header className="startup-auth-product">
          <img src={logoUrl} alt="佳图数科" />
          <h1>佳图智能投标助手</h1>
          <p>内部投标业务辅助工具</p>
        </header>
        <form className="startup-auth-card" onSubmit={login}>
          <header><span>EMPLOYEE ACCESS</span><h2>员工登录</h2><p>请输入姓名和手机号完成身份验证</p></header>
          <label>姓名<input autoFocus autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入员工真实姓名" /></label>
          <label>手机号<input inputMode="numeric" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="请输入 11 位手机号码" /></label>
          {needsServerRestore && (
            <>
              <label>管理端服务器 IP<input value={serverAddress} onChange={(event) => setServerAddress(event.target.value)} placeholder="例如 192.168.1.10 或 192.168.1.10:47821" /></label>
              <p className="startup-field-help">未找到已保存的管理端连接信息，请输入管理员提供的地址后正常登录。</p>
            </>
          )}
          {error && <p className="startup-form-message is-error" role="alert">{error}</p>}
          <button type="submit" className="startup-primary-button" disabled={busy}>{busy ? '正在校验授权…' : '登录'}</button>
          <div className="startup-login-divider"><span>或</span></div>
          <button type="button" className="startup-request-link" onClick={() => setRequestOpen(true)}>授权申请 <span aria-hidden="true">›</span></button>
        </form>
        <small className="startup-auth-version">
          内部专用 · {!versionLoaded ? '正在读取版本…' : appVersion ? `版本 ${appVersion}` : '未知版本'}
        </small>
      </div>
      <AuthorizationRequestDialog open={requestOpen} onOpenChange={setRequestOpen} />
    </main>
  );
}

export default StartupAuthPage;
