import { CacheFetchSetting } from './cache';
import { getRuntimeConfig } from './config';
import * as svgIcon from './svg';
import { isVoiceEnabled, setVoiceEnabled, unlockVoice } from './voice';

type ExpressionEntry = { name: string; label: string };
type MotionEntry = { group: string; index: number; label: string };

export type ToolBoxHost = {
  getCanvas: () => HTMLCanvasElement | null;
  getCanvasPosition: () => 'left' | 'right';
  getExpressions: () => ExpressionEntry[];
  setExpression: (name: string) => void;
  getMotions: () => MotionEntry[];
  playMotion: (group: string, index: number) => void | Promise<void>;
  reloadModel: () => void | Promise<void>;
  setRefreshCache: (refresh: boolean) => void;
};

let host: ToolBoxHost | null = null;

export function setToolBoxHost(nextHost: ToolBoxHost | null) {
  host = nextHost;
}

const defaultIconSize = 35;
const defaultIconBgColor = '#00A6ED';
const defaultIconFgColor = 'white';
const defaultHoverColor = 'rgb(224, 209, 41)';

let container: HTMLDivElement | undefined;
let collapse = false;
let widthXoffset = 35;
const live2dBoxItemCss = '__live2d-toolbox-item';
let resizeObserver: ResizeObserver | null = null;
let resizeObservedCanvas: HTMLCanvasElement | null = null;
let pendingRelayout = false;

function addCssClass() {
  const style = document.createElement('style');
  style.innerHTML = `
.${live2dBoxItemCss} {
  margin: 2px;
  padding: 2px;
  display: flex;
  height: ${defaultIconSize}px;
  width: ${defaultIconSize}px;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  font-size: 0.7rem;
  background-color: ${defaultIconBgColor};
  color: ${defaultIconFgColor};
  border-radius: 0.5em;
  transition: all .35s cubic-bezier(0.23, 1, 0.32, 1);
}

.${live2dBoxItemCss}:hover {
  background-color: rgb(224, 209, 41);
}

.${live2dBoxItemCss}.button-item {
  display: flex;
  align-items: center;
  width: fit-content;
  padding: 5px 10px 0px;
}

.${live2dBoxItemCss}.button-item svg {
  height: 20px;
}

.${live2dBoxItemCss}.expression-item {
  display: flex;
  align-items: center;
  width: fit-content;
  padding: 3px 10px;
}

.${live2dBoxItemCss}.expression-item > span:last-child {
  width: 60px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.${live2dBoxItemCss}.expression-item svg {
  height: 20px;
  margin-right: 5px;
}

.${live2dBoxItemCss} svg path {
  fill: white;
}
`;
  document.head.appendChild(style);
}

function showContainer() {
  if (!container) return;
  container.style.opacity = '1';
}

function hideContainer() {
  if (!container || collapse) return;
  container.style.opacity = '0';
}

function createCommonIcon(svgString: string, extraString = '', cssClasses: string[] = []) {
  const div = document.createElement('div');
  div.classList.add(live2dBoxItemCss);
  for (const css of cssClasses) div.classList.add(css);

  const firstSpan = document.createElement('span');
  const secondSpan = document.createElement('span');
  firstSpan.innerHTML = svgString;
  secondSpan.innerText = extraString;

  div.appendChild(firstSpan);
  div.appendChild(secondSpan);
  return div;
}

