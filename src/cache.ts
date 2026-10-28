import { GM_getValue, GM_setValue } from '$';

interface Entry {
  md: string;
  t: number;
}

const KEY = 'summaryCache';

export function getCached(key: string, max: number): Entry | undefined {
  if (max <= 0) return undefined;
  return GM_getValue<Record<string, Entry>>(KEY, {})[key];
}

/** Keeps the newest `max` entries; `max <= 0` clears the cache. */
export function setCached(key: string, md: string, max: number): void {
  const all = GM_getValue<Record<string, Entry>>(KEY, {});
  all[key] = { md, t: Date.now() };
  const stale = Object.keys(all)
    .sort((a, b) => all[b].t - all[a].t)
    .slice(Math.max(0, max));
  for (const k of stale) delete all[k];
  GM_setValue(KEY, all);
}
