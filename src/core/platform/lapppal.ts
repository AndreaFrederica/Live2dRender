export class LAppPal {
  private static currentTs = 0;
  private static lastTs = 0;
  private static deltaSeconds = 0;

  static loadFileAsBytes(filePath: string, callback: (arrayBuffer: ArrayBuffer, size: number) => void) {
    fetch(filePath)
      .then((r) => r.arrayBuffer())
      .then((buf) => callback(buf, buf.byteLength))
      .catch(() => callback(new ArrayBuffer(0), 0));
  }

  static getDeltaTime() {
    return this.deltaSeconds;
  }

  static updateTime() {
    const now = Date.now();
    if (!this.lastTs) this.lastTs = now;
    this.currentTs = now;
    this.deltaSeconds = (this.currentTs - this.lastTs) / 1000;
    this.lastTs = this.currentTs;
  }

  static printMessage(_message: string) {}
}

