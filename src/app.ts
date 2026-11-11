// Morning Desk: the brief, its panels, the agent's actions and first-launch teaching.
import {
  createSystem,
  Entity,
  Grabbed,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OneHandGrabbable,
  PlaneGeometry,
  PokeInteractable,
  Quaternion,
  RayInteractable,
  TwoHandsGrabbable,
  Vector3,
  VisibilityState,
  World,
  XRAnchor,
  XRMesh,
  XRPlane,
} from '@iwsdk/core';
import { Action, CARD_QUESTIONS, parse } from './agent.js';
import { MdPanel, MdTarget } from './components.js';
import { Brief, categorySeries, Day, money, movers, Series, shortCat, shortDate, topCategories } from './data.js';
import { computeLayout, Detected, Frame, offsetIn, placeIn, RoomLayout } from './layout.js';
import { cue } from './sound.js';
import { localDay, recordVisit, save, state, streak, Visit } from './store.js';
import { bus, gaze, perf, Via } from './systems.js';
import { CanvasPanel, hexAlpha, palette, roundRect, wrap } from './ui.js';

const BARS = 20;
const CHART_W = 1.3;
const CHART_H = 0.75;
const CURVE_R = 1.2;
const CURVE_W = 1.1;
/** Essential UI stays within this many degrees of where the head points; past it the cards follow. */
export const FOV_CONE_DEG = 30;

type TileKey = 'deposits' | 'withdrawals' | 'balance';
const TILE_LABEL: Record<TileKey, string> = {
  deposits: 'Deposits today',
  withdrawals: 'Withdrawals today',
  balance: 'Cash balance',
};

interface ChartView {
  series: Series;
  side: 'net' | 'deposits' | 'withdrawals';
  pattern: RegExp | null;
  compare: boolean;
}

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();

function setWorldPose(obj: Object3D, pos: Vector3, quat: Quaternion): void {
  const parent = obj.parent;
  _s.copy(obj.scale);
  _m.compose(pos, quat, _s);
  if (parent) {
    parent.updateWorldMatrix(true, false);
    _m.premultiply(new Matrix4().copy(parent.matrixWorld).invert());
  }
  _m.decompose(obj.position, obj.quaternion, _s);
}

export class MorningDesk {
  brief!: Brief;
  view!: ChartView;
  selected = -1;
  lastAnswer = '';
  lastAction = '';
  lastVisit: Visit | undefined;
  layout: RoomLayout | null = null;
  sessionStart = 0;
  laidAt = 0;
  landT = 0;
  onboardStep = 0;
  openTile: TileKey | null = null;
  captionUntil = 0;
  fpsVisible = false;
  speech: { start(): void } | null = null;

  root!: Entity;
  tiles = new Map<TileKey, { panel: CanvasPanel; entity: Entity }>();
  clock!: { panel: CanvasPanel; entity: Entity };
  detail!: { panel: CanvasPanel; entity: Entity };
  chartRoot!: Entity;
  chartFlat!: CanvasPanel;
  chartCurved!: Mesh;
  bars: Entity[] = [];
  answer!: CanvasPanel;
  notes: { panel: CanvasPanel; entity: Entity; id: string }[] = [];
  extras: { panel: CanvasPanel; entity: Entity; series: Series; label: string }[] = [];
  tasks!: { panel: CanvasPanel; entity: Entity; rows: Entity[] };
  near!: Entity;
  question!: CanvasPanel;
  qButtons: Entity[] = [];
  mic!: Entity;
  settings!: CanvasPanel;
  questionEntity!: Entity;
  settingsEntity!: Entity;
  sButtons: Entity[] = [];
  coach!: CanvasPanel;
  fps!: CanvasPanel;
  caption!: { panel: CanvasPanel; entity: Entity };
  nearYaw = 0;

  constructor(readonly world: World) {}

  // ---------- building ----------

  private entity(obj: Object3D, parent?: Entity): Entity {
    return this.world.createTransformEntity(obj, parent ? { parent } : undefined);
  }

  private target(obj: Object3D, id: string, parent?: Entity, dwell = true, poke = true): Entity {
    const e = this.entity(obj, parent);
    e.addComponent(RayInteractable);
    if (poke) e.addComponent(PokeInteractable);
    e.addComponent(MdTarget, { id, dwell });
    return e;
  }

  private hitbox(w: number, h: number): Mesh {
    const m = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    return m;
  }

