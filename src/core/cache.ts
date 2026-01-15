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

export function installFetchCache() {
  installed = true;
}

export function uninstallFetchCache() {
  installed = false;
}
