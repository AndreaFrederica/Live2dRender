export type CanvasSize = { width: number; height: number } | 'auto';
export type CanvasPosition = 'left' | 'right';

export type Live2dRuntimeConfig = {
  Canvas: HTMLCanvasElement | null;
  CanvasId: string;
  MessageBoxId: string;
  CanvasSize: CanvasSize;
  CanvasPosition: CanvasPosition;
  ResourcesPath: string;
  BackgroundRGBA: [number, number, number, number];
  EnableVoice: boolean;
  LoadFromCache: boolean;
  Live2dDB: IDBDatabase | null;
  showToolBox: boolean;
};

const runtimeConfig: Live2dRuntimeConfig = {
  Canvas: null,
  CanvasId: 'live2d',
  MessageBoxId: 'live2dMessageBox',
  CanvasSize: 'auto',
  CanvasPosition: 'right',
  ResourcesPath: '',
  BackgroundRGBA: [0, 0, 0, 0],
  EnableVoice: false,
  LoadFromCache: false,
  Live2dDB: null,
  showToolBox: false,
};

export function setRuntimeConfig(patch: Partial<Live2dRuntimeConfig>) {
  Object.assign(runtimeConfig, patch);
}

export function getRuntimeConfig() {
  return runtimeConfig;
}