  build(brief: Brief): void {
    this.brief = brief;
    const days = brief.days;
    this.view = brief.custom
      ? { series: brief.custom, side: 'net', pattern: null, compare: false }
      : { series: this.netSeries(), side: 'net', pattern: null, compare: false };
    const latest = days[days.length - 1];
    this.lastVisit = recordVisit({
      day: localDay(),
      dataDate: latest.date,
      deposits: latest.deposits,
      withdrawals: latest.withdrawals,
      balance: latest.balance,
    });

    this.root = this.entity(new Group());

    for (const key of ['deposits', 'withdrawals', 'balance'] as TileKey[]) {
      const panel = new CanvasPanel(0.19, 0.13, 2600);
      const entity = this.target(panel.mesh, `tile:${key}`, this.root);
      this.tiles.set(key, { panel, entity });
    }
    const clockPanel = new CanvasPanel(0.13, 0.13, 2600);
    this.clock = { panel: clockPanel, entity: this.target(clockPanel.mesh, 'clock', this.root) };
    const detailPanel = new CanvasPanel(0.42, 0.3, 2200);
    this.detail = { panel: detailPanel, entity: this.entity(detailPanel.mesh, this.root) };
    detailPanel.mesh.visible = false;

    // Chart: one group holding a flat and a curved face that share one texture.
    const chartGroup = new Group();
    this.chartRoot = this.entity(chartGroup, this.root);
    this.chartRoot.addComponent(MdPanel, { key: 'chart' });
    this.chartFlat = new CanvasPanel(CHART_W, CHART_H, 1400);
    this.entity(this.chartFlat.mesh, this.chartRoot);
    const curvedFace = new CanvasPanel(CURVE_W, CURVE_W * (CHART_H / CHART_W), 10, CURVE_R);
    this.chartCurved = new Mesh(curvedFace.mesh.geometry, this.chartFlat.material);
    this.entity(this.chartCurved, this.chartRoot);
    this.chartCurved.visible = false;
    for (let i = 0; i < BARS; i++) {
      this.bars.push(this.target(this.hitbox(0.05, 0.5), `bar:${i}`, this.chartRoot, true, false));
    }
    this.answer = new CanvasPanel(1.0, 0.17, 1600);
    this.entity(this.answer.mesh, this.chartRoot);
    this.answer.mesh.visible = false;
    for (const n of state.notes) this.addNoteEntity(n.id);

    const tasksPanel = new CanvasPanel(0.6, 0.62, 1500);
    const tasksEntity = this.entity(tasksPanel.mesh, this.root);
    tasksEntity.addComponent(MdPanel, { key: 'tasks' });
    const rows: Entity[] = [];
    for (let i = 0; i < 5; i++) {
      const row = this.target(this.hitbox(0.54, 0.07), `task:${i}`, tasksEntity, true, true);
      (row.object3D as Object3D).position.set(0, 0.155 - i * 0.082, 0.004);
      rows.push(row);
    }
    this.tasks = { panel: tasksPanel, entity: tasksEntity, rows };

    // Near field: the question card, settings and coach card, kept inside the view cone.
    this.near = this.entity(new Group(), this.root);
    this.question = new CanvasPanel(0.4, 0.36, 2000);
    const qe = this.entity(this.question.mesh, this.root);
    this.questionEntity = qe;
    CARD_QUESTIONS.forEach((_, i) => {
      const b = this.target(this.hitbox(0.36, 0.05), `ask:${i}`, qe);
      (b.object3D as Object3D).position.set(0, 0.105 - i * 0.056, 0.003);
      this.qButtons.push(b);
    });
    this.mic = this.target(this.hitbox(0.36, 0.045), 'mic', qe);
    (this.mic.object3D as Object3D).position.set(0, -0.152, 0.003);
    this.settings = new CanvasPanel(0.2, 0.36, 2000);
    const se = this.entity(this.settings.mesh, this.root);
    this.settingsEntity = se;
    ['set:hc', 'set:cap', 'set:one', 'set:sound', 'set:relayout'].forEach((id, i) => {
      const b = this.target(this.hitbox(0.18, 0.052), id, se);
      (b.object3D as Object3D).position.set(0, 0.098 - i * 0.06, 0.003);
      this.sButtons.push(b);
    });
    this.coach = new CanvasPanel(0.62, 0.11, 2000);
    const ce = this.entity(this.coach.mesh, this.near);
    (ce.object3D as Object3D).position.set(0, 0, 0);
    this.fps = new CanvasPanel(0.2, 0.13, 2000);
    const fe = this.entity(this.fps.mesh, this.near);
    (fe.object3D as Object3D).position.set(0.43, 0, 0);
    this.fps.mesh.visible = false;

    const capPanel = new CanvasPanel(0.7, 0.09, 1800);
    capPanel.mesh.renderOrder = 999;
    capPanel.material.depthTest = false;
    this.caption = { panel: capPanel, entity: this.entity(capPanel.mesh) };
    capPanel.mesh.visible = false;

    this.applyGrab();
    this.setupSpeech();
    this.redrawAll();
    this.root.object3D!.visible = false;
    this.onboardStep = state.onboarded ? 3 : 0;
    bus.handler = (id, via) => this.onInput(id, via);
  }

  private addNoteEntity(id: string): void {
    const panel = new CanvasPanel(0.4, 0.15, 1600);
    const entity = this.target(panel.mesh, `note:${id}`, this.chartRoot, false, true);
    this.notes.push({ panel, entity, id });
  }

  private applyGrab(): void {
    for (const e of [this.chartRoot, this.tasks.entity]) {
      if (e.hasComponent(OneHandGrabbable)) e.removeComponent(OneHandGrabbable);
      if (e.hasComponent(TwoHandsGrabbable)) e.removeComponent(TwoHandsGrabbable);
      if (state.settings.oneHanded) e.addComponent(OneHandGrabbable, { rotate: true, translate: true });
      else e.addComponent(TwoHandsGrabbable, { rotate: true, translate: true, scale: true, scaleMin: [0.5, 0.5, 0.5], scaleMax: [2, 2, 2] });
    }
  }

