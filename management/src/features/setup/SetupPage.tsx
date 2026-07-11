import { useState } from 'react';
import type { ManagementOperationResult, ManagementSetupInput } from '../../shared/ipc';

interface SetupPageProps {
  initialServer?: ManagementSetupInput['server'] | null;
  onComplete(input: ManagementSetupInput): Promise<ManagementOperationResult>;
}

function SetupPage({ initialServer, onComplete }: SetupPageProps) {
  const [serverHost, setServerHost] = useState(initialServer?.host ?? '0.0.0.0');
  const [serverPort, setServerPort] = useState(String(initialServer?.port ?? 47821));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const parsedServerPort = Number(serverPort);
    if (!serverHost.trim() || !Number.isInteger(parsedServerPort) || parsedServerPort < 1 || parsedServerPort > 65535) {
      return setError('请输入有效的监听 IP 和端口');
    }

    setBusy(true);
    try {
      const result = await onComplete({
        server: { host: serverHost.trim(), port: parsedServerPort },
      });
      if (!result.success) setError(result.message ?? '局域网服务设置失败');
    } catch {
      setError('局域网服务设置失败，请检查监听地址后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-layout setup-layout">
      <section className="auth-intro">
        <span className="auth-product">JATO AI BID</span>
        <h1>配置局域网管理端</h1>
        <p>管理员密码已设置。现在配置本机局域网监听地址，供员工客户端提交授权申请并定期校验授权。</p>
        <ol>
          <li><span>1</span>内置账号登录</li>
          <li><span>2</span>修改初始密码</li>
          <li><span>3</span>配置局域网服务</li>
        </ol>
      </section>
      <form className="auth-card setup-card server-setup-card" onSubmit={submit}>
        <div className="auth-card-heading">
          <span>SERVER SETUP</span>
          <h2>局域网服务设置</h2>
          <p>同一局域网只部署一个管理端。配置保存在本机，不会上传到公网。</p>
        </div>
        <fieldset className="form-grid">
          <legend>监听地址</legend>
          <label>
            监听 IP
            <input autoFocus value={serverHost} onChange={(event) => setServerHost(event.target.value)} />
          </label>
          <label>
            监听端口
            <input inputMode="numeric" value={serverPort} onChange={(event) => setServerPort(event.target.value)} />
          </label>
        </fieldset>
        <p className="setup-note">保存后，请在服务器防火墙中仅向公司局域网放行该端口。员工客户端需要填写此服务器的局域网 IP。</p>
        {error && <p className="form-message is-error" role="alert">{error}</p>}
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? '正在启动局域网服务…' : '保存设置并进入管理端'}
        </button>
      </form>
    </main>
  );
}

export default SetupPage;
