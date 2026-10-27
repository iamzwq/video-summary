export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function waitFor<T>(
  fn: () => T | null | undefined | false,
  timeout = 5000,
  interval = 200,
): Promise<T | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() >= end) return null;
    await sleep(interval);
  }
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

export function parseTime(text: string): number {
  return text.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

export async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}
