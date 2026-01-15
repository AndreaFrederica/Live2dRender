export let s_instance: LAppWavFileHandler = null;

type ParsedWav = {
  sampleRate: number;
  channels: number;
  pcm: Float32Array[];
};

function readFourCC(view: DataView, offset: number) {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function parseWav(buffer: ArrayBuffer): ParsedWav | null {
  const view = new DataView(buffer);
  if (view.byteLength < 12) return null;
  if (readFourCC(view, 0) !== 'RIFF') return null;
  if (readFourCC(view, 8) !== 'WAVE') return null;

  let fmtOffset = -1;
  let fmtSize = 0;
  let dataOffset = -1;
  let dataSize = 0;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = readFourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (id === 'fmt ') {
      fmtOffset = payload;
      fmtSize = size;
    } else if (id === 'data') {
      dataOffset = payload;
      dataSize = size;
    }
    offset = payload + size + (size % 2);
  }

  if (fmtOffset < 0 || dataOffset < 0) return null;
  if (fmtOffset + Math.min(fmtSize, 16) > view.byteLength) return null;

  const audioFormat = view.getUint16(fmtOffset + 0, true);
  const channels = view.getUint16(fmtOffset + 2, true);
  const sampleRate = view.getUint32(fmtOffset + 4, true);
  const bitsPerSample = view.getUint16(fmtOffset + 14, true);

  if (audioFormat !== 1) return null;
  if (!channels || !sampleRate) return null;
  if (![8, 16, 24, 32].includes(bitsPerSample)) return null;

  const bytesPerSample = bitsPerSample / 8;
  const frameBytes = channels * bytesPerSample;
  const available = Math.min(dataSize, view.byteLength - dataOffset);
  const frames = Math.floor(available / frameBytes);

  const pcm = Array.from({ length: channels }, () => new Float32Array(frames));

  let p = dataOffset;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      let sample = 0;
      if (bitsPerSample === 8) {
        sample = (view.getUint8(p) - 128) / 128;
        p += 1;
      } else if (bitsPerSample === 16) {
        sample = view.getInt16(p, true) / 32768;
        p += 2;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(p);
        const b1 = view.getUint8(p + 1);
        const b2 = view.getUint8(p + 2);
        let v = b0 | (b1 << 8) | (b2 << 16);
        if (v & 0x800000) v |= 0xff000000;
        sample = v / 8388608;
        p += 3;
      } else {
        sample = view.getInt32(p, true) / 2147483648;
        p += 4;
      }
      pcm[ch][i] = Math.max(-1, Math.min(1, sample));
    }
  }

  return { sampleRate, channels, pcm };
}

export class LAppWavFileHandler {
  private parsed: ParsedWav | null = null;
  private sampleCursor = 0;
  private timeSeconds = 0;
  private lastRms = 0;
  private inflight: Promise<void> | null = null;

  static getInstance() {
    if (!s_instance) s_instance = new LAppWavFileHandler();
    return s_instance;
  }

  static releaseInstance() {
    s_instance = null;
  }

  start(filePath: string) {
    this.sampleCursor = 0;
    this.timeSeconds = 0;
    this.lastRms = 0;
    this.parsed = null;
    this.inflight = fetch(filePath)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        this.parsed = parseWav(buf);
      })
      .catch(() => {
        this.parsed = null;
      })
      .finally(() => {
        this.inflight = null;
      });
  }

  update(deltaTimeSeconds: number) {
    const wav = this.parsed;
    if (!wav) {
      this.lastRms = 0;
      return false;
    }

    const frames = wav.pcm[0]?.length ?? 0;
    if (!frames) {
      this.lastRms = 0;
      return false;
    }

    this.timeSeconds += deltaTimeSeconds;
    const target = Math.min(frames, Math.floor(this.timeSeconds * wav.sampleRate));
    if (target <= this.sampleCursor) {
      this.lastRms = 0;
      return false;
    }

    let sum = 0;
    let count = 0;
    for (let ch = 0; ch < wav.channels; ch++) {
      const data = wav.pcm[ch];
      for (let i = this.sampleCursor; i < target; i++) {
        const v = data[i];
        sum += v * v;
        count += 1;
      }
    }

    this.sampleCursor = target;
    this.lastRms = count ? Math.sqrt(sum / count) : 0;
    return true;
  }

  getRms() {
    return this.lastRms;
  }
}

