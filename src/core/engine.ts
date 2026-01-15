/**
 * Engine Entry Point
 * Adapts NativeBackend to legacy global API
 */

import { getRuntimeConfig, setRuntimeConfig, type CanvasPosition, type CanvasSize } from './config';
import { initialiseIndexDB } from './db';
import { CacheFetchSetting } from './cache';
import { addToolBox, reloadToolBox, setToolBoxHost, type ToolBoxHost } from './toolbox';
import { isVoiceEnabled, setVoiceEnabled, unlockVoice } from './voice';
import { NativeBackend, ILive2DBackend } from './live2d/NativeBackend';
import { Live2DModel } from './live2d/Live2DModel';
import { PriorityForce } from './live2d/Live2DModel';

export type Live2dRenderConfig = {
  Canvas?: HTMLCanvasElement;
  CanvasId?: string;
  MessageBoxId?: string;
  CanvasSize?: CanvasSize;
  CanvasPosition?: CanvasPosition;
  BackgroundRGBA?: [number, number, number, number];
  ResourcesPath?: string;
  LoadFromCache?: boolean;
  ShowToolBox?: boolean;
  EnableVoice?: boolean;
  Live2dCubismcoreUrl?: string;
  Live2dDBName?: string;
  Live2dDBStore?: string;
};

// Global singleton instance for legacy compatibility
let backend: NativeBackend | null = null;
let cubismCoreLoading: Promise<void> | null = null;
let eventsInstalled = false;

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = (e) => reject(e);
    document.head.appendChild(script);
  });
}

async function ensureCubismCoreLoaded(url?: string) {
  if (typeof window === 'undefined') return;
  if ((window as any).Live2DCubismCore) return;
  if (cubismCoreLoading) return cubismCoreLoading;
  const src = url ?? 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js';
  cubismCoreLoading = loadScript(src).finally(() => {
    cubismCoreLoading = null;
  });
  await cubismCoreLoading;
}

function ensureCanvas(config: Live2dRenderConfig) {
  const rt = getRuntimeConfig();
  const id = config.CanvasId ?? rt.CanvasId ?? 'live2d';
  const existing = document.getElementById(id);
  const canvas =
    config.Canvas ??
    (existing instanceof HTMLCanvasElement ? existing : null) ??
    document.createElement('canvas');
  canvas.id = id;
  canvas.style.position = 'fixed';
  canvas.style.bottom = '0';
  canvas.style.zIndex = '9999';
  canvas.style.opacity = '1';
  canvas.style.transition = '.7s cubic-bezier(0.23, 1, 0.32, 1)';

  const pos = rt.CanvasPosition;
  if (pos === 'left') {
    canvas.style.left = '0';
    canvas.style.right = '';
  } else {
    canvas.style.right = '0';
    canvas.style.left = '';
  }

  const size = rt.CanvasSize;
  if (size !== 'auto') {
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
  } else {
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
  }

  if (!canvas.parentElement) document.body.appendChild(canvas);
  setRuntimeConfig({ Canvas: canvas, CanvasId: id });
  return canvas;
}

