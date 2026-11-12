// Frame-time measurement in the IWER Quest 3 emulator, seated at the desk in the
// synthetic office with every brief panel open.
// Usage: node tools/measure.mjs <url> <outFile> [seconds]
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { launch, open, enter, hideDevUI, lookAt, pinch, restHands, targetPos } from './emu.mjs';

const [url, outFile, secondsArg] = process.argv.slice(2);
const seconds = Number(secondsArg ?? 30);
const load = () => execSync('sysctl -n vm.loadavg').toString().trim();

const { browser, page, logs } = await launch();
await open(page, url);
await hideDevUI(page);
const enterMs = await enter(page);
await page.waitForTimeout(1500);
await pinch(page, 'tile:deposits');
await restHands(page);
const chart = await targetPos(page, 'chart');
const panels = await page.evaluate(() => window.__md.panelsVisible());

const runs = {};
// 1. Looking at the chart, holding still.
await lookAt(page, chart, 500);
await page.waitForTimeout(500);
let l0 = load();
await page.evaluate(() => window.__md.resetPerf());
await page.waitForTimeout(seconds * 1000);
runs.still = { ...(await page.evaluate(() => window.__md.perf())), loadBefore: l0, loadAfter: load() };

// 2. Looking around: desk, chart, side wall, back, every 1.5 s.
const tasks = await targetPos(page, 'tasks');
const desk = await targetPos(page, 'tile:withdrawals');
l0 = load();
await page.evaluate(() => window.__md.resetPerf());
const t0 = Date.now();
const path = [chart, tasks, desk, chart];
for (let i = 0; Date.now() - t0 < seconds * 1000; i++) await lookAt(page, path[i % path.length], 1500);
runs.moving = { ...(await page.evaluate(() => window.__md.perf())), loadBefore: l0, loadAfter: load() };

// 3. Baseline: the same emulator session with the brief hidden, holding still.
await lookAt(page, chart, 500);
await page.evaluate(() => window.__md.showBrief(false));
await page.waitForTimeout(500);
l0 = load();
await page.evaluate(() => window.__md.resetPerf());
await page.waitForTimeout(seconds * 1000);
runs.baselineBriefHidden = { ...(await page.evaluate(() => window.__md.perf())), loadBefore: l0, loadAfter: load() };
await page.evaluate(() => window.__md.showBrief(true));

const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const ext = c && c.getExtension('WEBGL_debug_renderer_info');
  return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
const result = {
  url,
  enterMs,
  panelsVisible: panels,
  seconds,
  runs,
  gpu,
  cpu: execSync('sysctl -n machdep.cpu.brand_string').toString().trim(),
  browser: browser.version(),
  emulator: 'IWER 2.5.0, metaQuest3 profile, office_small synthetic room, headless Chromium with GPU',
  errors: logs.filter((l) => /\[(error|pageerror)\]/.test(l) && !/CORS|ERR_FAILED/.test(l)),
  measuredAt: new Date().toISOString(),
};
writeFileSync(outFile, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
await browser.close();
