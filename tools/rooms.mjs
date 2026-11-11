// Room test in the IWER Quest 3 emulator: the five synthetic rooms, each run twice
// (standing at the room origin, then seated at the room's main desk-height table),
// plus an empty session with no room data. Usage: node tools/rooms.mjs <url> <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { ROOMS, SEATED_EYE, launch, open, enter, hideDevUI, lookAt, rc } from './emu.mjs';

const [url, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

async function snapshot(page) {
  return page.evaluate(() => ({
    layout: window.__md.layout(),
    surfaces: window.__md.surfaces(),
    laidAfterMs: window.__md.laidAfterMs(),
    head: window.__md.head(),
  }));
}

async function shoot(page, r, path) {
  const t = r.surfaces.table;
  const f = r.surfaces.facing;
  await lookAt(page, [(t[0] + f[0]) / 2, t[1] * 0.6 + f[1] * 0.4, (t[2] + f[2]) / 2], 500);
  await page.waitForTimeout(700);
  await page.screenshot({ path });
}

/** A seat 0.4 m back from the near edge of the desk-height table nearest the room origin. */
function seatFor(tables) {
  const desk = tables
    .filter((t) => t.center[1] > 0.55 && t.center[1] < 0.95)
    .sort((a, b) => Math.hypot(a.center[0], a.center[2]) - Math.hypot(b.center[0], b.center[2]))[0];
  if (!desk) return null;
  const [cx, , cz] = desk.center;
  let dx = -cx;
  let dz = -cz;
  const n = Math.hypot(dx, dz) || 1;
  dx /= n;
  dz /= n;
  const ax = [desk.axisX[0], desk.axisX[2]];
  const al = Math.hypot(ax[0], ax[1]) || 1;
  const axn = [ax[0] / al, ax[1] / al];
  const span = Math.abs(dx * axn[0] + dz * axn[1]) * desk.hw + Math.abs(-dx * axn[1] + dz * axn[0]) * desk.hd;
  const x = cx + dx * (span + 0.4);
  const z = cz + dz * (span + 0.4);
  return { x, z, desk };
}

const results = [];
for (const room of ROOMS) {
  const { browser, page, logs } = await launch();
  try {
    await open(page, url, { room });
    await hideDevUI(page);
    const enterMs = await enter(page);
    await page.waitForTimeout(1500);
    const standing = await snapshot(page);
    await shoot(page, standing, `${outDir}/room-${room}-origin.png`);
    let seated = null;
    const seat = room === 'none' ? null : seatFor(standing.layout.tables);
    if (seat) {
      const q = await page.evaluate(
        ({ seat, eye }) => window.__md.lookQuat([seat.x, eye, seat.z], [seat.desk.center[0], eye - 0.25, seat.desk.center[2]]),
        { seat, eye: SEATED_EYE },
      );
      await rc(page, 'set_transform', { device: 'headset', position: { x: seat.x, y: SEATED_EYE, z: seat.z }, orientation: { x: q[0], y: q[1], z: q[2], w: q[3] } });
      await page.waitForTimeout(300);
      await page.evaluate(() => window.__md.fire('set:relayout'));
      await page.waitForTimeout(1500);
      seated = await snapshot(page);
      seated.seat = { x: Math.round(seat.x * 100) / 100, z: Math.round(seat.z * 100) / 100 };
      await shoot(page, seated, `${outDir}/room-${room}-seated.png`);
    }
    const errors = logs.filter((l) => /\[(error|pageerror)\]/.test(l) && !/CORS|ERR_FAILED/.test(l));
    results.push({ room, enterMs, standing, seated, errors });
    const brief = (r) => r && `${r.layout.table}/${r.layout.facingWall}/${r.layout.sideWall} edge=${r.layout.tableDistance} wall=${r.layout.facingWallDistance}`;
    console.log(room, '| origin:', brief(standing), '| seated:', brief(seated), '| errors', errors.length);
  } catch (e) {
    results.push({ room, error: String(e) });
    console.log(room, 'FAILED', String(e));
  }
  await browser.close();
}
writeFileSync(`${outDir}/rooms.json`, JSON.stringify(results, null, 2));
