import { Matrix4, Quaternion, SceneUnderstandingSystem, Vector3, World } from '@iwsdk/core';
import { MdTarget } from './components.js';
import projectOptions from 'virtual:iwsdk-project';
import { makeAppSystem, MorningDesk } from './app.js';
import { loadBrief, parseCsv } from './data.js';
import { state, save } from './store.js';
import { DwellSystem, FrameMeterSystem, InteractionSystem, bus, gaze, perf } from './systems.js';

const status = document.getElementById('status')!;
const enter = document.getElementById('enter') as HTMLButtonElement;
const landing = document.getElementById('landing')!;
const csvInput = document.getElementById('csv') as HTMLInputElement;
const tasksInput = document.getElementById('tasks') as HTMLTextAreaElement;

tasksInput.value = state.tasks.map((t) => t.text).join('\n');

async function start() {
  const brief = await loadBrief();
  const csvUrl = new URLSearchParams(location.search).get('csv') ?? localStorage.getItem('morning-desk.csv') ?? '';
  if (csvUrl) {
    csvInput.value = csvUrl;
    try {
      const text = await (await fetch(csvUrl)).text();
      const series = parseCsv(text, decodeURIComponent(csvUrl.split('/').pop() ?? 'Your data').replace(/\.csv.*$/i, ''));
      if (series) brief.custom = series;
    } catch {
      status.textContent = 'That CSV link could not be read, so the Treasury data is showing.';
    }
  }
  const latest = brief.days[brief.days.length - 1];
  status.textContent =
    `${brief.source === 'live' ? 'Live' : 'Bundled'} U.S. Treasury data through ${latest.date}` +
    (brief.custom ? ` · chart: ${brief.custom.label}` : '');

  const world = await World.create(document.getElementById('scene-container') as HTMLDivElement, projectOptions);
  const app = new MorningDesk(world);
  app.build(brief);
  world.registerSystem(InteractionSystem);
  world.registerSystem(DwellSystem);
  world.registerSystem(FrameMeterSystem);
  world.registerSystem(makeAppSystem(app));

  world.visibilityState.subscribe((v) => {
    landing.style.display = v === 'non-immersive' ? 'flex' : 'none';
  });
  enter.disabled = false;
  enter.textContent = 'Enter Morning Desk';
  enter.onclick = () => {
    const lines = tasksInput.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 5);
    if (lines.join('|') !== state.tasks.map((t) => t.text).join('|')) {
      state.tasks = lines.map((text) => ({ text, done: false }));
      save();
    }
    world.launchXR();
  };
  document.getElementById('csv-go')!.onclick = () => {
    if (csvInput.value) localStorage.setItem('morning-desk.csv', csvInput.value);
    else localStorage.removeItem('morning-desk.csv');
    location.reload();
  };

  // A small hook for scripted checks: frame stats, layout report and actions.
  (window as unknown as Record<string, unknown>).__md = {
    enter: () => world.launchXR(),
    fire: (id: string) => bus.fire(id, 'auto'),
    ask: (text: string) => app.ask(text, 'card'),
    perf: () => perf.stats(),
    resetPerf: () => perf.reset(),
    layout: () => app.layout?.report ?? null,
    laidAfterMs: () => (app.laidAt ? Math.round(app.laidAt - app.sessionStart) : null),
    onboardSeconds: () => state.onboardSeconds,
    answer: () => app.lastAnswer,
    head: () => world.player.head.getWorldPosition(new Vector3()).toArray(),
    /** World position of a target by id (tile:deposits, ask:0, bar:12 ...). */
    targetPos: (id: string) => {
      const found = app.findTarget(id);
      return found ? found.getWorldPosition(new Vector3()).toArray() : null;
    },
    /** Quaternion that points -Z from `from` toward `to` (head and hand rays). */
    lookQuat: (from: number[], to: number[]) => {
      const m = new Matrix4().lookAt(new Vector3(...from), new Vector3(...to), new Vector3(0, 1, 0));
      return new Quaternion().setFromRotationMatrix(m).toArray();
    },
    surfaces: () => app.surfaceReport(),
    gaze: () => ({ ...gaze }),
    near: (r = 0.6) => {
      const h = world.player.head.getWorldPosition(new Vector3());
      const out: string[] = [];
      world.scene.traverse((o) => {
        const m = o as unknown as { isMesh?: boolean; isLine?: boolean; geometry?: { type: string } };
        if (!(m.isMesh || m.isLine) || !o.visible) return;
        const d = o.getWorldPosition(new Vector3()).distanceTo(h);
        if (d < r) out.push(`${o.type}:${o.name}:${m.geometry?.type}:${d.toFixed(2)}:parent=${o.parent?.name}/${o.parent?.type}`);
      });
      return out;
    },
    step: () => app.onboardStep,
    panelsVisible: () => app.panelsVisible(),
    biggestDropBar: () => app.biggestDropBar(),
    /** Shows the planes and meshes scene understanding found, as wireframes. */
    wireframe: (on: boolean) => {
      const sys = world.getSystem(SceneUnderstandingSystem);
      if (sys) sys.config.showWireFrame.value = on;
    },
    /** Hides or shows the whole brief, for a baseline frame-time run of the emulator alone. */
    showBrief: (on: boolean) => {
      app.root.object3D!.visible = on;
      app.caption.panel.mesh.visible = false;
    },
  };
}

start().catch((e) => {
  status.textContent = `Could not start: ${e?.message ?? e}`;
  console.error(e);
});
