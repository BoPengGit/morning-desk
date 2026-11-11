// Drives the IWER Quest 3 emulator from Playwright: room, head pose, hands, pinch.
// Every capture and measurement in tools/ goes through these helpers.
import { chromium } from 'playwright';

export const ROOMS = ['office_small', 'living_room', 'meeting_room', 'music_room', 'office_large', 'none'];
export const SEATED_EYE = 1.2;

export async function launch({ video } = {}) {
  const browser = await chromium.launch({
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    ...(video ? { recordVideo: { dir: video, size: { width: 1600, height: 900 } } } : {}),
  });
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  return { browser, context, page, logs };
}

/** Loads the app, optionally clearing saved state, and sets the emulated room. */
export async function open(page, url, { room = 'office_small', clean = true, eye = SEATED_EYE } = {}) {
  await page.goto(url, { waitUntil: 'load' });
  if (clean) {
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'load' });
  }
  await page.waitForFunction(() => !document.getElementById('enter').disabled, null, { timeout: 60000 });
  await page.evaluate(
    async ({ room, eye }) => {
      const d = navigator.xr[Object.getOwnPropertySymbols(navigator.xr)[0]].device;
      window.__dev = d;
      if (room === 'none') d.sem.deleteAll();
      else if (room !== 'office_small') await d.sem.loadDefaultEnvironment(room);
      d.position.set(0, eye, 0);
      d.quaternion.set(0, 0, 0, 1);
      d.primaryInputMode = 'hand';
    },
    { room, eye },
  );
}

/** The emulator's own remote-control API (the one Meta's CLI and MCP tools drive). */
export async function rc(page, method, params = {}) {
  return page.evaluate(({ method, params }) => window.__dev.remote.dispatch(method, params), { method, params });
}

export async function hideDevUI(page) {
  await page.evaluate(() => {
    const c = window.__dev?.devui?.devUIContainer;
    if (c) c.style.display = 'none';
  });
}

/** Clicks Enter, seats the headset at eye height and switches to hands before the layout runs. */
export async function enter(page, eye = SEATED_EYE) {
  const t0 = Date.now();
  await page.click('#enter');
  await page.waitForFunction(() => window.__dev?.activeSession, null, { timeout: 30000 });
  await rc(page, 'set_transform', { device: 'headset', position: { x: 0, y: eye, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  await rc(page, 'set_input_mode', { mode: 'hand' });
  await restHands(page);
  await page.waitForFunction(() => window.__md && window.__md.layout(), null, { timeout: 30000 });
  return Date.now() - t0;
}

const v3 = (a) => ({ x: a[0], y: a[1], z: a[2] });
const q4 = (a) => ({ x: a[0], y: a[1], z: a[2], w: a[3] });

/** Turns the head to look at a world point over `ms`. */
export async function lookAt(page, target, ms = 800) {
  const head = await page.evaluate(() => window.__md.head());
  const q = await page.evaluate(({ head, target }) => window.__md.lookQuat(head, target), { head, target });
  await rc(page, 'animate_to', { device: 'headset', orientation: q4(q), duration: ms / 1000 });
  await page.waitForTimeout(80);
}

export async function targetPos(page, id) {
  return page.evaluate((id) => window.__md.targetPos(id), id);
}

/** Raises a hand, points its ray at a target and pinches. */
export async function pinch(page, id, side = 'right', moveMs = 450) {
  const pos = await targetPos(page, id);
  if (!pos) throw new Error(`no target ${id}`);
  const head = await page.evaluate(() => window.__md.head());
  const from = [head[0] + (side === 'right' ? 0.16 : -0.16), head[1] - 0.3, head[2] - 0.25];
  const q = await page.evaluate(({ from, pos }) => window.__md.lookQuat(from, pos), { from, pos });
  await rc(page, 'animate_to', { device: `hand-${side}`, position: v3(from), orientation: q4(q), duration: moveMs / 1000 });
  await page.waitForTimeout(150);
  await rc(page, 'select', { device: `hand-${side}`, duration: 0.2 });
  await page.waitForTimeout(250);
}

/** Looks at a target and holds still long enough for the dwell ring to fire. */
export async function dwell(page, id, holdMs = 1900) {
  const pos = await targetPos(page, id);
  if (!pos) throw new Error(`no target ${id}`);
  await lookAt(page, pos, 700);
  await page.waitForTimeout(holdMs);
}

/** Lowers both hands to the lap, out of the way of the view. */
export async function restHands(page, ms = 300) {
  const head = await page.evaluate(() => window.__md?.head?.() ?? [0, 1.2, 0]);
  for (const side of ['left', 'right']) {
    await rc(page, 'animate_to', {
      device: `hand-${side}`,
      position: v3([head[0] + (side === 'right' ? 0.22 : -0.22), head[1] - 0.6, head[2] - 0.2]),
      orientation: { pitch: -60, yaw: 0, roll: 0 },
      duration: ms / 1000,
    });
  }
}
