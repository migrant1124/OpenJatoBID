import { useState } from 'react';
import type { ManagementOperationResult } from '../../shared/ipc';

const logoUrl = new URL('../../../assets/company-logo.png', import.meta.url).href;

interface AdminLoginPageProps {
  mustChangePassword: boolean;
  onLogin(username: string, password: string): Promise<ManagementOperationResult>;
  onCompleteInitialPasswordChange(password: string): Promise<ManagementOperationResult>;
}

function AdminLoginPage({ mustChangePassword, onLogin, onCompleteInitialPasswordChange }: AdminLoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (mustChangePassword) {
      if (password.length < 8) return setError('新密码至少需要 8 个字符');
      if (password !== confirmPassword) return setError('两次输入的新密码不一致');
    } else {
      if (!username.trim()) return setError('请输入管理员账号');
      if (!password) return setError('请输入管理员密码');
    }

    setBusy(true);
    try {
      const result = mustChangePassword
        ? await onCompleteInitialPasswordChange(password)
        : await onLogin(username.trim(), password);
      if (!result.success) setError(result.message ?? (mustChangePassword ? '新密码保存失败' : '管理员账号或密码不正确'));
    } catch {
      setError(mustChangePassword ? '新密码保存失败，请稍后重试' : '登录失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-layout login-layout">
      <div className="login-content">
        <header className="login-product">
          <img src={logoUrl} alt="佳图数科" />
          <h1>佳图智能投标管理台</h1>
          <p>管理后台与配置控制中心</p>
        </header>
        <form className="auth-card login-card" onSubmit={submit}>
        <div className="auth-card-heading">
          <span>{mustChangePassword ? 'INITIAL PASSWORD CHANGE' : 'ADMIN CONSOLE'}</span>
          <h2>{mustChangePassword ? '设置新的管理员密码' : '管理员登录'}</h2>
          <p>
            {mustChangePassword
              ? '新密码设置完成前，无法进入管理端或配置局域网服务。'
              : '请输入管理员账号和密码'}
          </p>
        </div>
        {!mustChangePassword && (
          <label>
            管理员账号
            <input
              autoFocus
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="请输入管理员账号"
            />
          </label>
        )}
        <label>
          {mustChangePassword ? '新管理员密码' : '管理员密码'}
          <input
            autoFocus={mustChangePassword}
            type="password"
            autoComplete={mustChangePassword ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={mustChangePassword ? '请输入新的管理员密码' : '请输入管理员密码'}
          />
        </label>
        {mustChangePassword && (
          <label>
            确认新密码
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="请再次输入新的管理员密码"
            />
          </label>
        )}
        {error && <p className="form-message is-error" role="alert">{error}</p>}
        <button type="submit" className="primary-button" disabled={busy}>
          {busy ? '处理中…' : mustChangePassword ? '保存新密码并继续' : '登录'}
        </button>
        {mustChangePassword && (
          <p className="auth-security-hint">管理端不提供自助恢复功能，请由公司负责人妥善保管新密码和数据备份。</p>
        )}
      </form>
        <small className="login-version">内部专用 · 版本 1.0.0</small>
      </div>
    </main>
  );
}

export default AdminLoginPage;
