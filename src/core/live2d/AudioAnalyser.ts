/**
 * Audio Analyser for LipSync
 * Replaces LAppWavFileHandler from the official sample
 * Calculates RMS (Root Mean Square) from audio data to drive lip movement
 */

export class AudioAnalyser {
  private _pcmData: Float32Array[] | null = null;
  private _sampleRate: number = 44100;
  private _channelCount: number = 1;
  private _lastRms: number = 0;
  private _sampleOffset: number = 0;
  private _userTimeSeconds: number = 0;

  /**
   * Load WAV file and parse PCM data
   * @param path File path
   */
  public async load(path: string): Promise<boolean> {
    try {
      const response = await fetch(path);
      const buffer = await response.arrayBuffer();
      return this.parseWav(buffer);
    } catch (e) {
      console.error(`[AudioAnalyser] Failed to load audio: ${path}`, e);
      return false;
    }
  }

  /**
   * Parse WAV buffer
   * Note: This is a simplified WAV parser focusing on PCM format
   */
  private parseWav(buffer: ArrayBuffer): boolean {
    const data = new DataView(buffer);
    
    // Check RIFF header
    if (data.getUint32(0, false) !== 0x52494646) return false; // "RIFF"
    if (data.getUint32(8, false) !== 0x57415645) return false; // "WAVE"

    let offset = 12;
    while (offset < data.byteLength) {
      const chunkId = data.getUint32(offset, false);
      const chunkSize = data.getUint32(offset + 4, true);
      offset += 8;

      if (chunkId === 0x666d7420) { // "fmt "
        const audioFormat = data.getUint16(offset, true);
        if (audioFormat !== 1) return false; // Only support PCM
        
        this._channelCount = data.getUint16(offset + 2, true);
        this._sampleRate = data.getUint32(offset + 4, true);
        const bitsPerSample = data.getUint16(offset + 14, true);
        
        if (bitsPerSample !== 16) return false; // Only support 16-bit for now (Sample uses 16-bit)
      } else if (chunkId === 0x64617461) { // "data"
        const sampleCount = chunkSize / 2; // 16-bit = 2 bytes
        const samplesPerChannel = sampleCount / this._channelCount;
        
        this._pcmData = new Array(this._channelCount);
        for (let c = 0; c < this._channelCount; c++) {
          this._pcmData[c] = new Float32Array(samplesPerChannel);
        }

        let pcmOffset = offset;
        for (let i = 0; i < samplesPerChannel; i++) {
          for (let c = 0; c < this._channelCount; c++) {
            const sample = data.getInt16(pcmOffset, true);
            this._pcmData[c][i] = sample / 32768.0; // Normalize to -1..1
            pcmOffset += 2;
          }
        }
        
        // Reset state
        this._sampleOffset = 0;
        this._userTimeSeconds = 0;
        this._lastRms = 0;
        return true;
      }

      offset += chunkSize;
    }

    return false;
  }

  /**
   * Update RMS value based on delta time
   * @param deltaTimeSeconds Delta time in seconds
   * @returns Current RMS value (0..1)
   */
  public update(deltaTimeSeconds: number): number {
    if (!this._pcmData) return 0;

    this._userTimeSeconds += deltaTimeSeconds;
    
    // Calculate target sample offset
    let goalOffset = Math.floor(this._userTimeSeconds * this._sampleRate);
    const maxOffset = this._pcmData[0].length;
    
    if (goalOffset > maxOffset) {
      goalOffset = maxOffset;
    }

    if (this._sampleOffset >= goalOffset) {
      return this._lastRms;
    }

    // Calculate RMS for the new segment
    let sumSquared = 0;
    let sampleCount = 0;

    for (let c = 0; c < this._channelCount; c++) {
      const channelData = this._pcmData[c];
      for (let i = this._sampleOffset; i < goalOffset; i++) {
        const val = channelData[i];
        sumSquared += val * val;
        sampleCount++;
      }
    }

    this._sampleOffset = goalOffset;

    if (sampleCount > 0) {
      this._lastRms = Math.sqrt(sumSquared / sampleCount);
    } else {
      this._lastRms = 0;
    }

    return this._lastRms;
  }

  public getRms(): number {
    return this._lastRms;
  }
}
