import type { Cue, Track } from './types';
import { formatTime } from './utils';

const baseLang = (lang?: string) => (lang ?? '').toLowerCase().replace('_', '-').split('-')[0];

/** Manual before auto; within each kind: original language > zh > en > others. */
export function pickDefaultTrack(tracks: Track[], originalLang?: string): Track {
  const orig = baseLang(originalLang);
  const rank = (t: Track) => {
    const lang = baseLang(t.lang);
    if (orig && lang === orig) return 0;
    if (lang === 'zh') return 1;
    if (lang === 'en') return 2;
    return 3;
  };
  return tracks
    .map((track, index) => ({ track, index }))
    .sort((a, b) => Number(a.track.isAuto) - Number(b.track.isAuto) || rank(a.track) - rank(b.track) || a.index - b.index)[0]
    .track;
}

export function cuesToSrt(cues: Cue[]): string {
  const ts = (sec: number) => {
    const ms = Math.max(0, Math.round(sec * 1000));
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
  };
  return [...cues]
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text.trim()}\n`)
    .join('\n');
}

export function trackLabel(track: Track): string {
  return `${track.isAuto ? '自动生成' : '手动字幕'} · ${track.label}`;
}

const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;

export function estimateTokens(text: string): number {
  const cjk = text.match(CJK)?.length ?? 0;
  return cjk + Math.ceil((text.length - cjk) / 4);
}

/** Merges short cues into timestamped lines and drops consecutive duplicates. */
export function cuesToLines(cues: Cue[]): string[] {
  const lines: string[] = [];
  let start = 0;
  let buf: string[] = [];
  let size = 0;
  let prev = '';
  const flush = () => {
    if (buf.length) lines.push(`[${formatTime(start)}] ${buf.join(' ')}`);
    buf = [];
    size = 0;
  };
  for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
    const text = cue.text.replace(/\s+/g, ' ').trim();
    if (!text || text === prev) continue;
    prev = text;
    if (!buf.length) start = cue.start;
    buf.push(text);
    size += text.length;
    if (size >= 150 || cue.end - start >= 30) flush();
  }
  flush();
  return lines;
}

export function chunkLines(lines: string[], budget: number): string[] {
  const chunks: string[] = [];
  let cur: string[] = [];
  let tokens = 0;
  for (const line of lines) {
    const t = estimateTokens(line) + 1;
    if (cur.length && tokens + t > budget) {
      chunks.push(cur.join('\n'));
      cur = [];
      tokens = 0;
    }
    cur.push(line);
    tokens += t;
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks;
}
