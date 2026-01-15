/**
 * Core Live2D Model
 * Replaces LAppModel and integrates audio/transform logic
 */

import { CubismUserModel } from '@framework/model/cubismusermodel';
import { CubismMotionQueueEntryHandle, InvalidMotionQueueEntryHandleValue } from '@framework/motion/cubismmotionqueuemanager';
import { CubismMotion } from '@framework/motion/cubismmotion';
import { CubismMatrix44 } from '@framework/math/cubismmatrix44';
import { CubismDefaultParameterId } from '@framework/cubismdefaultparameterid';
import { ACubismMotion } from '@framework/motion/acubismmotion';
import { csmVector } from '@framework/type/csmvector';
import { csmMap } from '@framework/type/csmmap';
import { CubismFramework } from '@framework/live2dcubismframework';
import { CubismModelSettingJson } from '@framework/cubismmodelsettingjson';
import { CubismIdHandle } from '@framework/id/cubismid';
import { CubismRenderer_WebGL } from '@framework/rendering/cubismrenderer_webgl';
import { CubismEyeBlink } from '@framework/effect/cubismeyeblink';
import { CubismBreath, BreathParameterData } from '@framework/effect/cubismbreath';

import { Live2DPAL } from './Live2DPAL';
import { AudioAnalyser } from './AudioAnalyser';
import { stopVoice, unlockVoice, playVoiceFromUrl, isVoiceEnabled } from '../voice';

// Control options for disabling specific behaviors
export interface ControlOptions {
  banIdle?: boolean;
  banMotions?: boolean;
  banFocus?: boolean;
  banEyeBlink?: boolean;
  banBreath?: boolean;
}

// Priority constants
export const PriorityNone = 0;
export const PriorityIdle = 1;
export const PriorityNormal = 2;
export const PriorityForce = 3;

import { CubismPhysics } from '@framework/physics/cubismphysics';
import { CubismPose } from '@framework/effect/cubismpose';

export class Live2DModel extends CubismUserModel {
  public modelMatrix: CubismMatrix44;
  public controlOptions: ControlOptions = {};
  public transform = {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    opacity: 1,
  };

  public _modelSetting: CubismModelSettingJson | null = null;
  public _modelHomeDir: string = '';

  private _gl: WebGLRenderingContext | null = null;
  private _loadedTextures: WebGLTexture[] = [];

  private _audioAnalyser: AudioAnalyser;
  private _eyeBlinkIds: csmVector<CubismIdHandle>;
  private _lipSyncIds: csmVector<CubismIdHandle>;
  private _motions: csmMap<string, csmVector<CubismMotion>>;
  private _expressions: csmMap<string, ACubismMotion>;

  private _idParamAngleX: CubismIdHandle;
  private _idParamAngleY: CubismIdHandle;
  private _idParamAngleZ: CubismIdHandle;
  private _idParamBodyAngleX: CubismIdHandle;
  private _idParamEyeBallX: CubismIdHandle;
  private _idParamEyeBallY: CubismIdHandle;
  private _idParamMouthOpenY: CubismIdHandle;

  constructor() {
    super();
    this.modelMatrix = new CubismMatrix44();
    this._audioAnalyser = new AudioAnalyser();
    this._eyeBlinkIds = new csmVector<CubismIdHandle>();
    this._lipSyncIds = new csmVector<CubismIdHandle>();
    this._motions = new csmMap<string, csmVector<CubismMotion>>();
    this._expressions = new csmMap<string, ACubismMotion>();

    // Initialize parameter IDs
    const idManager = CubismFramework.getIdManager();
    this._idParamAngleX = idManager.getId(CubismDefaultParameterId.ParamAngleX);
    this._idParamAngleY = idManager.getId(CubismDefaultParameterId.ParamAngleY);
    this._idParamAngleZ = idManager.getId(CubismDefaultParameterId.ParamAngleZ);
    this._idParamBodyAngleX = idManager.getId(CubismDefaultParameterId.ParamBodyAngleX);
    this._idParamEyeBallX = idManager.getId(CubismDefaultParameterId.ParamEyeBallX);
    this._idParamEyeBallY = idManager.getId(CubismDefaultParameterId.ParamEyeBallY);
    this._idParamMouthOpenY = idManager.getId(CubismDefaultParameterId.ParamMouthOpenY);
  }

