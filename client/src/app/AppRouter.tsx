import { lazy, Suspense, useEffect, useState } from 'react';
import type { SectionId } from '../shared/types/navigation';
import { getAppMenuItemById } from './menuConfig';
import SecondaryMenuPage from '../shared/ui/SecondaryMenuPage';

const ConversationPage = lazy(() => import('../features/conversation/pages/ConversationPage'));
const ImageStudioPage = lazy(() => import('../features/image-studio/pages/ImageStudioPage'));
const PptPage = lazy(() => import('../features/ppt/PptPage'));
const ContentExpansionReplaceTestPage = lazy(() => import('../features/developer/pages/ContentExpansionReplaceTestPage'));
const PiAgentMonitorPage = lazy(() => import('../features/developer/pages/PiAgentMonitorPage'));
const DeveloperTestPage = lazy(() => import('../features/developer/pages/DeveloperTestPage'));
const SystemDiagnosticsPage = lazy(() => import('../features/developer/pages/SystemDiagnosticsPage'));
const ExportFormatPage = lazy(() => import('../features/export-format/pages/ExportFormatPage'));
const MyTemplatesPage = lazy(() => import('../features/export-format/pages/MyTemplatesPage'));
const DuplicateCheckPage = lazy(() => import('../features/duplicate-check/pages/DuplicateCheckPage'));
const KnowledgeBasePage = lazy(() => import('../features/knowledge-base/pages/KnowledgeBasePage'));
const RejectionCheckPage = lazy(() => import('../features/rejection-check/pages/RejectionCheckPage'));
const SettingsPage = lazy(() => import('../features/settings/pages/SettingsPage'));
const TechnicalPlanHome = lazy(() => import('../features/technical-plan/pages/TechnicalPlanHome'));

interface AppRouterProps {
  activeSection: SectionId;
  developerMode: boolean;
  onDeveloperModeChange: (developerMode: boolean) => void;
  onLogout: () => void;
  onSectionChange: (section: SectionId) => void;
  registerLeaveGuard?: (guard: ((nextSection?: string) => Promise<boolean>) | null) => void;
}

function AppRouter({ activeSection, developerMode, onDeveloperModeChange, onLogout, onSectionChange, registerLeaveGuard }: AppRouterProps) {
  const activeMenuItem = getAppMenuItemById(activeSection, developerMode);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);

  useEffect(() => {
    if (activeSection !== 'my-templates') {
      setEditingTemplateId(null);
    }
  }, [activeSection]);

  if (activeSection === 'image-studio' || activeSection === 'image-studio-create'
    || activeSection === 'image-studio-prompts' || activeSection === 'image-studio-works') {
    return <Suspense fallback={null}><ImageStudioPage section={activeSection} onSectionChange={onSectionChange} /></Suspense>;
  }

  if (activeMenuItem?.children?.length) {
    return <SecondaryMenuPage menuItem={activeMenuItem} onNavigate={onSectionChange} />;
  }

  switch (activeSection) {
    case 'ppt':
      return <Suspense fallback={null}><PptPage registerLeaveGuard={registerLeaveGuard} /></Suspense>;
    case 'technical-plan':
      return <Suspense fallback={null}><TechnicalPlanHome workflowKind="technical-plan" registerLeaveGuard={registerLeaveGuard} onSectionChange={onSectionChange} /></Suspense>;
    case 'existing-plan-expansion':
      return <Suspense fallback={null}><TechnicalPlanHome workflowKind="existing-plan-expansion" registerLeaveGuard={registerLeaveGuard} onSectionChange={onSectionChange} /></Suspense>;
    case 'conversation':
      return <Suspense fallback={null}><ConversationPage /></Suspense>;
    case 'document-knowledge-base':
      return <Suspense fallback={null}><KnowledgeBasePage /></Suspense>;
    case 'duplicate-check':
      return <Suspense fallback={null}><DuplicateCheckPage /></Suspense>;
    case 'rejection-check':
      return <Suspense fallback={null}><RejectionCheckPage /></Suspense>;
    case 'my-templates':
      return editingTemplateId
        ? <Suspense fallback={null}><ExportFormatPage mode="edit" templateId={editingTemplateId} onBack={() => setEditingTemplateId(null)} /></Suspense>
        : <Suspense fallback={null}><MyTemplatesPage onCreateTemplate={() => onSectionChange('new-template')} onEditTemplate={setEditingTemplateId} /></Suspense>;
    case 'new-template':
      return <Suspense fallback={null}><ExportFormatPage mode="create" /></Suspense>;
    case 'developer-test':
      return null;
    case 'developer-json-test':
      return <Suspense fallback={null}><DeveloperTestPage /></Suspense>;
    case 'developer-expansion-replace-test':
      return <Suspense fallback={null}><ContentExpansionReplaceTestPage /></Suspense>;
    case 'developer-pi-agent-monitor':
      return <Suspense fallback={null}><PiAgentMonitorPage /></Suspense>;
    case 'developer-system-diagnostics':
      return <Suspense fallback={null}><SystemDiagnosticsPage /></Suspense>;
    case 'settings':
      return <Suspense fallback={null}><SettingsPage onDeveloperModeChange={onDeveloperModeChange} onLogout={onLogout} /></Suspense>;
    default:
      return null;
  }
}

export default AppRouter;
