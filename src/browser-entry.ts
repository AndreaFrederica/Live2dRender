/**
 * 浏览器入口文件 - 导出 Live2dRender 到全局
 */

import * as Live2dRender from './main';

// 将 Live2dRender 导出到 window 对象，使全局可访问
if (typeof window !== 'undefined') {
  (window as any).Live2dRender = Live2dRender;
}

export * from './main';