  public setContext(gl: WebGLRenderingContext) {
    this._gl = gl;
  }

  /**
   * Initialize and load model
   * @param dir Directory path
   * @param fileName Model file name (.model3.json)
   */
  public async load(dir: string, fileName: string): Promise<void> {
    this._modelHomeDir = dir;

    const buffer = await Live2DPAL.loadFileAsBytes(`${dir}${fileName}`);
    const setting = new CubismModelSettingJson(buffer, buffer.byteLength);

    await this.setupModel(setting);
  }

  public async setupModel(setting: CubismModelSettingJson) {
    this._modelSetting = setting;

    // Load model
    const fileName = setting.getModelFileName();
    if (fileName != '') {
      const buffer = await Live2DPAL.loadFileAsBytes(`${this._modelHomeDir}${fileName}`);
      this.loadModel(buffer);
    }

    // Auto-enable multiply/screen color override
    if (this._model) {
      this._model.setOverrideFlagForModelMultiplyColors(true);
      this._model.setOverrideFlagForModelScreenColors(true);
    }

    // Setup EyeBlink / LipSync IDs
    const eyeBlinkCount = setting.getEyeBlinkParameterCount();
    for (let i = 0; i < eyeBlinkCount; ++i) {
      this._eyeBlinkIds.pushBack(setting.getEyeBlinkParameterId(i));
    }
    const lipSyncCount = setting.getLipSyncParameterCount();
    for (let i = 0; i < lipSyncCount; ++i) {
      this._lipSyncIds.pushBack(setting.getLipSyncParameterId(i));
    }

    // Setup EyeBlink
    if (setting.getEyeBlinkParameterCount() > 0) {
      this._eyeBlink = CubismEyeBlink.create(setting);
    }

    // Setup Breath
    this._breath = CubismBreath.create();
    const breathParameters = new csmVector<BreathParameterData>();
    breathParameters.pushBack(
      new BreathParameterData(this._idParamAngleX, 0.0, 15.0, 6.5345, 0.5)
    );
    breathParameters.pushBack(
      new BreathParameterData(this._idParamAngleY, 0.0, 8.0, 3.5345, 0.5)
    );
    breathParameters.pushBack(
      new BreathParameterData(this._idParamAngleZ, 0.0, 10.0, 5.5345, 0.5)
    );
    breathParameters.pushBack(
      new BreathParameterData(this._idParamBodyAngleX, 0.0, 4.0, 15.5345, 0.5)
    );
    breathParameters.pushBack(
      new BreathParameterData(
        CubismFramework.getIdManager().getId(CubismDefaultParameterId.ParamBreath),
        0.5, 0.5, 3.2345, 1
      )
    );
    this._breath.setParameters(breathParameters);

    // Load expressions
    const expressionCount = setting.getExpressionCount();
    for (let i = 0; i < expressionCount; i++) {
      const name = setting.getExpressionName(i);
      const file = setting.getExpressionFileName(i);
      const buffer = await Live2DPAL.loadFileAsBytes(`${this._modelHomeDir}${file}`);
      const motion = this.loadExpression(buffer, buffer.byteLength, name);

      if (this._expressions.getValue(name) != null) {
        continue;
      }
      this._expressions.appendKey(name);
      this._expressions.setValue(name, motion);
    }

    // Load physics
    if (setting.getPhysicsFileName() != '') {
      const buffer = await Live2DPAL.loadFileAsBytes(`${this._modelHomeDir}${setting.getPhysicsFileName()}`);
      this.loadPhysics(buffer, buffer.byteLength);
    }

    // Load pose
    if (setting.getPoseFileName() != '') {
      const buffer = await Live2DPAL.loadFileAsBytes(`${this._modelHomeDir}${setting.getPoseFileName()}`);
      this.loadPose(buffer, buffer.byteLength);
    }

    // Load textures (Simplified texture loading)
    const len = setting.getTextureCount();
    for (let i = 0; i < len; i++) {
      const fileName = setting.getTextureFileName(i);
      const path = `${this._modelHomeDir}${fileName}`;

      // Note: In a real implementation we need to wait for textures.
      // For now we rely on the browser to load them and bind later or use a callback.
      // This part is incomplete without a full TextureManager but fits the minimal requirements.
      // We assume getRenderer().bindTexture() will be called somewhere or we need to do it here.
      // Since we don't have the GL context here easily without Manager, we might need to rethink texture loading.
      // However, for now let's assume textures are handled by the browser cache and we just need to bind them during draw.
      // Actually, we MUST create WebGL textures here.

      const img = new Image();
      img.onload = () => {
        if (!this._gl) return;
        const tex = this._gl.createTexture();
        if (tex) {
          this._gl.bindTexture(this._gl.TEXTURE_2D, tex);
          this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MIN_FILTER, this._gl.LINEAR_MIPMAP_LINEAR);
          this._gl.texParameteri(this._gl.TEXTURE_2D, this._gl.TEXTURE_MAG_FILTER, this._gl.LINEAR);
          this._gl.pixelStorei(this._gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
          this._gl.texImage2D(this._gl.TEXTURE_2D, 0, this._gl.RGBA, this._gl.RGBA, this._gl.UNSIGNED_BYTE, img);
          this._gl.generateMipmap(this._gl.TEXTURE_2D);

          this.getRenderer().bindTexture(i, tex);
          this._loadedTextures.push(tex);
        }
      }
      img.crossOrigin = 'Anonymous';
      img.src = path;
    }
  }