function makeLive2dCollapseIcon(containerEl: HTMLDivElement) {
  const position = host?.getCanvasPosition() ?? getRuntimeConfig().CanvasPosition;
  const iconSvg = position === 'left' ? svgIcon.collapseIconLeft : svgIcon.collapseIconRight;
  const icon = createCommonIcon(iconSvg, '', ['button-item']);
  icon.style.backgroundColor = defaultIconBgColor;
  icon.style.fontSize = '1.05rem';

  icon.addEventListener('mouseenter', () => {
    icon.style.backgroundColor = defaultHoverColor;
  });
  icon.addEventListener('mouseleave', () => {
    icon.style.backgroundColor = defaultIconBgColor;
  });

  let xoffset = 0;
  icon.onclick = async () => {
    const canvas = host?.getCanvas() ?? getRuntimeConfig().Canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const canvasWidth = Math.ceil(rect.width);
    xoffset = (xoffset + canvasWidth) % (canvasWidth << 1);

    const pos = host?.getCanvasPosition() ?? getRuntimeConfig().CanvasPosition;
    if (pos === 'left') {
      canvas.style.transform = `translateX(-${xoffset}px)`;
      containerEl.style.transform = `translateX(-${Math.max(0, xoffset - widthXoffset)}px)`;
    } else {
      canvas.style.transform = `translateX(${xoffset}px)`;
      containerEl.style.transform = `translateX(${Math.max(0, xoffset - widthXoffset)}px)`;
    }

    if (xoffset > 0) {
      collapse = true;
      icon.style.transform = 'rotate(180deg)';
      showContainer();
    } else {
      collapse = false;
      icon.style.transform = 'rotate(0)';
    }
  };

  return icon;
}

function makeExpressionListIcons() {
  const expressions = host?.getExpressions() ?? [];
  const icons: HTMLDivElement[] = [];

  for (const exp of expressions) {
    if (!exp || typeof exp.label !== 'string') continue;
    const icon = createCommonIcon(svgIcon.catIcon, exp.label);
    icon.classList.add('expression-item');
    icon.onclick = async () => host?.setExpression(exp.name);
    icons.push(icon);
  }

  return icons;
}

function makeExpressionListCollapseIcon() {
  const icon = createCommonIcon(svgIcon.expressionIcon, '', ['button-item']);
  icon.style.backgroundColor = defaultIconBgColor;
  icon.style.fontSize = '1.05rem';
  icon.style.position = 'relative';

  const iconsWrapper = document.createElement('div');
  iconsWrapper.style.position = 'absolute';
  iconsWrapper.style.top = '0px';
  iconsWrapper.style.flexDirection = 'column';
  iconsWrapper.style.transition = 'all .75s cubic-bezier(0.23, 1, 0.32, 1)';
  iconsWrapper.style.display = 'flex';
  iconsWrapper.style.opacity = '0';

  let currentTranslateY = 0;
  const translateX = (host?.getCanvasPosition() ?? getRuntimeConfig().CanvasPosition) === 'right' ? '75px' : '-75px';
  iconsWrapper.style.transform = `translate(${translateX}, ${currentTranslateY - 50}px)`;

  const refreshIcons = () => {
    while (iconsWrapper.firstChild) iconsWrapper.removeChild(iconsWrapper.firstChild);
    for (const expIcon of makeExpressionListIcons()) iconsWrapper.appendChild(expIcon);
  };

  icon.addEventListener('mouseenter', () => {
    icon.style.backgroundColor = defaultHoverColor;
    refreshIcons();
    iconsWrapper.style.visibility = 'visible';
    iconsWrapper.style.opacity = '1';
    iconsWrapper.style.transform = `translate(${translateX}, ${currentTranslateY}px)`;
  });

  icon.addEventListener('mouseleave', () => {
    icon.style.backgroundColor = defaultIconBgColor;
    iconsWrapper.style.opacity = '0';
    iconsWrapper.style.transform = `translate(${translateX}, ${currentTranslateY - 50}px)`;
    iconsWrapper.style.visibility = 'hidden';
  });

  iconsWrapper.addEventListener('wheel', (e) => {
    const currentTransform = getComputedStyle(iconsWrapper).transform;
    const matrix = new WebKitCSSMatrix(currentTransform);
    let translateY = matrix.m42;
    translateY += e.deltaY > 0 ? -50 : 50;
    currentTranslateY = translateY;
    const tx = (host?.getCanvasPosition() ?? getRuntimeConfig().CanvasPosition) === 'right' ? '75px' : '-75px';
    iconsWrapper.style.transform = `translate(${tx}, ${translateY}px)`;
    e.preventDefault();
  });

  icon.appendChild(iconsWrapper);
  return icon;
}

