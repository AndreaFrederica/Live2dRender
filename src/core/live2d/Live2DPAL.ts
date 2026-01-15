/**
 * Platform Abstraction Layer for Live2D Cubism SDK
 * Replaces LAppPal from the official sample
 */

import { cacheFetch } from '../cache';

export class Live2DPAL {
  private static _lastUpdateTime: number = 0;
  private static _deltaTime: number = 0;

  /**
   * Get delta time in seconds
   */
  public static getDeltaTime(): number {
    return this._deltaTime;
  }

  /**
   * Update time
   */
  public static updateTime(): void {
    const current = Date.now();
    this._deltaTime = (current - this._lastUpdateTime) / 1000.0;
    this._lastUpdateTime = current;
  }

  /**
   * Print log message
   * @param message Message to print
   */
  public static printMessage(message: string): void {
    console.log(`[Live2D] ${message}`);
  }

  /**
   * Load file as ArrayBuffer
   * @param path File path
   * @returns Promise resolving to ArrayBuffer
   */
  public static async loadFileAsBytes(path: string): Promise<ArrayBuffer> {
    const res = await cacheFetch(path);
    return res.arrayBuffer();
  }

  /**
   * Load file as JSON
   * @param path File path
   * @returns Promise resolving to JSON object
   */
  public static async loadFileAsJson(path: string): Promise<any> {
    const res = await cacheFetch(path);
    const buffer = await res.arrayBuffer();
    const text = new TextDecoder('utf-8').decode(buffer);
    return JSON.parse(text);
  }
}