  private setupSpeech(): void {
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void;
      onerror: (e: { error: string }) => void;
      start(): void;
    }) | undefined;
    if (!Ctor) {
      this.mic.object3D!.visible = false;
      return;
    }
    this.speech = {
      start: () => {
        const r = new Ctor();
        r.lang = 'en-US';
        r.interimResults = false;
        r.maxAlternatives = 1;
        r.onresult = (e) => this.ask(e.results[0][0].transcript, 'voice');
        r.onerror = () => this.say('I could not hear that. The question card works the same way.');
        r.start();
      },
    };
  }

  // ---------- data views ----------

  netSeries(): Series {
    const d = this.brief.days;
    return { id: 'net', label: 'Net cash flow', values: d.map((x) => x.net), dates: d.map((x) => x.date) };
  }

  private window(): { start: number; values: number[]; dates: string[] } {
    const s = this.view.series;
    const start = Math.max(0, s.values.length - BARS);
    return { start, values: s.values.slice(start), dates: s.dates.slice(start) };
  }

  private dayByDate(date: string): Day | undefined {
    return this.brief.days.find((d) => d.date === date);
  }

  // ---------- drawing ----------

  redrawAll(): void {
    for (const k of this.tiles.keys()) this.drawTile(k);
    this.drawClock();
    this.drawChart();
    this.drawTasks();
    this.drawQuestion();
    this.drawSettings();
    this.drawCoach();
    this.drawNotes();
    if (this.openTile) this.drawDetail(this.openTile);
    if (this.lastAnswer) this.drawAnswer();
    for (const x of this.extras) this.drawExtra(x);
  }

  private drawTile(key: TileKey): void {
    const days = this.brief.days;
    const cur = days[days.length - 1];
    const prev = days[days.length - 2];
    const val = (d: Day) => (key === 'balance' ? (d.balance ?? 0) : d[key]);
    const delta = val(cur) - val(prev);
    const since = this.lastVisit && this.lastVisit.dataDate !== cur.date ? val(cur) - (key === 'balance' ? (this.lastVisit.balance ?? 0) : this.lastVisit[key]) : null;
    const open = this.openTile === key;
    this.tiles.get(key)!.panel.draw((g, w, h, p) => {
      if (open) {
        g.lineWidth = 10;
        g.strokeStyle = p.accent;
        roundRect(g, 6, 6, w - 12, h - 12, 26);
        g.stroke();
      }
      g.fillStyle = p.muted;
      g.font = `600 ${h * 0.11}px Inter, Arial, sans-serif`;
      g.fillText(TILE_LABEL[key], w * 0.07, h * 0.09);
      g.fillStyle = p.text;
      g.font = `700 ${h * 0.25}px Inter, Arial, sans-serif`;
      g.fillText(money(val(cur)), w * 0.07, h * 0.26);
      const goodUp = key !== 'withdrawals';
      g.fillStyle = delta === 0 ? p.muted : (delta > 0) === goodUp ? p.up : p.down;
      g.font = `600 ${h * 0.1}px Inter, Arial, sans-serif`;
      g.fillText(`${delta >= 0 ? '▲' : '▼'} ${money(delta, true)} vs ${shortDate(prev.date)}`, w * 0.07, h * 0.58);
      g.fillStyle = p.muted;
      g.font = `500 ${h * 0.085}px Inter, Arial, sans-serif`;
      const line = since !== null ? `Since your last visit: ${money(since, true)}` : `${shortDate(cur.date)} · pinch to open`;
      g.fillText(line, w * 0.07, h * 0.78);
    });
  }

  private drawClock(): void {
    const now = new Date();
    this.clock.panel.draw((g, w, h, p) => {
      g.textAlign = 'center';
      g.fillStyle = p.text;
      g.font = `700 ${h * 0.24}px Inter, Arial, sans-serif`;
      g.fillText(now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), w / 2, h * 0.16);
      g.fillStyle = p.accent;
      g.font = `600 ${h * 0.11}px Inter, Arial, sans-serif`;
      const n = streak();
      g.fillText(`${n} morning${n === 1 ? '' : 's'} in a row`, w / 2, h * 0.5);
      g.fillStyle = p.muted;
      g.font = `500 ${h * 0.085}px Inter, Arial, sans-serif`;
      g.fillText(this.fpsVisible ? 'pinch: hide frame time' : 'pinch: frame time', w / 2, h * 0.72);
      g.textAlign = 'left';
    });
  }

  private drawDetail(key: TileKey): void {
    const days = this.brief.days;
    const cur = days[days.length - 1];
    const prev = days[days.length - 2];
    this.detail.panel.draw((g, w, h, p) => {
      g.fillStyle = p.text;
      g.font = `700 ${h * 0.085}px Inter, Arial, sans-serif`;
      g.fillText(`${TILE_LABEL[key]}, ${shortDate(cur.date)}`, w * 0.05, h * 0.06);
      g.font = `500 ${h * 0.062}px Inter, Arial, sans-serif`;
      if (key === 'balance') {
        g.fillStyle = p.muted;
        wrap(g, `Closing balance of the Treasury General Account: ${money(cur.balance ?? 0)}, ${money((cur.balance ?? 0) - (prev.balance ?? 0), true)} from ${shortDate(prev.date)}. Deposits ${money(cur.deposits)} minus withdrawals ${money(cur.withdrawals)} moved it.`, w * 0.05, h * 0.22, w * 0.9, h * 0.09);
        return;
      }
      const top = topCategories(cur, key, 5);
      const prevMap = key === 'deposits' ? prev.dep : prev.wd;
      top.forEach(([cat, v], i) => {
        const y = h * (0.22 + i * 0.14);
        const d = v - (prevMap.get(cat) ?? 0);
        g.fillStyle = p.text;
        g.fillText(shortCat(cat), w * 0.05, y);
        g.textAlign = 'right';
        g.fillText(money(v), w * 0.74, y);
        g.fillStyle = d === 0 ? p.muted : (d > 0) === (key === 'deposits') ? p.up : p.down;
        g.fillText(money(d, true), w * 0.95, y);
        g.textAlign = 'left';
      });
    });
  }

  private drawChart(): void {
    const { values, dates, start } = this.window();
    const v = this.view;
    const sel = this.selected - start;
    const prevWeek = v.compare ? this.view.series.values.slice(Math.max(0, start - 5), start + values.length - 5) : [];
    this.chartFlat.draw((g, w, h, p) => {
      const padL = w * 0.07;
      const padR = w * 0.03;
      const top = h * 0.2;
      const bottom = h * 0.86;
      g.fillStyle = p.text;
      g.font = `700 ${h * 0.065}px Inter, Arial, sans-serif`;
      g.fillText(v.series.label || 'Series', padL, h * 0.05);
      g.fillStyle = p.muted;
      g.font = `500 ${h * 0.04}px Inter, Arial, sans-serif`;
      const src = this.brief.source === 'live' ? 'live' : `saved ${shortDate(this.brief.fetchedAt.slice(0, 10))}`;
      const sub = v.series.id === 'custom'
        ? 'Your CSV · last 20 rows'
        : `U.S. Treasury Daily Treasury Statement · ${values.length} business days · ${src}`;
      g.fillText(sub, padL, h * 0.125);
      if (v.compare) {
        g.fillStyle = p.accent;
        g.textAlign = 'right';
        g.fillText('- - same days, one week earlier', w - padR, h * 0.125);
        g.textAlign = 'left';
      }
      const all = values.concat(prevWeek);
      const max = Math.max(1, ...all.map((x) => Math.abs(x)));
      const hasNeg = all.some((x) => x < 0);
      const zeroY = hasNeg ? (top + bottom) / 2 : bottom;
      const scale = (hasNeg ? (bottom - top) / 2 : bottom - top) / max;
      const step = (w - padL - padR) / values.length;
      g.strokeStyle = hexAlpha(p.muted.slice(0, 7), 0.5);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(padL, zeroY);
      g.lineTo(w - padR, zeroY);
      g.stroke();
      values.forEach((val, i) => {
        const x = padL + i * step + step * 0.15;
        const bh = val * scale;
        g.fillStyle = i === sel ? p.accent : val >= 0 ? p.up : p.down;
        g.globalAlpha = sel >= 0 && i !== sel ? 0.55 : 1;
        g.fillRect(x, zeroY - Math.max(0, bh), step * 0.7, Math.abs(bh));
        g.globalAlpha = 1;
        if (i % 4 === 0 || i === values.length - 1 || i === sel) {
          g.fillStyle = i === sel ? p.accent : p.muted;
          g.font = `${i === sel ? 700 : 500} ${h * 0.036}px Inter, Arial, sans-serif`;
          g.textAlign = 'center';
          g.fillText(shortDate(dates[i]), x + step * 0.35, bottom + h * 0.03);
          g.textAlign = 'left';
        }
      });
      if (prevWeek.length) {
        g.setLineDash([18, 12]);
        g.strokeStyle = p.accent;
        g.lineWidth = 5;
        g.beginPath();
        prevWeek.forEach((val, j) => {
          const i = j + (values.length - prevWeek.length);
          const x = padL + i * step + step * 0.5;
          const y = zeroY - val * scale;
          if (j === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.stroke();
        g.setLineDash([]);
      }
      if (sel >= 0 && sel < values.length) {
        const x = padL + sel * step + step * 0.5;
        g.fillStyle = p.accent;
        g.font = `700 ${h * 0.045}px Inter, Arial, sans-serif`;
        g.textAlign = x > w * 0.75 ? 'right' : 'left';
        g.fillText(money(values[sel], true), x, top + h * 0.005);
        g.textAlign = 'left';
      }
    });
    this.placeBars(values.length);
  }

  /** Lines the invisible bar targets up with the drawn bars, flat or curved. */
  private placeBars(n: number): void {
    const curved = this.chartCurved.visible;
    const W = curved ? CURVE_W : CHART_W;
    const H = curved ? CURVE_W * (CHART_H / CHART_W) : CHART_H;
    const plotL = -W / 2 + W * 0.07;
    const plotW = W * 0.9;
    const step = plotW / Math.max(1, n);
    this.bars.forEach((b, i) => {
      const o = b.object3D!;
      o.visible = i < n;
      const u = plotL + step * (i + 0.5);
      o.scale.set((step * 0.9) / 0.05, (H * 0.66) / 0.5, 1);
      if (curved) {
        const a = u / CURVE_R;
        o.position.set(CURVE_R * Math.sin(a), -H * 0.03, CURVE_R * (1 - Math.cos(a)) + 0.004);
        o.rotation.set(0, -a, 0);
      } else {
        o.position.set(u, -H * 0.03, 0.004);
        o.rotation.set(0, 0, 0);
      }
      b.setValue(MdTarget, 'id', `bar:${this.window().start + i}`);
    });
    const ah = curved ? CURVE_W * (CHART_H / CHART_W) : CHART_H;
    this.answer.mesh.position.set(0, -ah / 2 - 0.1, curved ? 0.05 : 0.002);
    this.notes.forEach((n2, i) => {
      n2.entity.object3D!.position.set(-0.43 + (i % 3) * 0.43, ah / 2 + 0.1 + Math.floor(i / 3) * 0.17, curved ? 0.05 : 0.002);
    });
    this.extras.forEach((x, i) => {
      x.entity.object3D!.position.set(-(curved ? CURVE_W : CHART_W) / 2 - 0.27, ah / 2 - 0.14 - i * 0.29, curved ? 0.12 : 0.002);
    });
  }

  private drawAnswer(): void {
    this.answer.mesh.visible = true;
    this.answer.draw((g, w, h, p) => {
      g.fillStyle = p.accent;
      g.font = `700 ${h * 0.15}px Inter, Arial, sans-serif`;
      g.fillText(this.lastAction, w * 0.025, h * 0.08);
      g.fillStyle = p.text;
      g.font = `500 ${h * 0.15}px Inter, Arial, sans-serif`;
      wrap(g, this.lastAnswer, w * 0.025, h * 0.3, w * 0.95, h * 0.19, 4);
    });
  }

  private drawNotes(): void {
    this.notes.forEach((n) => {
      const note = state.notes.find((x) => x.id === n.id);
      if (!note) return;
      n.panel.draw((g, w, h, p) => {
        g.fillStyle = p.accent;
        g.font = `700 ${h * 0.14}px Inter, Arial, sans-serif`;
        g.fillText(`Note · ${shortDate(note.date)}`, w * 0.04, h * 0.08);
        g.fillStyle = p.text;
        g.font = `500 ${h * 0.12}px Inter, Arial, sans-serif`;
        wrap(g, note.text, w * 0.04, h * 0.3, w * 0.92, h * 0.15, 3);
        g.fillStyle = p.muted;
        g.font = `500 ${h * 0.09}px Inter, Arial, sans-serif`;
        g.fillText('pinch to remove', w * 0.04, h * 0.84);
      });
    });
  }

  private drawExtra(x: { panel: CanvasPanel; series: Series; label: string }): void {
    const vals = x.series.values.slice(-BARS);
    x.panel.draw((g, w, h, p) => {
      g.fillStyle = p.text;
      g.font = `700 ${h * 0.1}px Inter, Arial, sans-serif`;
      g.fillText(x.label, w * 0.05, h * 0.07);
      g.fillStyle = p.muted;
      g.font = `500 ${h * 0.08}px Inter, Arial, sans-serif`;
      g.fillText(`latest ${money(vals[vals.length - 1] ?? 0)}`, w * 0.05, h * 0.2);
      const max = Math.max(1, ...vals);
      const step = (w * 0.9) / vals.length;
      vals.forEach((v, i) => {
        g.fillStyle = p.accent;
        const bh = (v / max) * h * 0.55;
        g.fillRect(w * 0.05 + i * step, h * 0.9 - bh, step * 0.7, bh);
      });
    });
  }

  private drawTasks(): void {
    this.tasks.panel.draw((g, w, h, p) => {
      g.fillStyle = p.text;
      g.font = `700 ${h * 0.07}px Inter, Arial, sans-serif`;
      g.fillText('Today', w * 0.06, h * 0.05);
      g.fillStyle = p.accent;
      g.font = `600 ${h * 0.04}px Inter, Arial, sans-serif`;
      const n = streak();
      g.fillText(`${n} morning${n === 1 ? '' : 's'} in a row`, w * 0.06, h * 0.15);
      state.tasks.slice(0, 5).forEach((t, i) => {
        const cy = h * 0.5 - (0.155 - i * 0.082) * (h / 0.62);
        g.strokeStyle = t.done ? p.up : p.muted;
        g.lineWidth = 5;
        g.strokeRect(w * 0.06, cy - h * 0.025, h * 0.05, h * 0.05);
        if (t.done) {
          g.fillStyle = p.up;
          g.fillRect(w * 0.06 + 8, cy - h * 0.025 + 8, h * 0.05 - 16, h * 0.05 - 16);
        }
        g.fillStyle = t.done ? p.muted : p.text;
        g.font = `500 ${h * 0.045}px Inter, Arial, sans-serif`;
        g.textBaseline = 'middle';
        wrap(g, t.text, w * 0.06 + h * 0.08, cy, w * 0.78, h * 0.05, 1);
        g.textBaseline = 'top';
      });
      g.fillStyle = p.muted;
      g.font = `500 ${h * 0.035}px Inter, Arial, sans-serif`;
      g.fillText('Pinch or look and hold to tick. Grab to move.', w * 0.06, h * 0.92);
    });
  }

  private drawQuestion(): void {
    this.question.draw((g, w, h, p) => {
      g.fillStyle = p.text;
      g.font = `700 ${h * 0.06}px Inter, Arial, sans-serif`;
      g.fillText('Ask about what you are looking at', w * 0.05, h * 0.035);
      CARD_QUESTIONS.forEach((q, i) => {
        const cy = h / 2 - (0.105 - i * 0.056) * (h / 0.36);
        roundRect(g, w * 0.05, cy - h * 0.065, w * 0.9, h * 0.13, h * 0.03);
        g.fillStyle = hexAlpha(p.card, 1);
        g.fill();
        g.lineWidth = p.borderWidth;
        g.strokeStyle = p.border;
        g.stroke();
        g.fillStyle = p.text;
        g.font = `600 ${h * 0.055}px Inter, Arial, sans-serif`;
        g.textBaseline = 'middle';
        g.fillText(q, w * 0.09, cy);
        g.textBaseline = 'top';
      });
      if (this.speech) {
        const cy = h / 2 + 0.152 * (h / 0.36);
        g.fillStyle = p.accent;
        g.font = `600 ${h * 0.05}px Inter, Arial, sans-serif`;
        g.textBaseline = 'middle';
        g.fillText('● Ask out loud', w * 0.09, cy);
        g.textBaseline = 'top';
      }
    });
  }

  private drawSettings(): void {
    const s = state.settings;
    const items: [string, boolean | null][] = [
      ['High contrast', s.highContrast],
      ['Captions', s.captions],
      ['One-handed', s.oneHanded],
      ['Sound', s.sound],
      ['Lay out again', null],
    ];
    this.settings.draw((g, w, h, p) => {
      g.fillStyle = p.text;
      g.font = `700 ${h * 0.055}px Inter, Arial, sans-serif`;
      g.fillText('Settings', w * 0.08, h * 0.035);
      items.forEach(([label, on], i) => {
        const cy = h / 2 - (0.098 - i * 0.06) * (h / 0.36);
        roundRect(g, w * 0.06, cy - h * 0.068, w * 0.88, h * 0.136, h * 0.03);
        g.fillStyle = on ? hexAlpha(p.accent, 0.9) : hexAlpha(p.card, 1);
        g.fill();
        g.lineWidth = p.borderWidth;
        g.strokeStyle = p.border;
        g.stroke();
        g.fillStyle = on ? '#111111' : p.text;
        g.font = `600 ${h * 0.048}px Inter, Arial, sans-serif`;
        g.textBaseline = 'middle';
        g.fillText(on === null ? label : `${label}: ${on ? 'on' : 'off'}`, w * 0.12, cy);
        g.textBaseline = 'top';
      });
    });
  }

  private coachText(): string {
    switch (this.onboardStep) {
      case 0:
        return 'Welcome. Pinch the Deposits tile on your desk to open it.';
      case 1:
        return 'Now rest your hands. Look at the Withdrawals tile and hold still until the ring fills.';
      case 2:
        return 'Last one: look at a bar on the chart, then choose "Why did this drop?" below.';
      default:
        return 'You are set. Your brief will be here every morning.';
    }
  }

  private drawCoach(): void {
    const text = this.coachText();
    this.coach.draw((g, w, h, p) => {
      g.fillStyle = p.accent;
      g.font = `700 ${h * 0.2}px Inter, Arial, sans-serif`;
      g.fillText(this.onboardStep < 3 ? `Step ${this.onboardStep + 1} of 3` : 'Ready', w * 0.03, h * 0.12);
      g.fillStyle = p.text;
      g.font = `500 ${h * 0.22}px Inter, Arial, sans-serif`;
      wrap(g, text, w * 0.03, h * 0.42, w * 0.94, h * 0.27, 2);
    });
  }

  private drawFps(): void {
    const s = perf.stats();
    this.fps.draw((g, w, h, p) => {
      g.fillStyle = p.text;
      g.font = `700 ${h * 0.15}px Inter, Arial, sans-serif`;
      g.fillText('Frame time', w * 0.07, h * 0.08);
      g.font = `500 ${h * 0.12}px Inter, Arial, sans-serif`;
      g.fillStyle = p.muted;
      g.fillText(`median ${s.median.toFixed(0)} fps`, w * 0.07, h * 0.36);
      g.fillText(`1% low ${s.low1.toFixed(0)} fps`, w * 0.07, h * 0.56);
      g.fillText(`${s.frames} frames`, w * 0.07, h * 0.76);
    });
  }

  private showCaption(text: string, seconds: number): void {
    if (!state.settings.captions) return;
    this.captionUntil = performance.now() + seconds * 1000;
    this.caption.panel.mesh.visible = true;
    this.caption.panel.draw((g, w, h, p) => {
      g.fillStyle = p.text;
      g.font = `500 ${h * 0.26}px Inter, Arial, sans-serif`;
      wrap(g, text, w * 0.03, h * 0.14, w * 0.94, h * 0.34, 2);
    });
  }

  say(text: string, action = ''): void {
    this.lastAnswer = text;
    this.lastAction = action;
    this.drawAnswer();
    this.showCaption(text, 10);
    cue('answer');
  }

  // ---------- layout ----------

  doLayout(det: Detected): void {
    const head = new Vector3();
    const fwd = new Vector3();
    const h = this.world.player.head;
    h.updateWorldMatrix(true, false);
    h.getWorldPosition(head);
    h.getWorldDirection(fwd).negate();
    this.layout = computeLayout(det, head, fwd);
    const L = this.layout;
    const curved = L.facing.kind === 'curved';
    this.chartFlat.mesh.visible = !curved;
    this.chartCurved.visible = curved;

    const tray = L.table.kind === 'tray';
    const sp = tray ? 0.2 : 0.21;
    const slots: [string, Entity, [number, number, number]][] = [
      ['tile:deposits', this.tiles.get('deposits')!.entity, [-1.5 * sp + 0.02, 0.09, 0]],
      ['tile:withdrawals', this.tiles.get('withdrawals')!.entity, [-0.5 * sp + 0.02, 0.09, 0]],
      ['tile:balance', this.tiles.get('balance')!.entity, [0.5 * sp + 0.02, 0.09, 0]],
      ['clock', this.clock.entity, [1.5 * sp - 0.01, 0.09, 0]],
    ];
    for (const [key, e, off] of slots) this.placeOn(e, L.table, state.layout[key]?.surface === L.table.kind ? state.layout[key].offset : off);
    // The question and settings cards stand behind the tiles like a lectern, leaning back 35 degrees from upright.
    // Kept off the centre line so resting your eyes on the desk never lands on a button.
    const side = tray ? 0.42 : 0.52;
    const leanR = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (28 * Math.PI) / 180).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (55 * Math.PI) / 180));
    const leanL = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (-28 * Math.PI) / 180).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (55 * Math.PI) / 180));
    this.placeOn(this.questionEntity, L.table, [side + 0.05, 0.12, 0.12], 1, leanR);
    this.placeOn(this.settingsEntity, L.table, [-side, 0.12, 0.12], 1, leanL);
    const wallD = L.report.facingWallDistance ?? 1.6;
    const fit = Math.min(1.3, Math.max(0.6, wallD / 1.6));
    this.placeOn(this.chartRoot, L.facing, state.layout.chart?.surface === L.facing.kind ? state.layout.chart.offset : [0, 0, 0], state.layout.chart?.scale ?? fit);
    this.placeOn(this.tasks.entity, L.side, state.layout.tasks?.surface === L.side.kind ? state.layout.tasks.offset : [0, 0, 0], state.layout.tasks?.scale);
    this.drawChart();
    this.positionNear(true);

    for (const e of [this.chartRoot, this.tasks.entity, ...[...this.tiles.values()].map((t) => t.entity), this.clock.entity]) {
      if (!e.hasComponent(XRAnchor)) e.addComponent(XRAnchor);
    }
    this.root.object3D!.visible = true;
    this.laidAt = performance.now();
    this.landT = 0;
    cue('land');
    if (this.onboardStep >= 3) this.showCaption(`Good morning. Data for ${shortDate(this.brief.days[this.brief.days.length - 1].date)} is on your desk.`, 6);
    else this.drawCoach();
  }

  private placeOn(e: Entity, frame: Frame, offset: [number, number, number], scale = 1, local?: Quaternion): void {
    const o = e.object3D!;
    placeIn(frame, offset, _p, _q);
    if (local) _q.multiply(local);
    o.scale.setScalar(scale || 1);
    setWorldPose(o, _p, _q);
  }

  /** Opens a tile's detail card standing on the desk behind the tiles. */
  private placeDetail(): void {
    if (!this.layout || !this.openTile) return;
    const t = this.tiles.get(this.openTile)!.entity.object3D!;
    t.updateWorldMatrix(true, false);
    const pos = new Vector3().setFromMatrixPosition(t.matrixWorld);
    const q = new Quaternion().setFromRotationMatrix(t.matrixWorld);
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    const normal = new Vector3(0, 0, 1).applyQuaternion(q);
    pos.addScaledVector(up, 0.12).addScaledVector(normal, 0.17);
    const stand = q.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
    setWorldPose(this.detail.panel.mesh, pos, stand);
  }

  private positionNear(snap: boolean, dt = 0): void {
    if (!this.layout) return;
    const head = this.world.player.head;
    head.getWorldPosition(_p);
    head.getWorldDirection(_s).negate();
    const yaw = Math.atan2(-_s.x, -_s.z);
    let d = yaw - this.nearYaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (snap) this.nearYaw = yaw;
    else if (Math.abs(d) > (FOV_CONE_DEG * Math.PI) / 180) this.nearYaw += d * Math.min(1, dt * 3);
    const fwd = new Vector3(-Math.sin(this.nearYaw), 0, -Math.cos(this.nearYaw));
    const pos = _p.clone().addScaledVector(fwd, 0.7);
    pos.y = _p.y - 0.14;
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.nearYaw);
    q.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (-16 * Math.PI) / 180));
    setWorldPose(this.near.object3D!, pos, q);
  }

  // ---------- input and actions ----------

  onInput(id: string, via: Via): void {
    if (via === 'dwell') cue('dwell');
    else cue('select');
    if (id.startsWith('tile:')) {
      const key = id.slice(5) as TileKey;
      this.openTile = this.openTile === key ? null : key;
      this.detail.panel.mesh.visible = this.openTile !== null;
      if (this.openTile) {
        this.drawDetail(this.openTile);
        this.placeDetail();
      }
      for (const k of this.tiles.keys()) this.drawTile(k);
      if (this.onboardStep === 0 && key === 'deposits') this.advance();
      else if (this.onboardStep === 1 && key === 'withdrawals') this.advance();
    } else if (id === 'clock') {
      this.fpsVisible = !this.fpsVisible;
      this.fps.mesh.visible = this.fpsVisible;
      this.drawClock();
    } else if (id.startsWith('bar:')) {
      this.selected = Number(id.slice(4));
      gaze.lastBar = id;
      this.drawChart();
    } else if (id.startsWith('ask:')) {
      this.ask(CARD_QUESTIONS[Number(id.slice(4))], via === 'dwell' ? 'dwell' : 'card');
    } else if (id === 'mic') {
      this.speech?.start();
    } else if (id.startsWith('task:')) {
      const t = state.tasks[Number(id.slice(5))];
      if (t) {
        t.done = !t.done;
        save();
        this.drawTasks();
      }
    } else if (id.startsWith('note:')) {
      const nid = id.slice(5);
      state.notes = state.notes.filter((n) => n.id !== nid);
      save();
      const idx = this.notes.findIndex((n) => n.id === nid);
      if (idx >= 0) {
        this.notes[idx].entity.dispose();
        this.notes.splice(idx, 1);
        this.drawChart();
      }
    } else if (id.startsWith('set:')) {
      const s = state.settings;
      if (id === 'set:hc') s.highContrast = !s.highContrast;
      if (id === 'set:cap') {
        s.captions = !s.captions;
        if (!s.captions) this.caption.panel.mesh.visible = false;
      }
      if (id === 'set:one') {
        s.oneHanded = !s.oneHanded;
        this.applyGrab();
      }
      if (id === 'set:sound') s.sound = !s.sound;
      if (id === 'set:relayout') {
        state.layout = {};
        this.relayoutRequested = true;
      }
      save();
      this.redrawAll();
    }
  }

  relayoutRequested = false;

  private advance(): void {
    this.onboardStep += 1;
    if (this.onboardStep >= 3 && !state.onboarded) {
      state.onboarded = true;
      state.onboardSeconds = Math.round((performance.now() - this.sessionStart) / 100) / 10;
      save();
      cue('done');
    }
    this.drawCoach();
  }

  /** The agent: words in, one schema action out, run by the workspace. */
  ask(text: string, via: Via): Action | null {
    const action = parse(text);
    if (!action) {
      this.say(`I heard "${text}". Try one of the questions on the card.`, 'no matching action');
      return null;
    }
    this.run(action, via);
    return action;
  }

  private focusIndex(direction: 'drop' | 'rise' | 'move'): number {
    const s = this.view.series.values;
    const fromGaze = gaze.current.startsWith('bar:') ? gaze.current : gaze.lastBar;
    if (fromGaze) return Number(fromGaze.slice(4));
    if (this.selected > 0) return this.selected;
    const { start } = this.window();
    let best = s.length - 1;
    let bestD = 0;
    for (let i = Math.max(1, start); i < s.length; i++) {
      const d = s[i] - s[i - 1];
      if ((direction === 'drop' && d < bestD) || (direction !== 'drop' && Math.abs(d) > Math.abs(bestD))) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  run(action: Action, via: Via): void {
    const days = this.brief.days;
    const s = this.view.series;
    const tag = `${action.type}${via === 'voice' ? ' · from your voice' : ''}`;
    switch (action.type) {
      case 'explain': {
        const i = this.focusIndex(action.direction);
        this.selected = i;
        if (i < 1) {
          this.say('That is the first day on the chart, so there is no earlier day to compare.', tag);
          break;
        }
        const val = s.values[i];
        const prevVal = s.values[i - 1];
        const word = val < prevVal ? 'down' : 'up';
        let text = `${s.label} on ${shortDate(s.dates[i])}: ${money(val, true)}, ${word} ${money(Math.abs(val - prevVal))} from ${shortDate(s.dates[i - 1])}.`;
        const cur = this.dayByDate(s.dates[i]);
        const prev = this.dayByDate(s.dates[i - 1]);
        if (cur && prev && s.id !== 'custom') {
          let ms = movers(prev, cur, 8, this.view.side === 'net' ? undefined : this.view.side);
          if (this.view.pattern) ms = ms.filter((m) => this.view.pattern!.test(m.category));
          ms = ms.slice(0, 3);
          if (ms.length) {
            text += ' Biggest moves: ' + ms.map((m) => `${m.side} ${shortCat(m.category)} ${money(m.delta, true)}`).join('; ') + '.';
          }
        }
        if (this.onboardStep === 2) this.advance();
        this.drawChart();
        this.say(text, `${tag} · ${shortDate(s.dates[i])}`);
        break;
      }
      case 'compare': {
        this.view.compare = !this.view.compare;
        const n = s.values.length;
        const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
        const thisWeek = sum(s.values.slice(Math.max(0, n - 5)));
        const lastWeek = sum(s.values.slice(Math.max(0, n - 10), Math.max(0, n - 5)));
        this.drawChart();
        this.say(
          this.view.compare
            ? `The dashed line is the same days one week earlier. Last 5 days: ${money(thisWeek, true)}; the 5 before: ${money(lastWeek, true)}.`
            : 'Comparison off.',
          tag,
        );
        break;
      }
      case 'filter': {
        if (action.side === 'net') {
          this.view = { series: this.netSeries(), side: 'net', pattern: null, compare: false };
        } else {
          const pattern = action.category ? new RegExp(action.category) : /.*/;
          const series = categorySeries(days, action.side, pattern);
          series.label = `${action.label}${action.category ? ` ${action.side}` : ''}`;
          this.view = { series, side: action.side, pattern: action.category ? pattern : null, compare: false };
        }
        this.selected = -1;
        gaze.lastBar = '';
        this.drawChart();
        const v = this.view.series.values;
        this.say(`Showing ${this.view.series.label.toLowerCase()}: ${money(v[v.length - 1])} on ${shortDate(this.view.series.dates[v.length - 1])}. Say or pick "show everything" to go back.`, tag);
        break;
      }
      case 'annotate': {
        const text = this.lastAnswer || (this.selected >= 0 ? `${s.label} ${money(s.values[this.selected], true)} on ${shortDate(s.dates[this.selected])}` : 'Marked for follow-up');
        const id = String(Date.now());
        state.notes.push({ id, text, date: localDay() });
        state.notes = state.notes.slice(-6);
        save();
        this.addNoteEntity(id);
        this.drawNotes();
        this.drawChart();
        this.say('Pinned to the wall above the chart. It will be here tomorrow.', tag);
        break;
      }
      case 'summarize_changes': {
        const cur = days[days.length - 1];
        const prev = days[days.length - 2];
        const ms = movers(prev, cur, 2);
        let text = `${shortDate(cur.date)} vs ${shortDate(prev.date)}: deposits ${money(cur.deposits)} (${money(cur.deposits - prev.deposits, true)}), withdrawals ${money(cur.withdrawals)} (${money(cur.withdrawals - prev.withdrawals, true)}), cash balance ${money(cur.balance ?? 0)}.`;
        if (ms.length) text += ` Largest move: ${ms[0].side} ${shortCat(ms[0].category)} ${money(ms[0].delta, true)}.`;
        if (this.lastVisit) text += ` Last visit: ${this.lastVisit.day}.`;
        this.say(text, tag);
        break;
      }
      case 'add_panel': {
        if (this.extras.length >= 2) {
          this.say('Two extra panels are already open. Pinch a note or lay out again to clear space.', tag);
          break;
        }
        const series = categorySeries(days, action.side, new RegExp(action.category));
        const panel = new CanvasPanel(0.42, 0.26, 1500);
        const entity = this.entity(panel.mesh, this.chartRoot);
        const extra = { panel, entity, series, label: `${action.label} ${action.side}` };
        this.extras.push(extra);
        this.drawExtra(extra);
        this.drawChart();
        this.say(`Added a ${extra.label} panel beside the chart.`, tag);
        break;
      }
    }
  }

  /** Called when a grabbed panel is let go: it settles onto the nearest surface. */
  onRelease(e: Entity): void {
    if (!this.layout) return;
    const key = e.getValue(MdPanel, 'key') as string;
    const o = e.object3D!;
    o.updateWorldMatrix(true, false);
    const pos = new Vector3().setFromMatrixPosition(o.matrixWorld);
    const L = this.layout;
    let best: Frame | null = null;
    let bestD = 0.35;
    for (const f of [L.table, L.facing, L.side]) {
      const off = offsetIn(f, pos);
      const d = Math.abs(off[2]);
      if (d < bestD && Math.abs(off[0]) < f.halfW + 0.3 && Math.abs(off[1]) < f.halfH + 0.5) {
        best = f;
        bestD = d;
      }
    }
    const scale = o.scale.x;
    if (best) {
      const off = offsetIn(best, pos);
      off[2] = 0;
      this.placeOn(e, best, off, scale);
      state.layout[key] = { surface: best.kind, offset: off, scale };
    }
    save();
  }

  /** For scripted checks: the Object3D of a target id. */
  findTarget(id: string): Object3D | null {
    const all: Entity[] = [
      ...[...this.tiles.values()].map((t) => t.entity),
      this.clock.entity,
      ...this.bars,
      ...this.qButtons,
      ...this.sButtons,
      ...this.tasks.rows,
      ...this.notes.map((n) => n.entity),
      this.mic,
    ];
    if (id === 'chart') return this.chartRoot.object3D ?? null;
    if (id === 'tasks') return this.tasks.entity.object3D ?? null;
    for (const e of all) if (e.getValue(MdTarget, 'id') === id) return e.object3D ?? null;
    return null;
  }

  /** For scripted checks: where each surface frame landed, in world coordinates. */
  surfaceReport(): Record<string, number[]> | null {
    if (!this.layout) return null;
    const r = (f: Frame) => [f.origin.x, f.origin.y, f.origin.z].map((v) => Math.round(v * 100) / 100);
    return { table: r(this.layout.table), facing: r(this.layout.facing), side: r(this.layout.side) };
  }

  // ---------- per frame ----------

  update(dt: number, det: () => Detected, counts: number): void {
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (!immersive) return;
    const now = performance.now();
    if (!this.layout || this.relayoutRequested) {
      const elapsed = (now - this.sessionStart) / 1000;
      if (this.relayoutRequested || (elapsed > 1.2 && (counts > 0 ? elapsed > 2.0 : elapsed > 4.0))) {
        this.relayoutRequested = false;
        this.doLayout(det());
      }
      return;
    }
    // The brief lands: panels grow in over 0.6 s.
    if (this.landT < 1) {
      this.landT = Math.min(1, this.landT + dt / 0.6);
      const k = 1 - Math.pow(1 - this.landT, 3);
      this.root.object3D!.scale.setScalar(1);
      for (const t of this.tiles.values()) t.panel.mesh.scale.setScalar(k);
      this.clock.panel.mesh.scale.setScalar(k);
      this.chartFlat.mesh.scale.setScalar(k);
      this.chartCurved.scale.setScalar(k);
      this.tasks.panel.mesh.scale.setScalar(Math.max(0.001, k));
    }
    this.positionNear(false, dt);
    if (this.fpsVisible && Math.floor(now / 500) !== Math.floor((now - dt * 1000) / 500)) this.drawFps();
    if (Math.floor(now / 30000) !== Math.floor((now - dt * 1000) / 30000)) this.drawClock();
    if (this.caption.panel.mesh.visible) {
      if (now > this.captionUntil) this.caption.panel.mesh.visible = false;
      const head = this.world.player.head;
      head.getWorldPosition(_p);
      head.getWorldQuaternion(_q);
      const off = new Vector3(0, -0.3, -0.9).applyQuaternion(_q);
      setWorldPose(this.caption.panel.mesh, _p.add(off), _q);
    }
    if (this.onboardStep >= 3 && this.coach.mesh.visible && this.laidAt && now - this.laidAt > 8000 && state.onboarded) {
      this.coach.mesh.visible = false;
    }
  }

  sessionStarted(): void {
    this.sessionStart = performance.now();
    this.layout = null;
    this.coach.mesh.visible = true;
    perf.reset();
  }

  sessionEnded(): void {
    this.root.object3D!.visible = false;
    this.layout = null;
  }
}

/** Feeds detected planes and meshes to the layout, and settles released panels. */
export function makeAppSystem(app: MorningDesk) {
  return class AppSystem extends createSystem({
    planes: { required: [XRPlane] },
    meshes: { required: [XRMesh] },
    grabbed: { required: [MdPanel, Grabbed] },
  }) {
    init(): void {
      this.queries.grabbed.subscribe('disqualify', (e) => app.onRelease(e));
      this.cleanupFuncs.push(
        this.world.visibilityState.subscribe((v) => {
          if (v === VisibilityState.NonImmersive) app.sessionEnded();
          else app.sessionStarted();
        }),
      );
    }

    update(delta: number): void {
      const det = (): Detected => ({
        planes: [...this.queries.planes.entities].map((e) => {
          const native = e.getValue(XRPlane, '_plane') as
            | { semanticLabel?: string; orientation?: string; polygon?: { x: number; z: number }[] }
            | undefined;
          return {
            obj: e.object3D!,
            label: native?.semanticLabel ?? '',
            orientation: native?.orientation ?? '',
            polygon: (native?.polygon ?? []).map((pt) => ({ x: pt.x, z: pt.z })),
          };
        }),
        meshes: [...this.queries.meshes.entities].map((e) => ({ obj: e.object3D!, label: (e.getValue(XRMesh, 'semanticLabel') as string) ?? '' })),
      });
      app.update(delta, det, this.queries.planes.entities.size + this.queries.meshes.entities.size);
    }
  };
}
