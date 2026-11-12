// Records emulator footage of one complete Morning Desk session and saves gallery stills.
// Usage: node tools/capture.mjs <url> <outDir>
// Footage: <outDir>/footage/*.webm (Playwright screen recording of the IWER emulator)
// Stills:  <outDir>/stills/*.png
import { mkdirSync, renameSync, readdirSync, writeFileSync } from 'node:fs';
import { launch, open, enter, hideDevUI, lookAt, pinch, dwell, restHands, targetPos, rc } from './emu.mjs';

const [url, outDir] = process.argv.slice(2);
mkdirSync(`${outDir}/stills`, { recursive: true });
mkdirSync(`${outDir}/footage`, { recursive: true });
const marks = [];
let tStart = 0;
const mark = (label) => {
  marks.push({ t: Math.round((Date.now() - tStart) / 100) / 10, label });
  console.log(marks.at(-1).t, label);
};
const still = async (page, name) => page.screenshot({ path: `${outDir}/stills/${name}.png` });

async function session(name, room, story) {
  const dir = `${outDir}/footage/${name}`;
  mkdirSync(dir, { recursive: true });
  const { browser, context, page, logs } = await launch({ video: dir });
  tStart = Date.now();
  marks.length = 0;
  await open(page, url, { room });
  await hideDevUI(page);
  await story(page);
  await context.close();
  await browser.close();
  const file = readdirSync(dir).find((f) => f.endsWith('.webm'));
  renameSync(`${dir}/${file}`, `${outDir}/footage/${name}.webm`);
  writeFileSync(`${outDir}/footage/${name}.marks.json`, JSON.stringify(marks, null, 2));
  const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l) && !/CORS|ERR_FAILED/.test(l));
  console.log(name, 'errors', errors.length, errors.slice(0, 3));
}

// Session A: the morning, in the synthetic office, seated at the desk.
await session('a-morning', 'office_small', async (page) => {
  mark('landing page');
  await page.waitForTimeout(2500);
  mark('enter');
  await enter(page);
  mark('brief laid out');
  const chart = await targetPos(page, 'chart');
  const tasks = await targetPos(page, 'tasks');
  const dep = await targetPos(page, 'tile:deposits');
  const wd = await targetPos(page, 'tile:withdrawals');
  await page.waitForTimeout(800);
  await lookAt(page, [wd[0], (wd[1] + chart[1]) / 2, (wd[2] + chart[2]) / 2], 900);
  await page.waitForTimeout(1200);
  await still(page, '01-brief-lands');
  mark('look desk to wall to side wall');
  await lookAt(page, chart, 1400);
  await page.waitForTimeout(800);
  await lookAt(page, tasks, 1600);
  await page.waitForTimeout(1200);
  await lookAt(page, [wd[0], (wd[1] + chart[1]) / 2, (wd[2] + chart[2]) / 2], 1400);
  mark('scene understanding wireframe');
  await page.evaluate(() => window.__md.wireframe(true));
  await page.waitForTimeout(2200);
  await still(page, '02-scene-understanding');
  await page.evaluate(() => window.__md.wireframe(false));
  mark('onboarding step 1: pinch deposits');
  await lookAt(page, dep, 900);
  await pinch(page, 'tile:deposits');
  await page.waitForTimeout(700);
  await still(page, '05-pinch-opens-tile');
  await restHands(page);
  mark('onboarding step 2: dwell withdrawals');
  await lookAt(page, [dep[0] - 0.1, dep[1] + 0.25, dep[2] - 0.2], 600);
  const wd2 = await targetPos(page, 'tile:withdrawals');
  await lookAt(page, wd2, 800);
  await page.waitForTimeout(900);
  await still(page, '04-head-gaze-dwell');
  await page.waitForTimeout(1200);
  mark('onboarding step 3: look at a bar, ask why');
  const dropBar = await page.evaluate(() => window.__md.biggestDropBar());
  const barPos = await targetPos(page, `bar:${dropBar}`);
  await lookAt(page, barPos, 1200);
  await page.waitForTimeout(1600);
  await pinch(page, 'ask:0');
  await restHands(page);
  await lookAt(page, [barPos[0], barPos[1] - 0.15, barPos[2]], 700);
  await page.waitForTimeout(2600);
  await still(page, '03-agent-explains');
  mark('pin a note');
  await pinch(page, 'ask:4');
  await restHands(page);
  await lookAt(page, [chart[0], chart[1] + 0.15, chart[2]], 900);
  await page.waitForTimeout(2200);
  mark('compare with last week');
  await pinch(page, 'ask:2');
  await restHands(page);
  await lookAt(page, chart, 600);
  await page.waitForTimeout(3000);
  await still(page, '06-compare-last-week');
  mark('filter: defense');
  await pinch(page, 'ask:3');
  await restHands(page);
  await lookAt(page, chart, 600);
  await page.waitForTimeout(3000);
  mark('what changed since yesterday');
  await pinch(page, 'ask:1');
  await restHands(page);
  await lookAt(page, chart, 600);
  await page.waitForTimeout(3500);
  mark('accessibility: high contrast');
  const set0 = await targetPos(page, 'set:hc');
  await lookAt(page, set0, 900);
  await pinch(page, 'set:hc', 'left');
  await restHands(page);
  await lookAt(page, [wd[0], (wd[1] + chart[1]) / 2, (wd[2] + chart[2]) / 2], 1000);
  await page.waitForTimeout(2200);
  await still(page, '07-high-contrast');
  await lookAt(page, set0, 900);
  await pinch(page, 'set:hc', 'left');
  await restHands(page);
  mark('frame-time overlay');
  const clock = await targetPos(page, 'clock');
  await lookAt(page, clock, 900);
  await pinch(page, 'clock');
  await restHands(page);
  await lookAt(page, [chart[0], chart[1] - 0.25, chart[2]], 900);
  await page.waitForTimeout(3500);
  await still(page, '08-frame-time');
  mark('end A');
});

// Session B: a room with no table and no wall in reach (empty emulator room).
await session('b-no-table', 'none', async (page) => {
  mark('enter empty room');
  await enter(page);
  await page.waitForTimeout(1500);
  const chart = await targetPos(page, 'chart');
  await lookAt(page, [chart[0], chart[1] - 0.35, chart[2] + 0.4], 900);
  await page.waitForTimeout(1500);
  await still(page, '09-no-table-tray');
  const bar = await page.evaluate(() => window.__md.biggestDropBar());
  await lookAt(page, await targetPos(page, `bar:${bar}`), 900);
  await page.waitForTimeout(2600);
  mark('dwell-only question, hands at rest');
  await dwell(page, 'ask:0', 2600);
  await lookAt(page, chart, 900);
  await page.waitForTimeout(3000);
  mark('end B');
});

// Session C: the second morning in the office: panels come back where they were left.
await session('c-next-morning', 'office_small', async (page) => {
  mark('first visit, onboarding skipped by script');
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem('morning-desk.v1') || '{}');
    st.onboarded = true;
    localStorage.setItem('morning-desk.v1', JSON.stringify(st));
  });
  await enter(page);
  await page.waitForTimeout(1500);
  await pinch(page, 'ask:4');
  await restHands(page);
  mark('exit and reopen');
  await rc(page, 'end_session', {});
  await page.waitForTimeout(1500);
  await enter(page);
  await page.waitForTimeout(1500);
  const chart = await targetPos(page, 'chart');
  await lookAt(page, [chart[0], chart[1] + 0.1, chart[2]], 900);
  await page.waitForTimeout(2500);
  mark('end C');
});