function makeRefreshCacheIcon() {
  const icon = createCommonIcon(svgIcon.reloadIcon, '', ['button-item']);
  icon.style.backgroundColor = defaultIconBgColor;
  icon.style.fontSize = '1.05rem';

  icon.addEventListener('mouseenter', () => {
    icon.style.backgroundColor = defaultHoverColor;
  });
  icon.addEventListener('mouseleave', () => {
    icon.style.backgroundColor = defaultIconBgColor;
  });

  icon.onclick = async () => {
    CacheFetchSetting.refreshCache = true;
    host?.setRefreshCache(true);
    await host?.reloadModel();
  };

  return icon;
}

function makeStarIcon() {
  const icon = createCommonIcon(svgIcon.starIcon, '', ['button-item']);
  icon.style.backgroundColor = defaultIconBgColor;
  icon.style.fontSize = '1.05rem';

  icon.addEventListener('mouseenter', () => {
    icon.style.backgroundColor = defaultHoverColor;
  });
  icon.addEventListener('mouseleave', () => {
    icon.style.backgroundColor = defaultIconBgColor;
  });

  icon.onclick = async () => {
    window.open('https://github.com/LSTM-Kirigaya/Live2dRender', '_blank');
  };

  return icon;
}

function makeVoiceIcon() {
  const iconSvg = isVoiceEnabled() ? svgIcon.volumeOnIcon : svgIcon.volumeOffIcon;
  const icon = createCommonIcon(iconSvg, '', ['button-item']);
  icon.style.backgroundColor = defaultIconBgColor;
  icon.style.fontSize = '1.05rem';

  icon.addEventListener('mouseenter', () => {
    icon.style.backgroundColor = defaultHoverColor;
  });
  icon.addEventListener('mouseleave', () => {
    icon.style.backgroundColor = defaultIconBgColor;
  });

  icon.onclick = async () => {
    const next = !isVoiceEnabled();
    setVoiceEnabled(next);
    if (next) await unlockVoice();
    const span = icon.querySelector('span');
    if (span) span.innerHTML = next ? svgIcon.volumeOnIcon : svgIcon.volumeOffIcon;
  };

  return icon;
}

function makeMotionListCollapseIcon() {
  const icon = createCommonIcon(svgIcon.motionIcon, '', ['button-item']);
  icon.style.backgroundColor = defaultIconBgColor;
  icon.style.fontSize = '1.05rem';
  icon.style.position = 'relative';

  const iconsWrapper = document.createElement('div');
  iconsWrapper.style.position = 'absolute';
  iconsWrapper.style.top = '0px';
  iconsWrapper.style.flexDirection = 'column';
  iconsWrapper.style.transition = 'all .75s cubic-bezier(0.23, 1, 0.32, 1)';
  iconsWrapper.style.display = 'flex';
  iconsWrapper.style.opacity = '0';
  iconsWrapper.style.visibility = 'hidden';

  let currentTranslateY = 0;
  const translateX = (host?.getCanvasPosition() ?? getRuntimeConfig().CanvasPosition) === 'right' ? '75px' : '-75px';
  iconsWrapper.style.transform = `translate(${translateX}, ${currentTranslateY - 50}px)`;

  icon.addEventListener('mouseenter', () => {
    icon.style.backgroundColor = defaultHoverColor;
  });
  icon.addEventListener('mouseleave', () => {
    icon.style.backgroundColor = defaultIconBgColor;
  });

  const refreshIcons = () => {
    while (iconsWrapper.firstChild) iconsWrapper.removeChild(iconsWrapper.firstChild);
    const motions = host?.getMotions() ?? [];
    for (const m of motions) {
      if (!m) continue;
      const label = `${m.group}: ${m.label}`;
      const el = createCommonIcon(svgIcon.motionIcon, label);
      el.classList.add('expression-item');
      el.onclick = async () => host?.playMotion(m.group, m.index);
      iconsWrapper.appendChild(el);
    }
  };

  icon.addEventListener('mouseenter', () => {
    refreshIcons();
    iconsWrapper.style.visibility = 'visible';
    iconsWrapper.style.opacity = '1';
    iconsWrapper.style.transform = `translate(${translateX}, ${currentTranslateY}px)`;
  });

  icon.addEventListener('mouseleave', () => {
    iconsWrapper.style.opacity = '0';
    iconsWrapper.style.transform = `translate(${translateX}, ${currentTranslateY - 50}px)`;
    iconsWrapper.style.visibility = 'hidden';
  });

  iconsWrapper.addEventListener('wheel', (e) => {
    const currentTransform = getComputedStyle(iconsWrapper).transform;
    const matrix = new WebKitCSSMatrix(currentTransform);
    let translateY = matrix.m42;
    translateY += e.deltaY > 0 ? -50 : 50;
    currentTranslateY = translateY;
    const tx = (host?.getCanvasPosition() ?? getRuntimeConfig().CanvasPosition) === 'right' ? '75px' : '-75px';
    iconsWrapper.style.transform = `translate(${tx}, ${translateY}px)`;
    e.preventDefault();
  });

  icon.appendChild(iconsWrapper);
  return icon;
}