  // Override loadModel to handle renderer creation
  public loadModel(buffer: ArrayBuffer) {
    super.loadModel(buffer);
    this.createRenderer();
  }

  public createRenderer() {
    super.createRenderer();
    if (this._gl) {
      this.getRenderer().startUp(this._gl);
      this.getRenderer().setIsPremultipliedAlpha(true);
    }
  }

  public release() {
    if (this._gl) {
      this._loadedTextures.forEach(tex => this._gl!.deleteTexture(tex));
      this._loadedTextures = [];
    }
    super.release();
  }

  /**
   * Start motion with voice
   */
  public startMotion(group: string, no: number, priority: number, onFinishedMotionHandler?: any): CubismMotionQueueEntryHandle {
    if (priority == PriorityForce) {
      this._motionManager.setReservePriority(priority);
    } else if (!this._motionManager.reserveMotion(priority)) {
      return InvalidMotionQueueEntryHandleValue;
    }

    const fileName = this._modelSetting?.getMotionFileName(group, no);
    const name = `${group}_${no}`;

    // Check cache
    let motion = this._motions.getValue(name) as unknown as CubismMotion;

    if (motion == null) {
      if (!fileName) return InvalidMotionQueueEntryHandleValue;

      const path = `${this._modelHomeDir}${fileName}`;
      Live2DPAL.loadFileAsBytes(path).then(buffer => {
        motion = this.loadMotion(buffer, buffer.byteLength, name);

        // Setup effect ids
        motion.setEffectIds(this._eyeBlinkIds, this._lipSyncIds);

        this._motions.setValue(name, motion as any);
        this._startMotionImpl(motion, group, no, priority, onFinishedMotionHandler);
      });

      return InvalidMotionQueueEntryHandleValue;
    } else {
      return this._startMotionImpl(motion, group, no, priority, onFinishedMotionHandler);
    }
  }

  public startRandomMotion(group: string, priority: number, onFinishedMotionHandler?: any): CubismMotionQueueEntryHandle {
    if (!this._modelSetting) return InvalidMotionQueueEntryHandleValue;

    const count = this._modelSetting.getMotionCount(group);
    if (count == 0) return InvalidMotionQueueEntryHandleValue;

    const no = Math.floor(Math.random() * count);
    return this.startMotion(group, no, priority, onFinishedMotionHandler);
  }

  private _startMotionImpl(motion: CubismMotion, group: string, no: number, priority: number, callback?: any) {
    // 1. Stop previous voice
    stopVoice();

    // 2. Play new voice
    const voice = this._modelSetting?.getMotionSoundFileName(group, no);
    if (voice && isVoiceEnabled()) {
      unlockVoice().then(() => {
        const url = `${this._modelHomeDir}${voice}`;
        playVoiceFromUrl(url);

        // Start audio analysis for lipsync
        this._audioAnalyser.load(url);
      });
    }

    // 3. Start motion
    return this._motionManager.startMotionPriority(motion, false, priority);
  }

