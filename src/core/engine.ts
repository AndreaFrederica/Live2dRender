import { getRuntimeConfig, setRuntimeConfig, type CanvasPosition, type CanvasSize } from './config';
import { initialiseIndexDB } from './db';
import { CacheFetchSetting } from './cache';
import { addToolBox, reloadToolBox, setToolBoxHost, type ToolBoxHost } from './toolbox';
import { isVoiceEnabled, setVoiceEnabled, unlockVoice } from './voice';

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

type Sdk = {
  LAppSubdelegate: any;
  LAppPal: any;
  LAppView: any;
  LAppLive2DManager: any;
  LAppModel: any;
};

let sdk: Sdk | null = null;
let subdelegate: any | null = null;
let rafId: number | null = null;
let eventsInstalled = false;
let patched = false;
let cubismInitialized = false;
let cubismCoreLoading: Promise<void> | null = null;

function getDirFromModel3JsonPath(model3JsonPath: string) {
  if (!model3JsonPath) return { dir: '', fileName: '' };
  const normalized = model3JsonPath.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  if (slash < 0) return { dir: '', fileName: normalized };
  return { dir: normalized.slice(0, slash + 1), fileName: normalized.slice(slash + 1) };
}

async function loadSdk(): Promise<Sdk> {
  if (sdk) return sdk;
  const [{ LAppSubdelegate }, { LAppPal }, { LAppView }, { LAppLive2DManager }, { LAppModel }] = await Promise.all([
    import('../sdk/cubism/lappsubdelegate'),
    import('../sdk/cubism/lapppal'),
    import('../sdk/cubism/lappview'),
    import('../sdk/cubism/lapplive2dmanager'),
    import('../sdk/cubism/lappmodel'),
  ]);
  sdk = { LAppSubdelegate, LAppPal, LAppView, LAppLive2DManager, LAppModel };
  return sdk;
}

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

async function ensureCubismInitialized() {
  if (cubismInitialized) return;
  const { LAppDelegate } = await import('../sdk/cubism/lappdelegate');
  const delegate = LAppDelegate.getInstance();
  const init = (delegate as any).initializeCubism;
  if (typeof init === 'function') {
    init.call(delegate);
  }
  cubismInitialized = true;
}

