export class TouchManager {
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private lastX1 = 0;
  private lastY1 = 0;
  private lastX2 = 0;
  private lastY2 = 0;
  private deltaX = 0;
  private deltaY = 0;
  private scale = 1;
  private singleTouch = false;
  private flickAvailable = false;

  getCenterX() {
    return this.lastX;
  }

  getCenterY() {
    return this.lastY;
  }

  getDeltaX() {
    return this.deltaX;
  }

  getDeltaY() {
    return this.deltaY;
  }

  getStartX() {
    return this.startX;
  }

  getStartY() {
    return this.startY;
  }

  getScale() {
    return this.scale;
  }

  getX() {
    return this.lastX;
  }

  getY() {
    return this.lastY;
  }

  getX1() {
    return this.lastX1;
  }

  getY1() {
    return this.lastY1;
  }

  getX2() {
    return this.lastX2;
  }

  getY2() {
    return this.lastY2;
  }

  isSingleTouch() {
    return this.singleTouch;
  }

  isFlickAvailable() {
    return this.flickAvailable;
  }

  disableFlick() {
    this.flickAvailable = false;
  }

  touchesBegan(deviceX: number, deviceY: number) {
    this.startX = deviceX;
    this.startY = deviceY;
    this.lastX = deviceX;
    this.lastY = deviceY;
    this.deltaX = 0;
    this.deltaY = 0;
    this.scale = 1;
    this.singleTouch = true;
    this.flickAvailable = true;
  }

  touchesMoved(deviceX: number, deviceY: number) {
    this.deltaX = deviceX - this.lastX;
    this.deltaY = deviceY - this.lastY;
    this.lastX = deviceX;
    this.lastY = deviceY;
    this.singleTouch = true;
  }

  getFlickDistance() {
    const dx = this.lastX - this.startX;
    const dy = this.lastY - this.startY;
    return Math.hypot(dx, dy);
  }

  calculateDistance(x1: number, y1: number, x2: number, y2: number) {
    return Math.hypot(x1 - x2, y1 - y2);
  }

  calculateMovingAmount(v1: number, v2: number) {
    const sameDirection = (v1 >= 0 && v2 >= 0) || (v1 <= 0 && v2 <= 0);
    if (!sameDirection) return 0;
    const sign = v1 >= 0 ? 1 : -1;
    return sign * Math.min(Math.abs(v1), Math.abs(v2));
  }
}

