// Scripted check in the IWER Quest 3 emulator: enters the session, waits for
// the brief to land, reads the layout report and the frame-time log.
// Usage: node tools/measure.mjs <url> <outDir> [seconds] [--headed] [--shots]
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const [url, outDir, secondsArg] = process.argv.slice(2);
const seconds = Number(secondsArg ?? 20);
const headed = process.argv.includes('--headed');
const shots = process.argv.includes('--shots');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: !headed,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('enter').disabled, null, { timeout: 60000 });
const status = await page.textContent('#status');
if (shots) await page.screenshot({ path: `${outDir}/landing.png` });
const t0 = Date.now();
await page.click('#enter');
await page.waitForFunction(() => window.__md && window.__md.layout(), null, { timeout: 30000 });
const laidWallMs = Date.now() - t0;
await page.waitForTimeout(1500);
const layout = await page.evaluate(() => window.__md.layout());
const laidAfterMs = await page.evaluate(() => window.__md.laidAfterMs());
const head = await page.evaluate(() => window.__md.head());
if (shots) await page.screenshot({ path: `${outDir}/landed.png` });
await page.evaluate(() => window.__md.resetPerf());
await page.waitForTimeout(seconds * 1000);
const perf = await page.evaluate(() => window.__md.perf());
const gpu = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const ext = c && c.getExtension('WEBGL_debug_renderer_info');
  return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
const result = { url, status, laidWallMs, laidAfterMs, head, layout, perf, seconds, gpu, headed, measuredAt: new Date().toISOString() };
writeFileSync(`${outDir}/measure.json`, JSON.stringify(result, null, 2));
writeFileSync(`${outDir}/console.log`, logs.join('\n'));
console.log(JSON.stringify(result));
await browser.close();
