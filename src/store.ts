// Everything Morning Desk remembers lives in this browser's localStorage:
// settings, the saved layout, pinned notes, tasks, visits and onboarding.
const KEY = 'morning-desk.v1';

export interface Settings {
  highContrast: boolean;
  captions: boolean;
  oneHanded: boolean;
  sound: boolean;
}

export interface SavedPose {
  surface: 'table' | 'facing-wall' | 'side-wall' | 'tray' | 'curved' | 'free';
  /** Offset from the surface frame origin, in that frame's local axes. */
  offset: [number, number, number];
  scale: number;
}

export interface Visit {
  day: string; // local calendar day
  dataDate: string;
  deposits: number;
  withdrawals: number;
  balance: number | null;
}

export interface Note {
  id: string;
  text: string;
  date: string;
}

export interface State {
  settings: Settings;
  layout: Record<string, SavedPose>;
  notes: Note[];
  tasks: { text: string; done: boolean }[];
  visits: Visit[];
  onboarded: boolean;
  onboardSeconds: number | null;
}

const DEFAULT_TASKS = [
  'Check the overnight cash position',
  'Flag any net outflow over $20B',
  'Send the morning note',
];

function fresh(): State {
  return {
    settings: { highContrast: false, captions: true, oneHanded: false, sound: true },
    layout: {},
    notes: [],
    tasks: DEFAULT_TASKS.map((text) => ({ text, done: false })),
    visits: [],
    onboarded: false,
    onboardSeconds: null,
  };
}

export const state: State = (() => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) } as State;
  } catch {
    // private mode or corrupt value: start fresh
  }
  return fresh();
})();

export function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage full or blocked; the session still works
  }
}

export function localDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Records today's visit once and returns the previous visit on an earlier day. */
export function recordVisit(v: Visit): Visit | undefined {
  const prev = [...state.visits].reverse().find((x) => x.day !== v.day);
  const existing = state.visits.findIndex((x) => x.day === v.day);
  if (existing >= 0) state.visits[existing] = v;
  else state.visits.push(v);
  state.visits = state.visits.slice(-60);
  save();
  return prev;
}

/** Consecutive calendar days with a visit, ending today. */
export function streak(today = localDay()): number {
  const days = new Set(state.visits.map((v) => v.day));
  let n = 0;
  const d = new Date(`${today}T12:00:00`);
  while (days.has(localDay(d))) {
    n += 1;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function resetAll(): void {
  localStorage.removeItem(KEY);
  Object.assign(state, fresh());
}
