import type { YibiaoBridge } from '../types';

let appVersionPromise: Promise<string> | null = null;

export function getAppVersion(): Promise<string> {
  if (!appVersionPromise) {
    appVersionPromise = Promise.resolve()
      .then(async () => {
        const bridge: YibiaoBridge | undefined = window.jatoaibid || window.yibiao;
        const version = await bridge?.getVersion?.();
        return typeof version === 'string' ? version.trim() : '';
      })
      .catch(() => '');
  }

  return appVersionPromise;
}
