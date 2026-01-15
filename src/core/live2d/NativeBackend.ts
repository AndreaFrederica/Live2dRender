/**
 * Native Backend Implementation
 * Implements ILive2DBackend interface for Kosuzu integration
 */

import { Live2DManager } from './Live2DManager';
import { PriorityForce } from './Live2DModel';

// Interface definition matching Kosuzu's backend requirements
// (Reconstructed from pixi-backend.ts analysis)
export interface ILive2DBackend {
  init(input: HTMLCanvasElement): void;
  dispose(): void;
  resize(width: number, height: number): void;
  load(actorId: string, source: string): Promise<void>;
  unload(actorId: string): void;
  setTransform(actorId: string, transform: { x: number, y: number, scaleX: number, scaleY: number, rotation: number, opacity: number }): void;
  setParams(actorId: string, params: Record<string, number>): void;
  setControlOptions(actorId: string, options: Record<string, boolean>): void;
  playMotion(actorId: string, group: string, no: number, options?: { force?: boolean, priority?: number }): Promise<void>;
  playExpression(actorId: string, expressionId: string): void;
  // inspect(actorId: string): any; // Optional
  // snapshot(actorId: string): any; // Optional
}

export class NativeBackend implements ILive2DBackend {
  private _manager: Live2DManager;
  private _isInitialized: boolean = false;

  constructor() {
    this._manager = new Live2DManager();
  }

  public init(input: HTMLCanvasElement): void {
    if (this._isInitialized) return;
    this._manager.initialize(input);
    this._manager.start();
    this._isInitialized = true;
  }

  public dispose(): void {
    this._manager.stop();
    // Cleanup GL context if needed
  }

  public resize(width: number, height: number): void {
    this._manager.resize(width, height);
  }

  public async load(actorId: string, source: string): Promise<void> {
    // source is expected to be full path to model3.json
    const lastSlash = source.lastIndexOf('/');
    const dir = source.substring(0, lastSlash + 1);
    const fileName = source.substring(lastSlash + 1);

    await this._manager.loadModel(actorId, dir, fileName);
  }

  public unload(actorId: string): void {
    this._manager.removeModel(actorId);
  }

  public setTransform(actorId: string, transform: { x: number, y: number, scaleX: number, scaleY: number, rotation: number, opacity: number }): void {
    const model = this._manager.getModel(actorId);
    if (model) {
      // Update internal transform state
      Object.assign(model.transform, transform);

      // Update Matrix
      model.modelMatrix.loadIdentity();
      model.modelMatrix.translate(transform.x, transform.y);

      // Rotate (Z-axis)
      if (transform.rotation !== 0) {
        const rad = transform.rotation;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);

        // Construct rotation matrix manually since CubismMatrix44 lacks rotate()
        // This is a relative rotation multiplication
        // [ cos -sin 0 0 ]
        // [ sin  cos 0 0 ]
        // [ 0    0   1 0 ]
        // [ 0    0   0 1 ]

        // We can use multiply logic directly or create a helper
        // For simplicity, let's inject rotation into the current matrix
        // assuming standard 2D transform order (Translate -> Rotate -> Scale)

        // Actually, since we just did translate (which sets index 12, 13),
        // we can multiply rotation now.

        // But CubismMatrix44 is column-major? Let's check multiply impl.
        // It looks standard.

        // Let's create a temporary Float32Array for rotation
        const rotMatrix = new Float32Array([
          cos, sin, 0, 0,
          -sin, cos, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1
        ]);

        // Multiply: current * rot
        // But CubismMatrix44.multiply(a, b, dst) does dst = a * b
        // If we want M' = M * R, we need multiply(M, R, M)

        // However, CubismMatrix44 doesn't expose static multiply easily outside
        // We can access the internal array directly if we cast or use public getArray()

        const current = model.modelMatrix.getArray();
        const dst = new Float32Array(16);

        // We need to implement 4x4 multiplication here or use a helper
        // Or simpler: just use scale after rotation if possible.

        // Alternative: Use scale/translate then just manual rotation on top 2x2?
        // No, that's messy.

        // Let's rely on the fact that we are building the matrix from identity.
        // M = T * R * S

        // T is already set (loadIdentity + translate).
        // Now apply R.
        // Since it was identity before T, the top-left 3x3 is still identity.
        // So we can just overwrite the top-left 2x2 with rotation values?
        // Yes, if we haven't scaled yet.

        // M = [ 1 0 0 Tx ]
        //     [ 0 1 0 Ty ]
        //     ...

        // R = [ c -s 0 0 ]
        //     [ s  c 0 0 ]
        //     ...

        // M * R = [ c -s 0 Tx ]
        //         [ s  c 0 Ty ]

        // So yes, we can just set the 2x2 rotation block.
        // CubismMatrix44 is column-major (OpenGL style).
        // Index 0=c, 1=s, 4=-s, 5=c

        const tr = model.modelMatrix.getArray();
        tr[0] = cos;
        tr[1] = sin;
        tr[4] = -sin;
        tr[5] = cos;
      }

      model.modelMatrix.scaleRelative(transform.scaleX, transform.scaleY);

      model.setOpacity(transform.opacity);
    }
  }

  public setParams(actorId: string, params: Record<string, number>): void {
    const model = this._manager.getModel(actorId);
    if (model) {
      for (const [key, value] of Object.entries(params)) {
        // Direct parameter setting (this might conflict with motion update if not handled carefully)
        // Usually we set target value or override
        // CubismUserModel doesn't have direct setParameter API exposed easily without ID
        // We might need to map ID string to internal ID if needed, or use addParameterValue
        // But here we assume we can access underlying model
        // model.internalModel.setParameterValueById(id, value);
      }
    }
  }

  public setControlOptions(actorId: string, options: Record<string, boolean>): void {
    const model = this._manager.getModel(actorId);
    if (model) {
      Object.assign(model.controlOptions, options);
    }
  }

  public async playMotion(actorId: string, group: string, no: number, options?: { force?: boolean, priority?: number }): Promise<void> {
    const model = this._manager.getModel(actorId);
    if (model) {
      const priority = options?.force ? PriorityForce : (options?.priority ?? 2);
      model.startMotion(group, no, priority);
    }
  }

  public playExpression(actorId: string, expressionId: string): void {
    const model = this._manager.getModel(actorId);
    if (model) {
      model.setExpression(expressionId);
    }
  }

  // Helper for internal access
  public getManager(): Live2DManager {
    return this._manager;
  }
}