function applySdkPatches(loaded: Sdk) {
  if (patched) return;
  patched = true;

  const viewProto: any = loaded.LAppView?.prototype;
  if (viewProto && !viewProto.__live2dRenderPatched) {
    viewProto.__live2dRenderPatched = true;
    viewProto.initializeSprite = function () { };

    const originalTouchesEnded = viewProto.onTouchesEnded;
    viewProto.onTouchesEnded = function (pointX: number, pointY: number) {
      const posX = pointX * window.devicePixelRatio;
      const posY = pointY * window.devicePixelRatio;
      const manager = this._subdelegate?.getLive2DManager?.();
      manager?.onDrag?.(0.0, 0.0);
      const x: number = this.transformViewX(posX);
      const y: number = this.transformViewY(posY);
      manager?.onTap?.(x, y);
      if (this._gear?.isHit?.(posX, posY)) {
        manager?.nextScene?.();
      }
      if (!this._gear && typeof originalTouchesEnded === 'function') {
        return;
      }
    };

    viewProto.release = function () {
      this._viewMatrix = null;
      this._touchManager = null;
      this._deviceToScreen = null;
      this._gear?.release?.();
      this._gear = null;
      this._back?.release?.();
      this._back = null;
      const gl = this._subdelegate?.getGlManager?.()?.getGl?.();
      if (gl && this._programId) gl.deleteProgram(this._programId);
      this._programId = null;
    };
  }

  const managerProto: any = loaded.LAppLive2DManager?.prototype;
  if (managerProto && !managerProto.__live2dRenderPatched) {
    managerProto.__live2dRenderPatched = true;

    const loadFromRuntime = function (this: any) {
      const { ResourcesPath } = getRuntimeConfig();
      if (!ResourcesPath || !ResourcesPath.endsWith('.model3.json')) return false;
      const { dir, fileName } = getDirFromModel3JsonPath(ResourcesPath);
      this.releaseAllModel?.();
      const instance = new loaded.LAppModel();
      instance.setSubdelegate?.(this._subdelegate);
      instance.loadAssets?.(dir, fileName);

      // Enable multiply and screen color overrides to support Live2D Editor color settings
      // This is required for models using "multiply" or "screen" blending modes
      const model = instance.getModel?.();
      if (model) {
        model.setOverrideFlagForModelMultiplyColors?.(true);
        model.setOverrideFlagForModelScreenColors?.(true);
      }

      this._models?.pushBack?.(instance);
      return true;
    };

    managerProto.initialize = function (sub: any) {
      this._subdelegate = sub;
      if (!loadFromRuntime.call(this)) {
        this.addModel?.(0);
      }
    };

    const originalAddModel = managerProto.addModel;
    managerProto.addModel = function () {
      if (!loadFromRuntime.call(this) && typeof originalAddModel === 'function') {
        return originalAddModel.apply(this, arguments as any);
      }
    };
  }

  const subProto: any = loaded.LAppSubdelegate?.prototype;
  if (subProto && !subProto.__live2dRenderPatched) {
    subProto.__live2dRenderPatched = true;
    const originalUpdate = subProto.update;
    subProto.update = function () {
      const gl = this._glManager?.getGl?.();
      if (!gl) return originalUpdate?.call(this);
      const originalClearColor = gl.clearColor?.bind(gl);
      const bg = getRuntimeConfig().BackgroundRGBA;

      gl.clearColor = ((r: number, g: number, b: number, a: number) => {
        // Only override clear color for default framebuffer (screen)
        // Live2D uses offscreen framebuffers for masking (clipping), which must not be overridden
        const binding = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        if (!binding) {
          originalClearColor(bg[0], bg[1], bg[2], bg[3]);
        } else {
          originalClearColor(r, g, b, a);
        }
      }) as any;

      try {
        return originalUpdate?.call(this);
      } finally {
        gl.clearColor = originalClearColor as any;
      }
    };
  }

  const modelProto: any = loaded.LAppModel?.prototype;
  if (modelProto && !modelProto.__live2dRenderPatched) {
    modelProto.__live2dRenderPatched = true;
    const originalStartMotion = modelProto.startMotion;
    modelProto.startMotion = function (group: string, no: number, priority: number) {
      import('./voice').then(({ stopVoice }) => stopVoice());
      const ret = originalStartMotion?.apply(this, [group, no, 3]);
      try {
        if (ret !== -1) {
          const voice = this._modelSetting?.getMotionSoundFileName?.(group, no);
          if (voice && String(voice).length && isVoiceEnabled()) {
            void unlockVoice().then(() => {
              const url = `${this._modelHomeDir}${voice}`;
              import('./voice').then(({ playVoiceFromUrl }) => playVoiceFromUrl(url));
            });
          }
        }
      } catch { }
      return ret;
    };
  }
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

function buildToolBoxHost(): ToolBoxHost {
  return {
    getCanvas: () => getRuntimeConfig().Canvas,
    getCanvasPosition: () => getRuntimeConfig().CanvasPosition,
    getExpressions: () => {
      const mgr = (subdelegate as any)?._live2dManager;
      const model = mgr?._models?.getSize?.() ? mgr._models.at(0) : null;
      const map = model?._expressions;
      const size = typeof map?.getSize === 'function' ? map.getSize() : 0;
      const items: Array<{ first: string; second: any }> = Array.isArray(map?._keyValues) ? map._keyValues : [];
      const out: Array<{ name: string; label: string }> = [];
      for (let i = 0; i < size; i++) {
        const p = items[i];
        if (!p || typeof p.first !== 'string') continue;
        if (!p.second) continue;
        const name = p.first;
        const label = String(name).replace('.exp3.json', '');
        out.push({ name, label });
      }
      return out;
    },
    setExpression: (name: string) => {
      const mgr = (subdelegate as any)?._live2dManager;
      const model = mgr?._models?.getSize?.() ? mgr._models.at(0) : null;
      model?.setExpression?.(name);
    },
    getMotions: () => {
      const mgr = (subdelegate as any)?._live2dManager;
      const model = mgr?._models?.getSize?.() ? mgr._models.at(0) : null;
      const setting = model?._modelSetting;
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
      const mgr = (subdelegate as any)?._live2dManager;
      const model = mgr?._models?.getSize?.() ? mgr._models.at(0) : null;
      model?.startMotion?.(group, index, 2);
    },
    reloadModel: async () => {
      const mgr = (subdelegate as any)?._live2dManager;
      mgr?.addModel?.(0);
      reloadToolBox();
    },
    setRefreshCache: (refresh: boolean) => {
      CacheFetchSetting.refreshCache = Boolean(refresh);
    },
  };
}

function installEvents(canvas: HTMLCanvasElement) {
  if (eventsInstalled) return;
  eventsInstalled = true;

  const onDown = (e: PointerEvent) => {
    if (isVoiceEnabled()) void unlockVoice();
    subdelegate?.onPointBegan?.(e.pageX, e.pageY);
  };
  const onMove = (e: PointerEvent) => subdelegate?.onPointMoved?.(e.pageX, e.pageY);
  const onUp = (e: PointerEvent) => subdelegate?.onPointEnded?.(e.pageX, e.pageY);
  const onCancel = (e: PointerEvent) => subdelegate?.onTouchCancel?.(e.pageX, e.pageY);

  canvas.addEventListener('pointerdown', onDown, { passive: true });
  canvas.addEventListener('pointermove', onMove, { passive: true });
  canvas.addEventListener('pointerup', onUp, { passive: true });
  canvas.addEventListener('pointercancel', onCancel, { passive: true });

  window.addEventListener('resize', () => {
    if (getRuntimeConfig().CanvasSize === 'auto') {
      subdelegate?.onResize?.();
    }
  });
}

function startLoop(pal: any) {
  if (rafId != null) return;
  const loop = () => {
    rafId = requestAnimationFrame(loop);
    pal?.updateTime?.();
    subdelegate?.update?.();
  };
  loop();
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

  const loaded = await loadSdk();
  await ensureCubismCoreLoaded(config.Live2dCubismcoreUrl);
  await ensureCubismInitialized();
  applySdkPatches(loaded);

  const canvas = ensureCanvas(config);
  if (!subdelegate) {
    subdelegate = new loaded.LAppSubdelegate();
    subdelegate.initialize(canvas);
    installEvents(canvas);
    setToolBoxHost(buildToolBoxHost());
  }

  startLoop(loaded.LAppPal);

  if (getRuntimeConfig().showToolBox) {
    addToolBox();
  }
}

export async function reloadLive2D(config: Partial<Live2dRenderConfig> = {}) {
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
  if (canvas) {
    const size = getRuntimeConfig().CanvasSize;
    if (size !== 'auto') {
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
    }
  }

  const mgr = (subdelegate as any)?._live2dManager;
  mgr?.addModel?.(0);
  reloadToolBox();
}

export function destroyLive2D() {
  if (rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  const canvas = getRuntimeConfig().Canvas;
  if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
  setRuntimeConfig({ Canvas: null });

  subdelegate = null;
  eventsInstalled = false;
  setToolBoxHost(null);
  setVoiceEnabled(false);
  setRuntimeConfig({ Live2dDB: null });
  cubismInitialized = false;
  cubismCoreLoading = null;
}

export { setVoiceEnabled, unlockVoice };
