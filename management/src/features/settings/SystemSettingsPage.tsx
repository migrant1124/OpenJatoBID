import { useState } from 'react';
import type { ManagementOperationResult } from '../../shared/ipc';

interface SystemSettingsPageProps {
  username: string;
  onChangePassword(currentPassword: string, newPassword: string): Promise<ManagementOperationResult>;
}

function SystemSettingsPage({ username, onChangePassword }: SystemSettingsPageProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');

    if (!currentPassword) return setError('请输入当前管理员密码');
    if (newPassword.length < 8) return setError('新密码至少需要 8 个字符');
    if (newPassword !== confirmPassword) return setError('两次输入的新密码不一致');
    if (newPassword === currentPassword) return setError('新密码不能与当前密码相同');

    setBusy(true);
    try {
      const result = await onChangePassword(currentPassword, newPassword);
      if (result.success) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setMessage(result.message ?? '管理员密码已修改，请妥善保管新密码。');
      } else {
        setError(result.message ?? '管理员密码修改失败');
      }
    } catch {
      setError('管理员密码修改失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="system-settings-page">
      <article className="settings-panel">
        <header>
          <div>
            <span>ADMIN ACCOUNT</span>
            <h2>管理员账号</h2>
            <p>管理端仅配置一个由公司负责人保管的管理员账号。</p>
          </div>
          <strong>{username || '—'}</strong>
        </header>
      </article>

      <article className="settings-panel password-settings-panel">
        <header>
          <div>
            <span>CHANGE PASSWORD</span>
            <h2>修改管理员密码</h2>
            <p>修改前需要验证当前密码。新密码保存后立即生效。</p>
          </div>
        </header>
        <form onSubmit={submit}>
          <label>
            当前密码
            <input
              autoComplete="current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </label>
          <label>
            新密码
            <input
              autoComplete="new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </label>
          <label>
            确认新密码
            <input
              autoComplete="new-password"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </label>
          {message && <p className="form-message is-success" role="status">{message}</p>}
          {error && <p className="form-message is-error" role="alert">{error}</p>}
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? '正在修改…' : '确认修改密码'}
          </button>
        </form>
      </article>

      <aside className="settings-warning" aria-label="密码保管说明">
        <strong>密码保管说明</strong>
        <p>管理端不提供自助恢复功能。密码遗失时只能使用有效的数据备份恢复，或重新初始化管理端。</p>
      </aside>
    </section>
  );
}

export default SystemSettingsPage;
