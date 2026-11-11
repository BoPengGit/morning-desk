// Canvas-drawn panels. Each panel is a plane mesh whose texture is a 2D canvas,
// redrawn only when its content or the theme changes, never per frame.
import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from '@iwsdk/core';
import { state } from './store.js';

export interface Palette {
  bg: string;
  bgAlpha: number;
  card: string;
  text: string;
  muted: string;
  accent: string;
  up: string;
  down: string;
  border: string;
  borderWidth: number;
}

const NORMAL: Palette = {
  bg: '#101b2d',
  bgAlpha: 0.9,
  card: '#1b2a42',
  text: '#f2f6fb',
  muted: '#a7b6cc',
  accent: '#ffb547',
  up: '#45d6a8',
  down: '#ff7d6e',
  border: '#ffffff33',
  borderWidth: 2,
};

const HIGH_CONTRAST: Palette = {
  bg: '#000000',
  bgAlpha: 1,
  card: '#000000',
  text: '#ffffff',
  muted: '#ffffff',
  accent: '#ffd400',
  up: '#00ff9c',
  down: '#ff6b6b',
  border: '#ffffff',
  borderWidth: 6,
};

export function palette(): Palette {
  return state.settings.highContrast ? HIGH_CONTRAST : NORMAL;
}

export const FONT = '"Inter", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

export function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Draws wrapped text and returns the y below the last line. */
export function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number, maxLines = 99): number {
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (g.measureText(test).width > maxW && line) {
      lines += 1;
      if (lines === maxLines) {
        g.fillText(`${line}…`, x, y);
        return y + lineH;
      }
      g.fillText(line, x, y);
      y += lineH;
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) {
    g.fillText(line, x, y);
    y += lineH;
  }
  return y;
}

export class CanvasPanel {
  readonly canvas: HTMLCanvasElement;
  readonly g: CanvasRenderingContext2D;
  readonly texture: CanvasTexture;
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;

  constructor(
    readonly widthM: number,
    readonly heightM: number,
    pxPerM = 1400,
    curved = 0,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(widthM * pxPerM);
    this.canvas.height = Math.round(heightM * pxPerM);
    this.g = this.canvas.getContext('2d')!;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new MeshBasicMaterial({ map: this.texture, transparent: true, side: DoubleSide, depthWrite: false });
    let geometry;
    if (curved > 0) {
      // A cylinder slice of radius `curved`, centred on the viewer, inner face visible.
      const theta = widthM / curved;
      geometry = new CylinderGeometry(curved, curved, heightM, 48, 1, true, Math.PI - theta / 2, theta);
      geometry.scale(-1, 1, 1);
      geometry.translate(0, 0, curved);
    } else {
      geometry = new PlaneGeometry(widthM, heightM);
    }
    this.mesh = new Mesh(geometry, this.material);
  }

  /** Clears and paints the panel background, then hands the context to `paint`. */
  draw(paint: (g: CanvasRenderingContext2D, w: number, h: number, p: Palette) => void, background = true): void {
    const { g, canvas } = this;
    const p = palette();
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (background) {
      const r = Math.min(canvas.width, canvas.height) * 0.06;
      roundRect(g, 2, 2, canvas.width - 4, canvas.height - 4, r);
      g.fillStyle = hexAlpha(p.bg, p.bgAlpha);
      g.fill();
      g.lineWidth = p.borderWidth;
      g.strokeStyle = p.border;
      g.stroke();
    }
    g.textBaseline = 'top';
    paint(g, canvas.width, canvas.height, p);
    this.texture.needsUpdate = true;
  }
}
