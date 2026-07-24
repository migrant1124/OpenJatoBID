import type { SectionId } from '../../shared/types/navigation';

export type DeveloperDemoSectionId = 'developer-prompt-lab' | 'developer-parser-sandbox' | 'developer-export-preview';

export function isDeveloperDemoSection(sectionId: SectionId): sectionId is DeveloperDemoSectionId {
  return sectionId === 'developer-prompt-lab' || sectionId === 'developer-parser-sandbox' || sectionId === 'developer-export-preview';
}