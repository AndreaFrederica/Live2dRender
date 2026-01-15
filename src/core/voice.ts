import { getRuntimeConfig, setRuntimeConfig } from './config';

let audioContext: AudioContext | null = null;
let gainNode: GainNode | null = null;
let currentSource: AudioBufferSourceNode | null = null;

function getAudioContext() {
  if (audioContext) return audioContext;
  const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
  if (!Ctx) return null;
  audioContext = new Ctx();
  gainNode = audioContext.createGain();
  gainNode.gain.value = 1;
  gainNode.connect(audioContext.destination);
  return audioContext;
}

export function isVoiceEnabled() {
  return Boolean(getRuntimeConfig().EnableVoice);
}

export function setVoiceEnabled(enabled: boolean) {
  setRuntimeConfig({ EnableVoice: Boolean(enabled) });
  if (!getRuntimeConfig().EnableVoice) {
    stopVoice();
  }
}

export async function unlockVoice() {
  if (!isVoiceEnabled()) return false;
  const ctx = getAudioContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  return ctx.state === 'running';
}

export function stopVoice() {
  if (!currentSource) return;
  try {
    currentSource.stop();
  } catch {}
  try {
    currentSource.disconnect();
  } catch {}
  currentSource = null;
}

export async function playVoiceFromUrl(url: string) {
  if (!isVoiceEnabled()) return false;
  const ctx = getAudioContext();
  if (!ctx) return false;
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
  if (ctx.state !== 'running') return false;

  const resp = await fetch(url);
  if (!resp.ok) return false;
  const buf = await resp.arrayBuffer();
  const audioBuffer = await ctx.decodeAudioData(buf.slice(0));

  stopVoice();
  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(gainNode ?? ctx.destination);
  source.onended = () => {
    if (currentSource === source) currentSource = null;
  };
  currentSource = source;
  source.start();
  return true;
}