function buildToolBoxHost(backend: NativeBackend): ToolBoxHost {
  const getModel = () => {
    const models = backend.getManager().getAllModels();
    return models.length > 0 ? models[0] : null;
  };

  return {
    getCanvas: () => getRuntimeConfig().Canvas,
    getCanvasPosition: () => getRuntimeConfig().CanvasPosition,
    getExpressions: () => {
      const model = getModel();
      // Need to access internal expressions map if we want to list them
      // Live2DModel doesn't expose list easily in public API, let's access private or add getter
      // For now, casting to any to access private members for Toolbox compatibility
      const map = (model as any)?._expressions;
      const size = typeof map?.getSize === 'function' ? map.getSize() : 0;
      const items: Array<{ first: string; second: any }> = Array.isArray(map?._keyValues) ? map._keyValues : [];
      const out: Array<{ name: string; label: string }> = [];
      for (let i = 0; i < size; i++) {
        const p = items[i];
        if (!p || typeof p.first !== 'string') continue;
        const name = p.first;
        const label = String(name).replace('.exp3.json', '');
        out.push({ name, label });
      }
      return out;
    },
    setExpression: (name: string) => {
      const model = getModel();
      model?.setExpression(name);
    },
    getMotions: () => {
      const model = getModel();
      const setting = (model as any)?._modelSetting;
      if (!model || !setting) return [];

      const out: Array<{ group: string; index: number; label: string }> = [];
      try {
        const groupCount = typeof setting.getMotionGroupCount === 'function' ? setting.getMotionGroupCount() : 0;
        for (let gi = 0; gi < groupCount; gi++) {
          const group = setting.getMotionGroupName(gi);
          if (!group) continue;
          const count = typeof setting.getMotionCount === 'function' ? setting.getMotionCount(group) : 0;
          for (let mi = 0; mi < count; mi++) {
            const file = setting.getMotionFileName(group, mi);
            const base = String(file ?? '').split('/').pop() ?? '';
            const label = base.replace('.motion3.json', '').replace('.json', '') || `${group}#${mi}`;
            out.push({ group, index: mi, label });
          }
        }
      } catch { }
      return out;
    },
    playMotion: async (group: string, index: number) => {
      const model = getModel();
      model?.startMotion(group, index, PriorityForce);
    },
    reloadModel: async () => {
      // Reload current model
      const rt = getRuntimeConfig();
      if (rt.ResourcesPath && backend) {
        // Assuming single model mode for legacy API
        await backend.load('default', rt.ResourcesPath);
      }
      reloadToolBox();
    },
    setRefreshCache: (refresh: boolean) => {
      CacheFetchSetting.refreshCache = Boolean(refresh);
    },
  };
}

function installEvents(canvas: HTMLCanvasElement, backend: NativeBackend) {
  if (eventsInstalled) return;
  eventsInstalled = true;

  const view = backend.getManager().getView();
  const manager = backend.getManager();

  const handleTap = (x: number, y: number) => {
    // Transform screen to view
    const viewPos = view.transformScreenToView(x * window.devicePixelRatio, y * window.devicePixelRatio);

    // Hit test for all models
    // For now, Live2DManager doesn't expose hitTest directly for all models
    // We can iterate models manually
    const models = manager.getAllModels();
    for (const model of models) {
      // Live2DModel needs hitTest logic implementation
      // For compatibility with LAppModel's tap behavior (HitArea -> Motion)
      // We need to implement hitTest in Live2DModel or here.
      // LAppModel sample logic: if hit "Head" -> exp, "Body" -> random motion

      // Let's implement a simple tap handler here or in Model
      // Accessing private _modelSetting for areas
      const setting = (model as any)._modelSetting;
      if (!setting) continue;

      const count = setting.getHitAreasCount();
      for (let i = 0; i < count; i++) {
        const areaName = setting.getHitAreaName(i);
        const areaId = setting.getHitAreaId(i);
        const drawId = (model as any)._model.getDrawableIndex(areaId);
        if (drawId < 0) continue;

        const isHit = (model as any).isHit(areaId, viewPos.x, viewPos.y);
        if (isHit) {
          console.log(`[Engine] Hit: ${areaName}`);
          if (areaName.includes('Head')) {
            model.startRandomMotion('TapHead', PriorityForce);
          } else if (areaName.includes('Body')) {
            model.startRandomMotion('TapBody', PriorityForce);
          } else {
            model.startRandomMotion(areaName, PriorityForce);
          }
        }
      }
    }
  };

  const onDown = (e: PointerEvent) => {
    if (isVoiceEnabled()) void unlockVoice();
    manager.getView().setPosition(0, 0); // Reset or handle drag start
  };

  const onUp = (e: PointerEvent) => {
    handleTap(e.clientX, e.clientY);
    manager.onDrag(0, 0); // Reset drag on release
  };

  const onMove = (e: PointerEvent) => {
    const viewPos = view.transformScreenToView(e.clientX * window.devicePixelRatio, e.clientY * window.devicePixelRatio);
    manager.onDrag(viewPos.x, viewPos.y);
  };

  canvas.addEventListener('pointerdown', onDown, { passive: true });
  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerup', onUp, { passive: true });

  window.addEventListener('resize', () => {
    if (getRuntimeConfig().CanvasSize === 'auto') {
      backend.resize(window.innerWidth, window.innerHeight);
    }
  });
}