function makeBoxItemContainer() {
  const containerEl = document.createElement('div');
  containerEl.style.display = 'flex';
  containerEl.style.alignItems = 'center';
  containerEl.style.justifyContent = 'center';
  containerEl.style.flexDirection = 'column';

  const canvas = host?.getCanvas() ?? getRuntimeConfig().Canvas;
  if (!canvas) return containerEl;

  const canvasZIndex = parseInt(canvas.style.zIndex);
  containerEl.style.zIndex = (Number.isFinite(canvasZIndex) ? canvasZIndex + 1 : 100000).toString();
  containerEl.style.opacity = '0';
  containerEl.style.transition = '.7s cubic-bezier(0.23, 1, 0.32, 1)';
  containerEl.style.position = 'fixed';

  const pos = host?.getCanvasPosition() ?? getRuntimeConfig().CanvasPosition;
  const rect = canvas.getBoundingClientRect();
  containerEl.style.top = Math.max(0, rect.top + rect.height * 0.5 - defaultIconSize * 1.5) + 'px';
  if (pos === 'left') {
    containerEl.style.left = Math.max(0, rect.left + rect.width - widthXoffset) + 'px';
  } else {
    containerEl.style.left = Math.max(0, rect.left) + 'px';
  }

  containerEl.appendChild(makeLive2dCollapseIcon(containerEl));
  containerEl.appendChild(makeExpressionListCollapseIcon());
  containerEl.appendChild(makeRefreshCacheIcon());
  containerEl.appendChild(makeMotionListCollapseIcon());
  containerEl.appendChild(makeVoiceIcon());
  containerEl.appendChild(makeStarIcon());

  document.body.appendChild(containerEl);
  return containerEl;
}

export function reloadToolBox() {
  if (!container) return;
  hideContainer();
  document.body.removeChild(container);
  container = makeBoxItemContainer();
  showContainer();

  container.onmouseenter = async () => showContainer();
  container.onmouseleave = async () => hideContainer();
}

export function addToolBox() {
  addCssClass();
  container = makeBoxItemContainer();
  hideContainer();
  container.onmouseenter = async () => showContainer();
  container.onmouseleave = async () => hideContainer();

  const canvas = host?.getCanvas() ?? getRuntimeConfig().Canvas;
  if (canvas) {
    canvas.onmouseenter = async () => showContainer();
    canvas.onmouseleave = async () => hideContainer();
    if (!resizeObserver) {
      resizeObserver = new ResizeObserver(() => {
        if (pendingRelayout) return;
        pendingRelayout = true;
        requestAnimationFrame(() => {
          pendingRelayout = false;
          reloadToolBox();
        });
      });
    }
    if (resizeObservedCanvas !== canvas) {
      if (resizeObservedCanvas) resizeObserver.unobserve(resizeObservedCanvas);
      resizeObservedCanvas = canvas;
      resizeObserver.observe(canvas);
    }
  }
}
