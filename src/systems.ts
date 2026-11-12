// Input routing (pinch, poke, head-gaze dwell) and the frame-time meter.
import {
  createSystem,
  DoubleSide,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Pressed,
  Raycaster,
  RingGeometry,
  Vector3,
} from '@iwsdk/core';
import { MdTarget } from './components.js';

export type Via = 'pinch' | 'dwell' | 'voice' | 'card' | 'auto';
type Handler = (id: string, via: Via) => void;

/** One action path for every input. */
export const bus = {
  handler: null as Handler | null,
  fire(id: string, via: Via) {
    this.handler?.(id, via);
  },
};

/** What the user is looking at right now (head gaze), shared with the agent. */
export const gaze = { current: '', lastBar: '' };

export class InteractionSystem extends createSystem({
  pressed: { required: [MdTarget, Pressed] },
  hovered: { required: [MdTarget, Hovered] },
}) {
  init(): void {
    this.queries.pressed.subscribe('qualify', (e) => bus.fire(e.getValue(MdTarget, 'id') as string, 'pinch'));
    this.queries.hovered.subscribe('qualify', (e) => setHighlight(e.object3D, true));
    this.queries.hovered.subscribe('disqualify', (e) => setHighlight(e.object3D, false));
  }
}

function setHighlight(obj: Object3D | null | undefined, on: boolean): void {
  const mat = (obj as Mesh | null)?.material as MeshBasicMaterial | undefined;
  if (mat?.color) mat.color.setScalar(on ? 1.25 : 1);
}

export const DWELL_SECONDS = 1.4;
/** Card buttons and task ticks ask for a longer hold, so a passing glance never changes anything. */
export const CARD_DWELL_SECONDS = 2.0;
const isCard = (id: string) => id.startsWith('ask:') || id.startsWith('set:') || id.startsWith('task:') || id === 'mic';
const RING_SEGMENTS = 64;

export class DwellSystem extends createSystem({
  targets: { required: [MdTarget] },
}) {
  private ray = new Raycaster();
  private origin = new Vector3();
  private dir = new Vector3();
  private hits: Object3D[] = [];
  private found: import('@iwsdk/core').Intersection[] = [];
  private meshes: Object3D[] = [];
  private ring!: Mesh;
  private track!: Mesh;
  private targetId = '';
  private held = 0;
  private fired = false;

  init(): void {
    const ringGeo = new RingGeometry(0.014, 0.021, RING_SEGMENTS, 1, Math.PI / 2, -Math.PI * 2);
    this.ring = new Mesh(ringGeo, new MeshBasicMaterial({ color: 0xffb547, side: DoubleSide, depthTest: false, transparent: true }));
    this.track = new Mesh(
      new RingGeometry(0.014, 0.021, RING_SEGMENTS, 1, 0, Math.PI * 2),
      new MeshBasicMaterial({ color: 0xffffff, opacity: 0.35, transparent: true, side: DoubleSide, depthTest: false }),
    );
    this.ring.renderOrder = 1001;
    this.track.renderOrder = 1000;
    this.world.createTransformEntity(this.track);
    this.world.createTransformEntity(this.ring);
    this.ring.visible = this.track.visible = false;
    this.ray.far = 4;
  }

  update(delta: number): void {
    const t0 = performance.now();
    this.step(delta);
    perf.pending += performance.now() - t0;
  }

  private step(delta: number): void {
    const head = this.player.head;
    head.getWorldPosition(this.origin);
    head.getWorldDirection(this.dir).negate();
    this.ray.set(this.origin, this.dir);

    this.meshes.length = 0;
    for (const e of this.queries.targets.entities) {
      const o = e.object3D;
      if (o && o.visible && e.getValue(MdTarget, 'dwell') && isShown(o)) this.meshes.push(o);
    }
    this.hits.length = 0;
    const hit = this.ray.intersectObjects(this.meshes, false, this.found)[0];
    this.found.length = 0;
    let id = '';
    if (hit) {
      for (const e of this.queries.targets.entities) if (e.object3D === hit.object) id = e.getValue(MdTarget, 'id') as string;
    }
    gaze.current = id;
    if (id.startsWith('bar:')) gaze.lastBar = id;

    if (id !== this.targetId) {
      this.targetId = id;
      this.held = 0;
      this.fired = false;
    } else if (id && !this.fired) {
      this.held += delta;
      if (this.held >= (isCard(id) ? CARD_DWELL_SECONDS : DWELL_SECONDS)) {
        this.fired = true;
        bus.fire(id, 'dwell');
      }
    }

    const show = !!hit && !!id && !this.fired && this.held > 0.15;
    this.ring.visible = this.track.visible = show;
    if (show && hit) {
      const p = hit.point.addScaledVector(this.dir, -0.01);
      this.ring.position.copy(p);
      this.track.position.copy(p);
      this.ring.lookAt(this.origin);
      this.track.lookAt(this.origin);
      const need = isCard(id) ? CARD_DWELL_SECONDS : DWELL_SECONDS;
      const frac = Math.min(1, (this.held - 0.15) / (need - 0.15));
      this.ring.geometry.setDrawRange(0, Math.ceil(frac * RING_SEGMENTS) * 6);
    }
  }
}

function isShown(o: Object3D): boolean {
  let n: Object3D | null = o;
  while (n) {
    if (!n.visible) return false;
    n = n.parent;
  }
  return true;
}

/** Rolling frame-time log for the overlay and for measurement. */
export const perf = {
  frames: new Float32Array(1200),
  work: new Float32Array(1200),
  count: 0,
  head: 0,
  /** Milliseconds Morning Desk's own systems spent in the current frame. */
  pending: 0,
  push(ms: number) {
    this.frames[this.head] = ms;
    this.work[this.head] = this.pending;
    this.pending = 0;
    this.head = (this.head + 1) % this.frames.length;
    this.count = Math.min(this.count + 1, this.frames.length);
  },
  reset() {
    this.count = 0;
    this.head = 0;
  },
  /** fps median, fps at the 1% low (99th percentile frame time), frames counted. */
  stats(): { median: number; low1: number; frames: number; p99ms: number; workMedianMs: number; workP99Ms: number } {
    const n = this.count;
    if (n < 10) return { median: 0, low1: 0, frames: n, p99ms: 0, workMedianMs: 0, workP99Ms: 0 };
    const arr = Array.from(this.frames.subarray(0, n)).sort((a, b) => a - b);
    const work = Array.from(this.work.subarray(0, n)).sort((a, b) => a - b);
    const med = arr[Math.floor(n / 2)];
    const p99 = arr[Math.min(n - 1, Math.floor(n * 0.99))];
    return {
      median: 1000 / med,
      low1: 1000 / p99,
      frames: n,
      p99ms: p99,
      workMedianMs: work[Math.floor(n / 2)],
      workP99Ms: work[Math.min(n - 1, Math.floor(n * 0.99))],
    };
  },
};

export class FrameMeterSystem extends createSystem({}) {
  private last = 0;
  update(): void {
    const now = performance.now();
    if (this.last) perf.push(now - this.last);
    this.last = now;
  }
}
