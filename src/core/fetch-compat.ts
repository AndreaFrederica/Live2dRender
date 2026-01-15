import { getRuntimeConfig } from './config';

let installed = false;
let originalFetch: typeof fetch | null = null;

function getDirFromModel3JsonPath(model3JsonPath: string) {
  if (!model3JsonPath) return '';
  const slash = Math.max(model3JsonPath.lastIndexOf('/'), model3JsonPath.lastIndexOf('\\'));
  if (slash < 0) return '';
  return model3JsonPath.slice(0, slash + 1);
}

function normalizeSlashes(s: string) {
  return s.replace(/\\/g, '/');
}

function rewriteLive2dSampleUrl(url: string) {
  const { ResourcesPath } = getRuntimeConfig();
  if (!ResourcesPath || !ResourcesPath.endsWith('.model3.json')) return url;

  const normalizedUrl = normalizeSlashes(url);
  const normalizedModel3 = normalizeSlashes(ResourcesPath);
  const modelDir = getDirFromModel3JsonPath(normalizedModel3);

  if (
    normalizedUrl.endsWith('/Resources/Haru/Haru.model3.json') ||
    normalizedUrl.endsWith('../../Resources/Haru/Haru.model3.json') ||
    normalizedUrl.endsWith('Resources/Haru/Haru.model3.json')
  ) {
    return normalizedModel3;
  }

  const marker = '/Resources/Haru/';
  const idx = normalizedUrl.indexOf(marker);
  if (idx >= 0) {
    const suffix = normalizedUrl.slice(idx + marker.length).replace(/^\/+/, '');
    if (!modelDir) return url;
    return modelDir.replace(/\/+$/, '/') + suffix;
  }

  return url;
}

export function installFetchCompat() {
  if (installed) return;
  if (typeof window === 'undefined') return;
  if (typeof fetch !== 'function') return;

  installed = true;
  originalFetch = fetch.bind(window);

  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === 'string') {
      return originalFetch(rewriteLive2dSampleUrl(input) as any, init);
    }

    if (input instanceof URL) {
      const rewritten = rewriteLive2dSampleUrl(input.toString());
      return originalFetch(rewritten as any, init);
    }

    if (input instanceof Request) {
      const rewritten = rewriteLive2dSampleUrl(input.url);
      if (rewritten !== input.url) {
        const nextReq = new Request(rewritten, input);
        return originalFetch(nextReq as any, init);
      }
    }

    return originalFetch(input as any, init);
  }) as any;
}

export function uninstallFetchCompat() {
  if (!installed) return;
  if (typeof window === 'undefined') return;
  if (originalFetch) window.fetch = originalFetch as any;
  installed = false;
  originalFetch = null;
}

