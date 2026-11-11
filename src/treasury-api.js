// Plain JS so the snapshot tool (Node) and the app (Vite) share one fetcher.
// Rows are compacted to arrays: flows [date, 'D'|'W', category, millions],
// balances [date, closingBalanceMillions].
const BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts';

async function getJson(url, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Treasury API ${res.status}`);
  return res.json();
}

export async function fetchRows(since, fetchImpl = fetch) {
  const flowUrl =
    `${BASE}/deposits_withdrawals_operating_cash?filter=record_date:gte:${since}` +
    '&fields=record_date,transaction_type,transaction_catg,transaction_today_amt&page%5Bsize%5D=10000&sort=-record_date';
  const balUrl =
    `${BASE}/operating_cash_balance?filter=record_date:gte:${since}` +
    '&fields=record_date,account_type,open_today_bal&page%5Bsize%5D=1000&sort=-record_date';
  const [flowJson, balJson] = await Promise.all([getJson(flowUrl, fetchImpl), getJson(balUrl, fetchImpl)]);
  const flows = [];
  for (const r of flowJson.data) {
    // The API reports each day's total as a row whose category is the string "null".
    if (r.transaction_catg === 'null' || r.transaction_today_amt === 'null') continue;
    flows.push([r.record_date, r.transaction_type === 'Deposits' ? 'D' : 'W', r.transaction_catg, Number(r.transaction_today_amt)]);
  }
  const balances = [];
  for (const r of balJson.data) {
    if (/Closing Balance/i.test(r.account_type) && r.open_today_bal !== 'null') {
      balances.push([r.record_date, Number(r.open_today_bal)]);
    }
  }
  return { flows, balances };
}
