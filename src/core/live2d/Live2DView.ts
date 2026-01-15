/**
 * View Controller for Live2D
 * Replaces LAppView
 * Handles matrix calculation and coordinate transformation
 */

import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { CubismViewMatrix } from '@framework/math/cubismviewmatrix';

export class Live2DView {
  private _deviceToScreen: CubismMatrix44;
  private _viewMatrix: CubismViewMatrix;
  private _projectionMatrix: CubismMatrix44;
  private _width: number = 0;
  private _height: number = 0;

  constructor() {
    this._deviceToScreen = new CubismMatrix44();
    this._viewMatrix = new CubismViewMatrix();
    this._projectionMatrix = new CubismMatrix44();

    // Default view range (can be adjusted per model or globally)
    this._viewMatrix.setMaxScale(2.0);
    this._viewMatrix.setMinScale(0.8);
    this._viewMatrix.setMaxScreenRect(-2.0, 2.0, -2.0, 2.0);
  }

  /**
   * Initialize view with canvas dimensions
   * @param width Canvas width
   * @param height Canvas height
   */
  public resize(width: number, height: number): void {
    this._width = width;
    this._height = height;

    // Match Sample Logic: Fix Y axis to [-1, 1], scale X axis by aspect ratio
    const ratio = width / height;
    const left = -ratio;
    const right = ratio;
    const bottom = -1.0;
    const top = 1.0;

    this._viewMatrix.setScreenRect(left, right, bottom, top);
    this._viewMatrix.scale(1.0, 1.0); // Default scale

    this._deviceToScreen.loadIdentity();
    if (width > height) {
      const screenW = Math.abs(right - left);
      this._deviceToScreen.scaleRelative(screenW / width, -screenW / width);
    } else {
      const screenH = Math.abs(top - bottom);
      this._deviceToScreen.scaleRelative(screenH / height, -screenH / height);
    }
    this._deviceToScreen.translateRelative(-width * 0.5, -height * 0.5);

    this.updateProjectionMatrix();
  }

  /**
   * Update projection matrix (MVP)
   */
  public updateProjectionMatrix(): void {
    this._projectionMatrix.loadIdentity();
    this._projectionMatrix.multiplyByMatrix(this._viewMatrix);
  }

  /**
   * Get the current projection matrix
   */
  public getProjectionMatrix(): CubismMatrix44 {
    return this._projectionMatrix;
  }

  /**
   * Transform screen coordinates (pixels) to view coordinates (Live2D logical)
   * @param x Screen X
   * @param y Screen Y
   */
  public transformScreenToView(x: number, y: number): { x: number, y: number } {
    const resX = this._deviceToScreen.transformX(x);
    const resY = this._deviceToScreen.transformY(y);
    return { x: resX, y: resY };
  }

  /**
   * Set view scale
   * @param scale Scale factor
   */
  public setScale(scale: number): void {
    this._viewMatrix.adjustScale(0, 0, scale);
    this.updateProjectionMatrix();
  }

  /**
   * Set view position
   * @param x View X
   * @param y View Y
   */
  public setPosition(x: number, y: number): void {
    this._viewMatrix.adjustTranslate(x, y);
    this.updateProjectionMatrix();
  }
}
