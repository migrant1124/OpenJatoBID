import { lazy, Suspense, useEffect, useState } from 'react';
import type { SectionId } from '../shared/types/navigation';
import { getAppMenuItemById } from './menuConfig';
import SecondaryMenuPage from '../shared/ui/SecondaryMenuPage';
import { isDeveloperDemoSection } from '../features/developer/developerDemoSections';

const BidOpportunityPage = lazy(() => import('../features/bid-opportunity/pages/BidOpportunityPage'));
const BusinessBidPage = lazy(() => import('../features/business-bid/pages/BusinessBidPage'));
const ContentExpansionReplaceTestPage = lazy(() => import('../features/developer/pages/ContentExpansionReplaceTestPage'));
const DeveloperDemoPage = lazy(() => import('../features/developer/pages/DeveloperDemoPage'));
const OpenCodeAgentTestPage = lazy(() => import('../features/developer/pages/OpenCodeAgentTestPage'));
const DeveloperTestPage = lazy(() => import('../features/developer/pages/DeveloperTestPage'));
const SystemDiagnosticsPage = lazy(() => import('../features/developer/pages/SystemDiagnosticsPage'));
const ExportFormatPage = lazy(() => import('../features/export-format/pages/ExportFormatPage'));
const MyTemplatesPage = lazy(() => import('../features/export-format/pages/MyTemplatesPage'));
const DuplicateCheckPage = lazy(() => import('../features/duplicate-check/pages/DuplicateCheckPage'));
const KnowledgeBasePage = lazy(() => import('../features/knowledge-base/pages/KnowledgeBasePage'));
const RejectionCheckPage = lazy(() => import('../features/rejection-check/pages/RejectionCheckPage'));
const ResourcesPage = lazy(() => import('../features/resources/pages/ResourcesPage'));
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

  if (activeMenuItem?.children?.length) {
    return <SecondaryMenuPage menuItem={activeMenuItem} onNavigate={onSectionChange} />;
  }

  if (isDeveloperDemoSection(activeSection)) {
    return <Suspense fallback={null}><DeveloperDemoPage sectionId={activeSection} /></Suspense>;
  }

  switch (activeSection) {
    case 'technical-plan':
      return <Suspense fallback={null}><TechnicalPlanHome workflowKind="technical-plan" registerLeaveGuard={registerLeaveGuard} onSectionChange={onSectionChange} /></Suspense>;
    case 'existing-plan-expansion':
      return <Suspense fallback={null}><TechnicalPlanHome workflowKind="existing-plan-expansion" registerLeaveGuard={registerLeaveGuard} onSectionChange={onSectionChange} /></Suspense>;
    case 'business-bid':
      return <Suspense fallback={null}><BusinessBidPage /></Suspense>;
    case 'document-knowledge-base':
      return <Suspense fallback={null}><KnowledgeBasePage /></Suspense>;
    case 'resources':
      return <Suspense fallback={null}><ResourcesPage /></Suspense>;
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
    case 'export-format':
      return <Suspense fallback={null}><ExportFormatPage mode="create" /></Suspense>;
    case 'bid-opportunity':
      return <Suspense fallback={null}><BidOpportunityPage /></Suspense>;
    case 'developer-test':
      return null;
    case 'developer-json-test':
      return <Suspense fallback={null}><DeveloperTestPage /></Suspense>;
    case 'developer-expansion-replace-test':
      return <Suspense fallback={null}><ContentExpansionReplaceTestPage /></Suspense>;
    case 'developer-opencode-agent-test':
      return <Suspense fallback={null}><OpenCodeAgentTestPage /></Suspense>;
    case 'developer-system-diagnostics':
      return <Suspense fallback={null}><SystemDiagnosticsPage /></Suspense>;
    case 'settings':
      return <Suspense fallback={null}><SettingsPage onDeveloperModeChange={onDeveloperModeChange} onLogout={onLogout} /></Suspense>;
    default:
      return null;
  }
}

export default AppRouter;
