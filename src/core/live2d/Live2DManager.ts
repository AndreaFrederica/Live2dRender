/**
 * Live2D Manager
 * Replaces LAppLive2DManager
 * Manages models and rendering loop
 */

import { Live2DModel, PriorityNormal } from './Live2DModel';
import { Live2DView } from './Live2DView';
import { Live2DPAL } from './Live2DPAL';
import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { CubismFramework } from '@framework/live2dcubismframework';
import { getRuntimeConfig } from '../config';

export class Live2DManager {
  private _view: Live2DView;
  private _models: Live2DModel[] = [];
  private _modelsMap: Map<string, Live2DModel> = new Map();
  private _requestId: number = 0;
  private _gl: WebGLRenderingContext | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _targetFPS: number = 60; // Default 60 FPS
  private _lastFrameTime: number = 0;

  constructor() {
    this._view = new Live2DView();

    // Initialize Framework (Singleton)
    CubismFramework.startUp();
    CubismFramework.initialize();
  }

  /**
   * Set target FPS
   * @param fps Target frames per second
   */
  public setTargetFPS(fps: number): void {
    this._targetFPS = fps;
  }

  /**
   * Initialize WebGL context
   */
  public initialize(canvas: HTMLCanvasElement): boolean {
    this._canvas = canvas;
    this._gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext;

    if (!this._gl) {
      console.error('[Live2DManager] Failed to create WebGL context');
      return false;
    }

    // Setup GL
    this._gl.enable(this._gl.BLEND);
    this._gl.blendFunc(this._gl.SRC_ALPHA, this._gl.ONE_MINUS_SRC_ALPHA);

    // Resize view
    this.resize(canvas.clientWidth, canvas.clientHeight);

    return true;
  }

  /**
   * Resize canvas and view
   * @param width logical width
   * @param height logical height
   */
  public resize(width: number, height: number): void {
    if (!this._canvas) return;

    // Update canvas size with DevicePixelRatio
    const dpr = window.devicePixelRatio || 1;
    this._canvas.width = width * dpr;
    this._canvas.height = height * dpr;

    // Update View with logical or physical?
    // Live2DView uses Aspect Ratio, so either is fine as long as ratio is correct.
    // But viewport needs physical pixels.
    this._view.resize(this._canvas.width, this._canvas.height);
  }

  /**
   * Load model by path
   * @param actorId Unique ID for the model
   * @param dir Directory path
   * @param fileName File name
   */
  public async loadModel(actorId: string, dir: string, fileName: string): Promise<Live2DModel | null> {
    if (this._modelsMap.has(actorId)) {
      this.removeModel(actorId);
    }

    const model = new Live2DModel();
    if (this._gl) {
      model.setContext(this._gl);
    }
    try {
      await model.load(dir, fileName);
      this._models.push(model);
      this._modelsMap.set(actorId, model);
      return model;
    } catch (e) {
      console.error(`[Live2DManager] Failed to load model: ${actorId}`, e);
      return null;
    }
  }

  /**
   * Remove model by ID
   */
  public removeModel(actorId: string): void {
    const model = this._modelsMap.get(actorId);
    if (model) {
      model.release();
      this._models = this._models.filter(m => m !== model);
      this._modelsMap.delete(actorId);
    }
  }

  /**
   * Start rendering loop
   */
  public start(): void {
    if (this._requestId === 0) {
      this._loop(performance.now());
    }
  }

  /**
   * Stop rendering loop
   */
  public stop(): void {
    if (this._requestId !== 0) {
      cancelAnimationFrame(this._requestId);
      this._requestId = 0;
    }
  }

  private _loop = (timestamp: number) => {
    this._requestId = requestAnimationFrame(this._loop);

    // FPS Limit
    if (this._targetFPS > 0) {
      const interval = 1000 / this._targetFPS;
      const elapsed = timestamp - this._lastFrameTime;
      if (elapsed < interval) {
        return;
      }
      this._lastFrameTime = timestamp - (elapsed % interval);
    }

    this.update();
    this.draw();
  };

  /**
   * Update logic
   */
  public update(): void {
    Live2DPAL.updateTime();
    const deltaTime = Live2DPAL.getDeltaTime();

    for (const model of this._models) {
      model.update(deltaTime);
    }
  }

  public onDrag(x: number, y: number): void {
    for (const model of this._models) {
      model.setDragging(x, y);
    }
  }

  public onTap(x: number, y: number): void {
    for (const model of this._models) {
      if (model.hitTest('Head', x, y)) {
        model.setRandomExpression();
      } else if (model.hitTest('Body', x, y)) {
        model.startRandomMotion('TapBody', PriorityNormal);
      } else {
        // Default behavior if nothing specific hit but tap occurred on model?
        // LAppModel doesn't have a catch-all, but let's be safe.
      }
    }
  }

  /**
   * Draw frame
   */
  public draw(): void {
    if (!this._gl) return;

    // Clear screen (only screen, not offscreen buffers)
    const bg = getRuntimeConfig().BackgroundRGBA;
    this._gl.viewport(0, 0, this._canvas!.width, this._canvas!.height);
    this._gl.clearColor(bg[0], bg[1], bg[2], bg[3]);

    // Enable depth test and blend like Sample
    this._gl.enable(this._gl.DEPTH_TEST);
    this._gl.depthFunc(this._gl.LEQUAL);

    // Clear buffers
    this._gl.clear(this._gl.COLOR_BUFFER_BIT | this._gl.DEPTH_BUFFER_BIT);
    this._gl.clearDepth(1.0);

    // Setup Blend
    this._gl.enable(this._gl.BLEND);
    this._gl.blendFunc(this._gl.SRC_ALPHA, this._gl.ONE_MINUS_SRC_ALPHA);

    const projection = this._view.getProjectionMatrix();
    const viewport: number[] = [0, 0, this._canvas!.width, this._canvas!.height];

    for (const model of this._models) {
      model.getRenderer().setRenderState(null as any, viewport);
      model.draw(projection);
    }
  }

  public getModel(actorId: string): Live2DModel | undefined {
    return this._modelsMap.get(actorId);
  }

  public getAllModels(): Live2DModel[] {
    return this._models;
  }

  public getView(): Live2DView {
    return this._view;
  }

  public getGl(): WebGLRenderingContext | null {
    return this._gl;
  }
}