  /**
   * Update model state
   */
  public update(deltaTimeSeconds: number): void {
    if (!this._model) return;

    this._dragManager.update(deltaTimeSeconds);
    this._dragX = this._dragManager.getX();
    this._dragY = this._dragManager.getY();

    let motionUpdated = false;

    this._model.loadParameters();

    // Motion
    if (this._motionManager.isFinished()) {
      if (!this.controlOptions.banIdle) {
        this.startRandomMotion('Idle', PriorityIdle);
      }
    } else {
      motionUpdated = this._motionManager.updateMotion(this._model, deltaTimeSeconds);
    }

    this._model.saveParameters();

    // EyeBlink
    if (!motionUpdated && this._eyeBlink && !this.controlOptions.banEyeBlink) {
      this._eyeBlink.updateParameters(this._model, deltaTimeSeconds);
    }

    // Expression
    if (this._expressionManager) {
      this._expressionManager.updateMotion(this._model, deltaTimeSeconds);
    }

    // Drag (Face follow)
    if (!this.controlOptions.banFocus) {
      this._model.addParameterValueById(this._idParamAngleX, this._dragX * 30);
      this._model.addParameterValueById(this._idParamAngleY, this._dragY * 30);
      this._model.addParameterValueById(this._idParamAngleZ, this._dragX * this._dragY * -30);
      this._model.addParameterValueById(this._idParamBodyAngleX, this._dragX * 10);
      this._model.addParameterValueById(this._idParamEyeBallX, this._dragX);
      this._model.addParameterValueById(this._idParamEyeBallY, this._dragY);
    }

    // Breath
    if (this._breath && !this.controlOptions.banBreath) {
      this._breath.updateParameters(this._model, deltaTimeSeconds);
    }

    // Physics
    if (this._physics) {
      this._physics.evaluate(this._model, deltaTimeSeconds);
    }

    // Lipsync
    if (this._lipsync) {
      const rms = this._audioAnalyser.update(deltaTimeSeconds);
      for (let i = 0; i < this._lipSyncIds.getSize(); ++i) {
        this._model.addParameterValueById(this._lipSyncIds.at(i), rms, 0.8);
      }
    }

    // Pose
    if (this._pose) {
      this._pose.updateParameters(this._model, deltaTimeSeconds);
    }

    this._model.update();
  }

  /**
   * Hit test
   */
  public hitTest(hitAreaName: string, x: number, y: number): boolean {
    if (this._modelSetting == null) return false;

    const count = this._modelSetting.getHitAreasCount();
    for (let i = 0; i < count; i++) {
      if (this._modelSetting.getHitAreaName(i) == hitAreaName) {
        const drawId = this._modelSetting.getHitAreaId(i);
        return this.isHit(drawId, x, y);
      }
    }
    return false;
  }

  public isHit(drawableId: CubismIdHandle, pointX: number, pointY: number): boolean {
    // Use parent implementation
    return super.isHit(drawableId, pointX, pointY);
  }

  public setRandomExpression(): void {
    if (this._expressions.getSize() == 0) return;

    const no = Math.floor(Math.random() * this._expressions.getSize());
    const name = this._expressions._keyValues[no].first;
    this.setExpression(name);
  }

  /**
   * Draw model
   */
  public draw(matrix: CubismMatrix44): void {
    if (!this._model) return;

    // Apply model matrix (transform)
    matrix.multiplyByMatrix(this.modelMatrix);

    this.getRenderer().setMvpMatrix(matrix);
    this.getRenderer().drawModel();
  }

  public setDragging(x: number, y: number): void {
    this._dragManager.set(x, y);
  }

  /**
   * Set expression
   */
  public setExpression(expressionId: string): void {
    const motion = this._expressions.getValue(expressionId);
    if (motion) {
      this._expressionManager.startMotionPriority(motion, false, PriorityForce);
    }
  }
}
