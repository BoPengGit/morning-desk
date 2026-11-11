// The brief's data model, built from the Daily Treasury Statement.
// Amounts are millions of dollars, exactly as the Treasury publishes them.
import { fetchRows } from './treasury-api.js';

export type Flow = [string, 'D' | 'W', string, number];

export interface Day {
  date: string;
  deposits: number;
  withdrawals: number;
  net: number;
  balance: number | null;
  dep: Map<string, number>;
  wd: Map<string, number>;
}

export interface Series {
  id: string;
  label: string;
  values: number[];
  dates: string[];
}

export interface Brief {
  days: Day[];
  source: 'live' | 'snapshot';
  fetchedAt: string;
  custom?: Series;
}

export interface Mover {
  side: 'deposits' | 'withdrawals';
  category: string;
  from: number;
  to: number;
  delta: number;
}

function build(flows: Flow[], balances: [string, number][]): Day[] {
  const byDate = new Map<string, Day>();
  for (const [date, side, cat, amt] of flows) {
    let d = byDate.get(date);
    if (!d) {
      d = { date, deposits: 0, withdrawals: 0, net: 0, balance: null, dep: new Map(), wd: new Map() };
      byDate.set(date, d);
    }
    const m = side === 'D' ? d.dep : d.wd;
    m.set(cat, (m.get(cat) ?? 0) + amt);
    if (side === 'D') d.deposits += amt;
    else d.withdrawals += amt;
  }
  for (const [date, bal] of balances) {
    const d = byDate.get(date);
    if (d) d.balance = bal;
  }
  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const d of days) d.net = d.deposits - d.withdrawals;
  return days;
}

export async function loadBrief(): Promise<Brief> {
  const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const { flows, balances } = await fetchRows(since, (u: RequestInfo | URL) => fetch(u, { signal: ctrl.signal }));
    clearTimeout(timer);
    const days = build(flows as Flow[], balances as [string, number][]);
    if (days.length >= 10) return { days, source: 'live', fetchedAt: new Date().toISOString() };
  } catch {
    // fall through to the bundled snapshot
  }
  const res = await fetch(`${import.meta.env.BASE_URL}data/snapshot.json`);
  const snap = await res.json();
  return { days: build(snap.flows, snap.balances), source: 'snapshot', fetchedAt: snap.fetchedAt };
}

/** Categories whose amount moved the most between two days, largest first. */
export function movers(prev: Day, cur: Day, limit = 3, side?: 'deposits' | 'withdrawals'): Mover[] {
  const out: Mover[] = [];
  const sides: ('deposits' | 'withdrawals')[] = side ? [side] : ['deposits', 'withdrawals'];
  for (const s of sides) {
    const a = s === 'deposits' ? prev.dep : prev.wd;
    const b = s === 'deposits' ? cur.dep : cur.wd;
    const cats = new Set([...a.keys(), ...b.keys()]);
    for (const c of cats) {
      const from = a.get(c) ?? 0;
      const to = b.get(c) ?? 0;
      if (from !== to) out.push({ side: s, category: c, from, to, delta: to - from });
    }
  }
  out.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  return out.slice(0, limit);
}

/** Top categories on one day for one side. */
export function topCategories(day: Day, side: 'deposits' | 'withdrawals', limit = 5): [string, number][] {
  const m = side === 'deposits' ? day.dep : day.wd;
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function categorySeries(days: Day[], side: 'deposits' | 'withdrawals', pattern: RegExp): Series {
  const values = days.map((d) => {
    let sum = 0;
    for (const [c, v] of side === 'deposits' ? d.dep : d.wd) if (pattern.test(c)) sum += v;
    return sum;
  });
  return { id: `${side}:${pattern.source}`, label: '', values, dates: days.map((d) => d.date) };
}

/** Parses a two-column CSV (date, value). Header row optional. */
export function parseCsv(text: string, label: string): Series | null {
  const dates: string[] = [];
  const values: number[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    if (cells.length < 2) continue;
    const v = Number(cells[1].replace(/[$\s]/g, ''));
    if (!cells[0] || Number.isNaN(v)) continue;
    dates.push(cells[0]);
    values.push(v);
  }
  if (values.length < 2) return null;
  return { id: 'custom', label, values, dates };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/** Millions in, readable dollars out: 33536 -> "$33.5B". */
export function money(millions: number, signed = false): string {
  const sign = millions < 0 ? '-' : signed ? '+' : '';
  const abs = Math.abs(millions);
  const text = abs >= 1000 ? `$${(abs / 1000).toFixed(abs >= 100000 ? 0 : 1)}B` : `$${abs.toFixed(0)}M`;
  return sign + text;
}

/** Shorter category names for small panels. */
export function shortCat(c: string): string {
  return c
    .replace(/^Dept of /, '')
    .replace(/\s*\(Table IIIB\)/, '')
    .replace(/Supp Nutrition Assist Prog/, 'Nutrition Assistance')
    .replace(/ - misc$/, '')
    .slice(0, 34);
}
