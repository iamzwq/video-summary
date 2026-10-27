import { GM_getValue, GM_setValue } from '$';

interface Entry {
  md: string;
  t: number;
}

const KEY = 'summaryCache';
const MAX = 50;

export function getCached(key: string): Entry | undefined {
  return GM_getValue<Record<string, Entry>>(KEY, {})[key];
}

export function setCached(key: string, md: string): void {
  const all = GM_getValue<Record<string, Entry>>(KEY, {});
  all[key] = { md, t: Date.now() };
  const stale = Object.keys(all)
    .sort((a, b) => all[b].t - all[a].t)
    .slice(MAX);
  for (const k of stale) delete all[k];
  GM_setValue(KEY, all);
}
