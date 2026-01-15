import { getRuntimeConfig } from './config';
import { createItemIndexDB, selectItemIndexDB } from './db';
import { pinkLog } from './utils';

interface FakeResponse {
  arrayBuffer: () => Promise<ArrayBuffer>;
}

interface UrlDBItem {
  url: string;
  arraybuffer: ArrayBuffer;
}

interface ICacheSetting {
  refreshCache: boolean;
}

export const CacheFetchSetting: ICacheSetting = {
  refreshCache: false,
};

export async function cacheFetch(url: string): Promise<FakeResponse> {
  const { LoadFromCache, Live2dDB } = getRuntimeConfig();

  if (!CacheFetchSetting.refreshCache && LoadFromCache && Live2dDB) {
    const item = await selectItemIndexDB<UrlDBItem>('url', url);
    if (item !== undefined) {
      const arrayBuffer = item.arraybuffer;
      return {
        arrayBuffer: async () => arrayBuffer,
      };
    }
  }

  pinkLog('[Live2dRender] cacheFetch 请求并缓存 url ' + url);

  const originalResponse = await fetch(url);
  const arraybuffer = await originalResponse.arrayBuffer();

  if (LoadFromCache && Live2dDB) {
    createItemIndexDB<UrlDBItem>({ url, arraybuffer });
  }

  return {
    arrayBuffer: async () => arraybuffer,
  };
}

let installed = false;
let originalFetch: typeof fetch | null = null;

export function installFetchCache() {
  if (installed) return;
  if (typeof window === 'undefined') return;
  if (typeof fetch !== 'function') return;

  installed = true;
  originalFetch = fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { LoadFromCache, Live2dDB } = getRuntimeConfig();
    if (!LoadFromCache || !Live2dDB) {
      return originalFetch(input as any, init);
    }

    const method = (init?.method ?? (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')).toUpperCase();
    if (method !== 'GET') {
      return originalFetch(input as any, init);
    }

    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;

    if (!CacheFetchSetting.refreshCache) {
      const cached = await selectItemIndexDB<UrlDBItem>('url', url);
      if (cached) {
        return new Response(cached.arraybuffer.slice(0), { status: 200 });
      }
    }

    const resp = await originalFetch(input as any, init);
    try {
      if (resp.ok) {
        const cloned = resp.clone();
        const buf = await cloned.arrayBuffer();
        createItemIndexDB<UrlDBItem>({ url, arraybuffer: buf });
      }
    } catch {}
    return resp;
  }) as any;
}

export function uninstallFetchCache() {
  if (!installed) return;
  if (typeof window === 'undefined') return;
  if (originalFetch) {
    window.fetch = originalFetch as any;
  }
  installed = false;
  originalFetch = null;
}
