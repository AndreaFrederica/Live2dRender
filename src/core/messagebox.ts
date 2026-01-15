import { getRuntimeConfig } from './config';

export let s_instance: LAppMessageBox = null;
export let messageBox: HTMLDivElement = null;

export class LAppMessageBox {
  static getInstance() {
    if (!s_instance) s_instance = new LAppMessageBox();
    return s_instance;
  }

  private _messageBox: HTMLDivElement = null;

  getMessageBox() {
    if (!this._messageBox) {
      this._messageBox = document.querySelector('#live2dMessageBox-content');
    }
    return this._messageBox;
  }

  initialize(canvas: HTMLCanvasElement) {
    const cfg = getRuntimeConfig();

    messageBox = document.createElement('div');
    messageBox.id = cfg.MessageBoxId;
    messageBox.style.position = 'fixed';
    messageBox.style.padding = '10px';
    messageBox.style.zIndex = '9999';
    messageBox.style.display = 'flex';
    messageBox.style.justifyContent = 'center';
    messageBox.style.width = canvas.width + 'px';
    messageBox.style.height = '20px';
    if (cfg.CanvasPosition === 'left') {
      messageBox.style.left = '0';
    } else {
      messageBox.style.right = '0';
    }
    messageBox.style.bottom = canvas.height + 50 + 'px';
    messageBox.innerHTML = '<div id="live2dMessageBox-content"></div>';
    document.body.appendChild(messageBox);
    this.hideMessageBox();
    return true;
  }

  setMessage(message: string, duration: number = null) {
    const cfg = getRuntimeConfig();
    const inner = this.getMessageBox();
    this.hideMessageBox();
    inner.textContent = message;

    setTimeout(() => {
      const wrapperDiv: HTMLDivElement = document.querySelector('#' + cfg.MessageBoxId);
      const canvasHeight = cfg.CanvasSize === 'auto' ? 500 : cfg.CanvasSize.height;
      wrapperDiv.style.bottom = canvasHeight + inner.offsetHeight - 25 + 'px';
    }, 10);

    this.revealMessageBox();
    if (duration) {
      setTimeout(() => this.hideMessageBox(), duration);
    }
  }

  hideMessageBox() {
    const inner = this.getMessageBox();
    inner.classList.remove('live2dMessageBox-content-visible');
    inner.classList.add('live2dMessageBox-content-hidden');
  }

  revealMessageBox() {
    const inner = this.getMessageBox();
    inner.classList.remove('live2dMessageBox-content-hidden');
    inner.classList.add('live2dMessageBox-content-visible');
  }
}

