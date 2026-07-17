import StartupAuthPage from '../features/auth/StartupAuthPage';
import SettingsPage from '../features/settings/pages/SettingsPage';
import type { LicenseRuntimeStatus } from '../shared/types';

const previewLicenseStatus: LicenseRuntimeStatus = {
  status: 'active',
  plan: 'enterprise_premium',
  expiresAt: '2027-07-11T23:59:59.000Z',
  licenseExpiresAt: '2027-07-11T23:59:59.000Z',
  licenseStatus: 'ACTIVE',
  activationMode: 'online',
  sourceTrusted: true,
  sourceTrustedText: '局域网管理端授权',
  untrustedReason: '',
  machineFingerprintHash: 'browser-preview',
  fingerprintVersion: 'preview',
  deviceCode: 'browser-preview',
  deviceCodeVersion: 'jato-device-v1',
  buildTrusted: true,
  buildChanged: false,
  buildId: 'browser-preview',
  keyId: 'browser-preview',
  lastCheckedAt: new Date().toISOString(),
  lastVerifiedAt: new Date().toISOString(),
  offlineValidUntil: '2026-08-10T23:59:59.000Z',
  serverAddress: '192.168.1.10:47821',
  employeeName: '张三（浏览器预览）',
  employeePhone: '13800000000',
  offline: false,
  serverReachable: true,
  message: '浏览器 UI 预览数据',
  config: {
    freeLicenseDays: 0,
    expirePopupEnabled: true,
    expirePopupDismissible: true,
  },
};

function BrowserDebugPreview() {
  const preview = new URLSearchParams(window.location.search).get('preview');

  if (preview === 'about') {
    return (
      <SettingsPage
        initialTab="about"
        initialLicenseStatus={previewLicenseStatus}
        onLogout={() => { window.location.search = ''; }}
      />
    );
  }

  return <StartupAuthPage initialStatus={null} onAuthorized={() => {}} />;
}

export default BrowserDebugPreview;
