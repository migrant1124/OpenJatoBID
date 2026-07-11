export interface ManagementAppInfo {
  version: string;
  platform: string;
  isPackaged: boolean;
  autoStartEnabled: boolean;
}

export interface JatoManagementApi {
  app: {
    getInfo(): Promise<ManagementAppInfo>;
  };
  server: {
    getStatus(): Promise<ManagementServerStatus>;
  };
  window: {
    minimize(): void;
    hide(): void;
  };
  setup: {
    getStatus(): Promise<ManagementSetupStatus>;
    complete(input: ManagementSetupInput): Promise<ManagementOperationResult>;
  };
  auth: {
    login(input: ManagementLoginInput): Promise<ManagementLoginResult>;
    completeInitialPasswordChange(newPassword: string): Promise<ManagementOperationResult>;
    changePassword(input: ManagementPasswordChangeInput): Promise<ManagementOperationResult>;
    getSession(): Promise<ManagementSession>;
    logout(): Promise<ManagementOperationResult>;
  };
  authorization: {
    list(): Promise<ManagementAuthorizationListResult>;
    approve(applicationId: string): Promise<ManagementOperationResult>;
    reject(applicationId: string): Promise<ManagementOperationResult>;
    revoke(licenseId: string): Promise<ManagementOperationResult>;
    renew(licenseId: string): Promise<ManagementOperationResult>;
  };
  analytics: {
    getDashboard(range: AnalyticsRange): Promise<ManagementAnalyticsResult>;
    cleanup(months: number): Promise<ManagementOperationResult & { deleted?: number }>;
  };
}

export interface ManagementServerConfig {
  host: string;
  port: number;
}

export interface ManagementServerStatus {
  status: 'STOPPED' | 'RUNNING' | 'ERROR';
  address: ManagementServerConfig | null;
  message: string;
}

export interface ManagementSetupInput {
  server: ManagementServerConfig;
}

export interface ManagementSetupStatus {
  serverConfigured: boolean;
  server: ManagementServerConfig | null;
}

export interface ManagementOperationResult {
  success: boolean;
  message?: string;
}

export interface ManagementSession {
  authenticated: boolean;
  username: string | null;
  mustChangePassword: boolean;
}

export interface ManagementLoginInput {
  username: string;
  password: string;
}

export interface ManagementLoginResult extends ManagementOperationResult {
  username: string | null;
  mustChangePassword: boolean;
}

export interface ManagementPasswordChangeInput {
  currentPassword: string;
  newPassword: string;
}

export type AuthorizationApplicationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'DEVICE_LIMIT' | 'REVOKED' | 'EXPIRED';

export interface AuthorizationApplication {
  id: string;
  name: string;
  phone: string;
  deviceFingerprint: string;
  clientId: string;
  platform: string;
  arch: string;
  status: AuthorizationApplicationStatus;
  submittedAt: string;
  decidedAt: string | null;
}

export interface AuthorizedDevice {
  id: string;
  clientId: string;
  platform: string;
  arch: string;
  status: 'ACTIVE' | 'REVOKED';
  lastSeenAt: string | null;
  licenseId: string | null;
  licenseStatus: 'ACTIVE' | 'REVOKED' | 'EXPIRED' | null;
  expiresAt: string | null;
  lastVerifiedAt: string | null;
}

export interface AuthorizedEmployee {
  id: string;
  name: string;
  phone: string;
  createdAt: string;
  activeDeviceCount: number;
  devices: AuthorizedDevice[];
}

export interface ManagementAuthorizationListResult extends ManagementOperationResult {
  applications?: AuthorizationApplication[];
  employees?: AuthorizedEmployee[];
}

export type AnalyticsRange = 'today' | '7d' | '30d' | 'all';

export interface NamedMetric {
  name: string;
  value: number;
}

export interface AnalyticsDashboard {
  range: AnalyticsRange;
  generatedAt: string;
  summary: {
    totalClients: number;
    newClients: number;
    activeClients: number;
    onlineClients: number;
    totalEvents: number;
    aiRequests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    agentSuccess: number;
    agentFailed: number;
    agentRetries: number;
  };
  versions: NamedMetric[];
  platforms: NamedMetric[];
  architectures: NamedMetric[];
  sourceIps: NamedMetric[];
  pages: NamedMetric[];
  configs: Array<{ key: string; value: string; count: number }>;
  resources: NamedMetric[];
  models: Array<{ provider: string; endpoint: string; model: string; requests: number; totalTokens: number }>;
  licenseStatuses: NamedMetric[];
  dailyActive: Array<{ date: string; clients: number; events: number }>;
  authorization: { employees: number; activeDevices: number; activeLicenses: number; revokedLicenses: number };
  recentEvents: Array<{
    eventId: string;
    eventType: string;
    clientId: string;
    employeeId: string | null;
    deviceId: string | null;
    sourceIp: string;
    occurredAt: string;
    payload: Record<string, string | number | boolean | null>;
  }>;
}

export interface ManagementAnalyticsResult extends ManagementOperationResult {
  dashboard?: AnalyticsDashboard;
}

declare global {
  interface Window {
    jatoManagement?: JatoManagementApi;
  }
}

export {};
