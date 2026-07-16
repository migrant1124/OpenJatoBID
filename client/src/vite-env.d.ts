/// <reference types="vite/client" />

import type { YibiaoBridge } from './shared/types';

declare global {
  interface Window {
    jatoaibid?: YibiaoBridge;
    yibiao?: YibiaoBridge;
    yibiaoClient?: {
      appName: string;
      platform: string;
    };
  }
}

export {};
