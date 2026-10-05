export type SectionId =
  | 'bid-generation'
  | 'technical-plan'
  | 'existing-plan-expansion'
  | 'conversation'
  | 'ppt'
  | 'image-studio'
  | 'image-studio-create'
  | 'image-studio-prompts'
  | 'image-studio-works'
  | 'knowledge-base'
  | 'document-knowledge-base'
  | 'bid-check'
  | 'duplicate-check'
  | 'rejection-check'
  | 'template-settings'
  | 'my-templates'
  | 'new-template'
  | 'developer-test'
  | 'developer-json-test'
  | 'developer-expansion-replace-test'
  | 'developer-pi-agent-monitor'
  | 'developer-system-diagnostics'
  | 'settings';

export interface AppMenuNotice {
  message: string;
  actionLabel?: string;
  externalUrl?: string;
}

export interface AppSubMenuItem {
  id: SectionId;
  label: string;
  description: string;
  icon?: 'document' | 'expand' | 'briefcase' | 'compare' | 'shield' | 'code' | 'prompt' | 'file' | 'export' | 'tool';
  notice?: AppMenuNotice;
}

export interface AppMenuItem {
  id: SectionId;
  label: string;
  description: string;
  children?: AppSubMenuItem[];
  notice?: AppMenuNotice;
}