export async function initializeLive2D(config: Live2dRenderConfig) {
  setRuntimeConfig({
    Canvas: config.Canvas ?? getRuntimeConfig().Canvas,
    CanvasId: config.CanvasId ?? getRuntimeConfig().CanvasId,
    MessageBoxId: config.MessageBoxId ?? getRuntimeConfig().MessageBoxId,
    CanvasSize: config.CanvasSize ?? getRuntimeConfig().CanvasSize,
    CanvasPosition: config.CanvasPosition ?? getRuntimeConfig().CanvasPosition,
    BackgroundRGBA: config.BackgroundRGBA ?? getRuntimeConfig().BackgroundRGBA,
    ResourcesPath: config.ResourcesPath ?? getRuntimeConfig().ResourcesPath,
    LoadFromCache: Boolean(config.LoadFromCache),
    showToolBox: Boolean(config.ShowToolBox),
    EnableVoice: Boolean(config.EnableVoice),
  });

  if (config.LoadFromCache && window.indexedDB) {
    const dbName = config.Live2dDBName ?? 'db';
    const store = config.Live2dDBStore ?? 'live2d';
    const db = await initialiseIndexDB(dbName, 1, store);
    setRuntimeConfig({ Live2dDB: db });
  } else {
    setRuntimeConfig({ Live2dDB: null });
  }

  setVoiceEnabled(Boolean(config.EnableVoice));
  if (isVoiceEnabled()) await unlockVoice();

  await ensureCubismCoreLoaded(config.Live2dCubismcoreUrl);

  const canvas = ensureCanvas(config);

  if (!backend) {
    backend = new NativeBackend();
    backend.init(canvas);
    installEvents(canvas, backend);
    setToolBoxHost(buildToolBoxHost(backend));
  }

  // Load model if path is provided
  if (config.ResourcesPath) {
    await backend.load('default', config.ResourcesPath);
  }

  if (getRuntimeConfig().showToolBox) {
    addToolBox();
  }
}

export async function reloadLive2D(config: Partial<Live2dRenderConfig> = {}) {
  // Update config
  setRuntimeConfig({
    CanvasSize: config.CanvasSize ?? getRuntimeConfig().CanvasSize,
    CanvasPosition: config.CanvasPosition ?? getRuntimeConfig().CanvasPosition,
    BackgroundRGBA: config.BackgroundRGBA ?? getRuntimeConfig().BackgroundRGBA,
    ResourcesPath: config.ResourcesPath ?? getRuntimeConfig().ResourcesPath,
    showToolBox: config.ShowToolBox ?? getRuntimeConfig().showToolBox,
    EnableVoice: config.EnableVoice ?? getRuntimeConfig().EnableVoice,
  });

  setVoiceEnabled(Boolean(getRuntimeConfig().EnableVoice));
  if (isVoiceEnabled()) await unlockVoice();

  const canvas = getRuntimeConfig().Canvas;
  if (canvas && backend) {
    const size = getRuntimeConfig().CanvasSize;
    if (size !== 'auto') {
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
      backend.resize(size.width, size.height);
    }
  }

  if (getRuntimeConfig().ResourcesPath && backend) {
    await backend.load('default', getRuntimeConfig().ResourcesPath!);
  }

  reloadToolBox();
}

export function destroyLive2D() {
  if (backend) {
    backend.dispose();
    backend = null;
  }

  const canvas = getRuntimeConfig().Canvas;
  if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
  setRuntimeConfig({ Canvas: null });

  eventsInstalled = false;
  setToolBoxHost(null);
  setVoiceEnabled(false);
  setRuntimeConfig({ Live2dDB: null });
  cubismCoreLoading = null;
}

export { setVoiceEnabled, unlockVoice, NativeBackend };
export type { ILive2DBackend };
