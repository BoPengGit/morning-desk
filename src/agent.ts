// The agent speaks only in actions from this schema, and the workspace runs them.
// The built-in grammar below turns a question into an action with no network,
// so every command works offline.

export type Side = 'deposits' | 'withdrawals';

export type Action =
  | { type: 'explain'; target: 'point'; direction: 'drop' | 'rise' | 'move' }
  | { type: 'compare'; range: 'last-week' }
  | { type: 'filter'; side: Side | 'net'; category: string | null; label: string }
  | { type: 'annotate' }
  | { type: 'summarize_changes' }
  | { type: 'add_panel'; side: Side; category: string; label: string };

export const ACTION_TYPES = ['add_panel', 'compare', 'filter', 'annotate', 'explain', 'summarize_changes'] as const;

/** Spoken or typed words for a category, mapped to a pattern over Treasury category names. */
const CATEGORIES: { words: RegExp; pattern: string; label: string; side?: Side }[] = [
  { words: /\b(defen[cs]e|dod|military)\b/, pattern: '(Defense|DoD)', label: 'Defense' },
  { words: /\b(medicare|medicaid|hhs|health)\b/, pattern: '(HHS|Medicare|Medicaid)', label: 'Health and Human Services' },
  { words: /\b(social security|ssa)\b/, pattern: '(SSA|Social Security)', label: 'Social Security' },
  { words: /\b(tax(es)?|irs)\b/, pattern: '^Taxes', label: 'Taxes' },
  { words: /\b(veterans?|va)\b/, pattern: '(Veterans|^VA )', label: 'Veterans Affairs' },
  { words: /\b(education|student)\b/, pattern: 'Education', label: 'Education' },
  { words: /\b(debt|treasury securities|borrowing)\b/, pattern: 'Public Debt', label: 'Public debt' },
  { words: /\b(agriculture|usda|snap|food)\b/, pattern: '(USDA|Agriculture)', label: 'Agriculture' },
  { words: /\b(salar(y|ies)|payroll)\b/, pattern: 'Salaries', label: 'Federal salaries', side: 'withdrawals' },
];

function sideOf(t: string): Side | null {
  if (/\b(deposit|deposits|income|receipts?|in(flow)?s?)\b/.test(t)) return 'deposits';
  if (/\b(withdrawals?|spending|outflows?|payments?|out)\b/.test(t)) return 'withdrawals';
  return null;
}

function categoryOf(t: string) {
  return CATEGORIES.find((c) => c.words.test(t)) ?? null;
}

/** Returns the action for a question, or null when the grammar has no match. */
export function parse(input: string): Action | null {
  const t = input.toLowerCase().replace(/[?.!,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return null;

  if (/\bwhy\b/.test(t) || /\bexplain\b/.test(t) || /\bwhat (happened|caused)\b/.test(t)) {
    const direction = /\b(drop|dropped|fall|fell|down|lower|dip|decrease|decline)\b/.test(t)
      ? 'drop'
      : /\b(rise|rose|jump|jumped|up|higher|spike|increase)\b/.test(t)
        ? 'rise'
        : 'move';
    return { type: 'explain', target: 'point', direction };
  }
  if (/\bcompare\b/.test(t) || /\b(last|previous|prior) week\b/.test(t)) {
    return { type: 'compare', range: 'last-week' };
  }
  if (/\b(pin|note|remember|save this)\b/.test(t)) return { type: 'annotate' };
  if (/\b(what changed|changes|since yesterday|summar(y|ize|ise)|brief me|overnight)\b/.test(t)) {
    return { type: 'summarize_changes' };
  }
  const cat = categoryOf(t);
  if (/\b(add|new|open) (a )?(panel|tile)\b/.test(t) || /\badd\b/.test(t)) {
    if (cat) return { type: 'add_panel', side: cat.side ?? sideOf(t) ?? 'withdrawals', category: cat.pattern, label: cat.label };
  }
  if (/\b(show|only|just|filter|focus)\b/.test(t)) {
    if (/\b(all|everything|reset|net)\b/.test(t)) return { type: 'filter', side: 'net', category: null, label: 'Net cash flow' };
    if (cat) return { type: 'filter', side: cat.side ?? sideOf(t) ?? 'withdrawals', category: cat.pattern, label: cat.label };
    const side = sideOf(t);
    if (side) return { type: 'filter', side, category: null, label: side === 'deposits' ? 'Deposits' : 'Withdrawals' };
  }
  return null;
}

/** The questions on the question card, in order. Each one parses to an action. */
export const CARD_QUESTIONS = [
  'Why did this drop?',
  'What changed since yesterday?',
  'Compare with last week',
  'Show only defense spending',
  'Pin a note here',
] as const;
