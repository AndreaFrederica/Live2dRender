import * as Live2dRender from './core/engine';

export * from './core/engine';

if (typeof window !== 'undefined') {
  (window as any).Live2dRender = Live2dRender;
}
