import { useEffect, useState } from 'react';
import AdminLoginPage from './features/auth/AdminLoginPage';
import AnalyticsPage from './features/analytics/AnalyticsPage';
import AuthorizationPage from './features/authorization/AuthorizationPage';
import SetupPage from './features/setup/SetupPage';
import SystemSettingsPage from './features/settings/SystemSettingsPage';
import type {
  ManagementOperationResult,
  ManagementServerStatus,
  ManagementSetupInput,
  ManagementSetupStatus,
} from './shared/ipc';

type AppView = 'loading' | 'setup' | 'login' | 'change-password' | 'dashboard' | 'error';
type DashboardSection = 'authorization' | 'analytics' | 'settings';

const sectionCopy: Record<DashboardSection, { eyebrow: string; title: string }> = {
  authorization: { eyebrow: '局域网授权中心', title: '授权管理' },
  analytics: { eyebrow: '局域网运营中心', title: '运维统计' },
  settings: { eyebrow: '管理端本机设置', title: '系统设置' },
};
const companyLogoUrl = new URL('../assets/company-logo.png', import.meta.url).href;

function App() {
  const [view, setView] = useState<AppView>('loading');
  const [setupStatus, setSetupStatus] = useState<ManagementSetupStatus | null>(null);
  const [message, setMessage] = useState('');
  const [section, setSection] = useState<DashboardSection>('authorization');
  const [serverStatus, setServerStatus] = useState<ManagementServerStatus | null>(null);
  const [sessionUsername, setSessionUsername] = useState('');

  useEffect(() => {
    const api = window.jatoManagement;
    if (!api) {
      setMessage('管理端桌面桥接不可用，请通过 Electron 启动本软件。');
      setView('error');
      return;
    }

    void Promise.all([api.setup.getStatus(), api.auth.getSession()])
      .then(([status, session]) => {
        setSetupStatus(status);
        setSessionUsername(session.username ?? '');
        if (!session.authenticated) {
          setView('login');
        } else if (session.mustChangePassword) {
          setView('change-password');
        } else {
          setView(status.serverConfigured ? 'dashboard' : 'setup');
        }
      })
      .catch(() => {
        setMessage('无法读取管理端本地配置。');
        setView('error');
      });
  }, []);

  useEffect(() => {
    if (view !== 'dashboard') return undefined;
    let active = true;
    const refresh = () => window.jatoManagement!.server.getStatus().then((status) => {
      if (active) setServerStatus(status);
    });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [view]);

  const completeSetup = async (input: ManagementSetupInput) => {
    const result = await window.jatoManagement!.setup.complete(input);
    if (result.success) {
      setSetupStatus({ serverConfigured: true, server: input.server });
      setView('dashboard');
    }
    return result;
  };

  const login = async (username: string, password: string) => {
    const api = window.jatoManagement!;
    const result = await api.auth.login({ username, password });
    if (result.success) {
      const session = await api.auth.getSession();
      setSessionUsername(session.username ?? username);
      if (session.mustChangePassword) {
        setView('change-password');
      } else {
        setView(setupStatus?.serverConfigured ? 'dashboard' : 'setup');
      }
    }
    return result;
  };

  const completeInitialPasswordChange = async (newPassword: string) => {
    const api = window.jatoManagement!;
    const result = await api.auth.completeInitialPasswordChange(newPassword);
    if (result.success) {
      const session = await api.auth.getSession();
      setSessionUsername(session.username ?? sessionUsername);
      setView(setupStatus?.serverConfigured ? 'dashboard' : 'setup');
    }
    return result;
  };

  const changePassword = (currentPassword: string, newPassword: string): Promise<ManagementOperationResult> => (
    window.jatoManagement!.auth.changePassword({ currentPassword, newPassword })
  );

  if (view === 'loading') {
    return <main className="center-state" aria-busy="true">正在读取管理端配置…</main>;
  }
  if (view === 'error') {
    return <main className="center-state is-error" role="alert">{message}</main>;
  }
  if (view === 'setup') {
    return <SetupPage initialServer={setupStatus?.server} onComplete={completeSetup} />;
  }
  if (view === 'login' || view === 'change-password') {
    return (
      <AdminLoginPage
        key={view}
        mustChangePassword={view === 'change-password'}
        onLogin={login}
        onCompleteInitialPasswordChange={completeInitialPasswordChange}
      />
    );
  }

  const currentSectionCopy = sectionCopy[section];

  return (
    <div className="management-shell">
      <aside className="management-sidebar">
        <img className="management-brand-mark" src={companyLogoUrl} alt="" aria-hidden="true" />
        <div>
          <strong>Jato AI BID</strong>
          <span>管理端</span>
        </div>
        <nav aria-label="管理端主菜单">
          <button type="button" className={section === 'authorization' ? 'is-active' : ''} onClick={() => setSection('authorization')}>授权管理</button>
          <button type="button" className={section === 'analytics' ? 'is-active' : ''} onClick={() => setSection('analytics')}>运维统计</button>
          <button type="button" className={section === 'settings' ? 'is-active' : ''} onClick={() => setSection('settings')}>系统设置</button>
        </nav>
        <button
          type="button"
          className="management-logout"
          onClick={() => {
            void window.jatoManagement!.auth.logout().then(() => {
              setSection('authorization');
              setSessionUsername('');
              setView('login');
            });
          }}
        >
          退出管理界面
        </button>
      </aside>
      <main className="management-content">
        <header>
          <div>
            <span>{currentSectionCopy.eyebrow}</span>
            <h1>{currentSectionCopy.title}</h1>
          </div>
          <span className={`service-status is-${(serverStatus?.status || 'stopped').toLowerCase()}`}>
            <i />{serverStatus?.status === 'RUNNING' ? `局域网服务运行中 · ${serverStatus.address?.host}:${serverStatus.address?.port}` : (serverStatus?.message || '局域网服务未运行')}
          </span>
        </header>
        {section === 'authorization' && <AuthorizationPage />}
        {section === 'analytics' && <AnalyticsPage />}
        {section === 'settings' && (
          <SystemSettingsPage username={sessionUsername} onChangePassword={changePassword} />
        )}
      </main>
    </div>
  );
}

export default App;
