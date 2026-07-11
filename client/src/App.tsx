import { useEffect, useRef, useState } from 'react';
import AppRouter from './app/AppRouter';
import GpuHardwareAccelerationPrompt from './app/GpuHardwareAccelerationPrompt';
import UpdateNotifier from './app/UpdateNotifier';
import AppShell from './components/AppShell';
import StartupAuthPage from './features/auth/StartupAuthPage';
import { trackAppOpen, trackConfigUsage, trackPageView } from './shared/analytics/analytics';
import type { LicenseRuntimeStatus } from './shared/types';
import type { SectionId } from './shared/types/navigation';

function isDeveloperSection(section: SectionId) {
  return section.startsWith('developer-');
}

function App() {
  const [authorizationChecked, setAuthorizationChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [initialLicenseStatus, setInitialLicenseStatus] = useState<LicenseRuntimeStatus | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('bid-generation');
  const [developerMode, setDeveloperMode] = useState(false);
  const leaveGuardRef = useRef<((nextSection?: string) => Promise<boolean>) | null>(null);

  useEffect(() => {
    const licenseApi = window.yibiao?.license;
    if (!licenseApi) {
      setAuthorizationChecked(true);
      return;
    }
    void licenseApi.getStatus()
      .then((status) => {
        setInitialLicenseStatus(status);
        if (status.status === 'debug_disabled') setAuthorized(true);
      })
      .finally(() => setAuthorizationChecked(true));
  }, []);

  useEffect(() => {
    if (!authorized) return undefined;
    const handleStatus = (status: LicenseRuntimeStatus) => {
      if (status.status === 'active' || status.status === 'debug_disabled') return;
      setInitialLicenseStatus(status);
      setAuthorized(false);
    };
    const verifyAfterReconnect = () => {
      void window.yibiao?.license.verify().then(handleStatus).catch(() => {});
    };
    const unsubscribe = window.yibiao?.license.onStatusChanged(handleStatus);
    window.addEventListener('online', verifyAfterReconnect);
    return () => {
      unsubscribe?.();
      window.removeEventListener('online', verifyAfterReconnect);
    };
  }, [authorized]);

  useEffect(() => {
    if (!authorized) return;
    trackAppOpen();

    void window.yibiao?.config.load()
      .then((config) => {
        setDeveloperMode(Boolean(config?.developer_mode));
        trackConfigUsage({}, config);
      })
      .catch((error) => console.warn('读取开发者模式失败', error));
  }, [authorized]);

  useEffect(() => {
    if (!authorized) return;
    trackPageView(activeSection);
  }, [activeSection, authorized]);

  useEffect(() => {
    if (!developerMode && isDeveloperSection(activeSection)) {
      setActiveSection('bid-generation');
    }
  }, [activeSection, developerMode]);

  const requestSectionChange = async (section: SectionId) => {
    if (section === activeSection) {
      return;
    }
    const allowed = await (leaveGuardRef.current?.(section) ?? Promise.resolve(true));
    if (allowed) {
      setActiveSection(section);
    }
  };

  const logoutCurrentSession = () => {
    leaveGuardRef.current = null;
    setActiveSection('bid-generation');
    setAuthorized(false);
  };

  if (!authorizationChecked) {
    return <main className="startup-auth-loading" aria-busy="true">正在读取本机授权…</main>;
  }

  if (!authorized) {
    return <StartupAuthPage initialStatus={initialLicenseStatus} onAuthorized={(status) => { setInitialLicenseStatus(status); setAuthorized(true); }} />;
  }

  return (
    <>
      <GpuHardwareAccelerationPrompt />
      <UpdateNotifier />
      <AppShell
        activeSection={activeSection}
        developerMode={developerMode}
        onSectionChange={(section) => { void requestSectionChange(section); }}
      >
        <AppRouter
          activeSection={activeSection}
          developerMode={developerMode}
          onDeveloperModeChange={setDeveloperMode}
          onLogout={logoutCurrentSession}
          onSectionChange={(section) => { void requestSectionChange(section); }}
          registerLeaveGuard={(guard) => {
            leaveGuardRef.current = guard;
          }}
        />
      </AppShell>
    </>
  );
}

export default App;
