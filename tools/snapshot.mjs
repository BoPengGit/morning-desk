// Refreshes public/data/snapshot.json, the bundled copy of the Daily Treasury
// Statement that the app falls back to when the live API cannot be reached.
// Usage: node tools/snapshot.mjs [days]
import { writeFileSync } from 'node:fs';
import { fetchRows } from '../src/treasury-api.js';

const days = Number(process.argv[2] ?? 45);
const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const { flows, balances } = await fetchRows(since, fetch);
const snapshot = { source: 'api.fiscaldata.treasury.gov', fetchedAt: new Date().toISOString(), since, flows, balances };
writeFileSync(new URL('../public/data/snapshot.json', import.meta.url), JSON.stringify(snapshot));
const dates = [...new Set(flows.map((r) => r[0]))].sort();
console.log(`snapshot: ${flows.length} flow rows, ${balances.length} balance rows, ${dates.length} days, newest ${dates.at(-1)}`);
