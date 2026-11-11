// Soft synthesized cues, so the app ships no audio files.
import { state } from './store.js';

let ctx: AudioContext | null = null;

function tone(freq: number, start: number, dur: number, gain = 0.06): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.05);
}

export function cue(kind: 'select' | 'dwell' | 'answer' | 'land' | 'done'): void {
  if (!state.settings.sound) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    return;
  }
  if (kind === 'select') tone(660, 0, 0.12);
  else if (kind === 'dwell') tone(880, 0, 0.16);
  else if (kind === 'answer') {
    tone(523, 0, 0.18);
    tone(784, 0.09, 0.22);
  } else if (kind === 'land') {
    tone(392, 0, 0.25, 0.04);
    tone(523, 0.12, 0.25, 0.04);
    tone(659, 0.24, 0.35, 0.04);
  } else if (kind === 'done') {
    tone(659, 0, 0.18);
    tone(988, 0.12, 0.3);
  }
}
