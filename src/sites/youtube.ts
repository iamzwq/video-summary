import { unsafeWindow } from '$';
import type { Cue, SiteAdapter, Track, TrackList } from '../types';
import { parseTime, sleep, waitFor } from '../utils';
import { type CapturedTimedtext, getCaptured, installTimedtextInterceptor } from './youtube-intercept';

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  vssId?: string;
  name?: { simpleText?: string; runs?: { text: string }[] };
}

function currentVideoId(): string | null {
  if (location.pathname !== '/watch') return null;
  return new URLSearchParams(location.search).get('v');
}

/** Extracts the object literal assigned after `marker`, tolerating braces inside strings. */
function extractJson(source: string, marker: RegExp): any {
  const m = marker.exec(source);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try {
        return JSON.parse(source.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function getPlayerResponse(videoId: string): Promise<any> {
  try {
    const player = unsafeWindow.document.getElementById('movie_player') as any;
    const resp = player?.getPlayerResponse?.();
    if (resp?.videoDetails?.videoId === videoId) return resp;
  } catch {
    // Player API not reachable from this script world.
  }
  // The global is stale after SPA navigation, so re-read it from a fresh watch page.
  const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, { credentials: 'include' });
  const resp = extractJson(await res.text(), /ytInitialPlayerResponse\s*=\s*\{/);
  if (resp?.videoDetails?.videoId && resp.videoDetails.videoId !== videoId) return null;
  return resp;
}

function parseJson3(data: any): Cue[] {
  const cues: Cue[] = [];
  for (const event of data?.events ?? []) {
    if (!event.segs) continue;
    const text = (event.segs as { utf8?: string }[])
      .map((seg) => seg.utf8 ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    const start = (event.tStartMs ?? 0) / 1000;
    cues.push({ start, end: start + (event.dDurationMs ?? 0) / 1000, text });
  }
  return cues;
}

function parseJson3Text(text: string | undefined): Cue[] {
  if (!text?.trim()) return [];
  try {
    return parseJson3(JSON.parse(text));
  } catch {
    return [];
  }
}

async function fetchJson3(url: URL): Promise<Cue[]> {
  url.searchParams.set('fmt', 'json3');
  try {
    const res = await fetch(url.href, { credentials: 'include' });
    if (!res.ok) return [];
    return parseJson3Text(await res.text());
  } catch {
    return [];
  }
}

/** Reuses the player's PO-token URL, switching only the track parameters. */
async function loadViaCaptured(cap: CapturedTimedtext, track: CaptionTrack): Promise<Cue[]> {
  const url = new URL(cap.url);
  const p = url.searchParams;
  const sameTrack =
    !p.get('tlang') && p.get('lang') === track.languageCode && (p.get('kind') ?? '') === (track.kind ?? '');
  if (sameTrack) {
    const cues = parseJson3Text(cap.text);
    if (cues.length) return cues;
  }
  p.delete('tlang');
  p.delete('name');
  p.set('lang', track.languageCode);
  if (track.kind) p.set('kind', track.kind);
  else p.delete('kind');
  return fetchJson3(url);
}

/** Toggles CC so the player issues a timedtext request carrying a fresh PO token. */
async function triggerCaptions(videoId: string): Promise<CapturedTimedtext | null> {
  const btn = document.querySelector<HTMLElement>('#movie_player .ytp-subtitles-button');
  if (!btn || getComputedStyle(btn).display === 'none') return null;
  const since = Date.now();
  const wasOn = btn.getAttribute('aria-pressed') === 'true';
  if (wasOn) {
    btn.click();
    await sleep(300);
  }
  btn.click();
  const got = await waitFor(() => {
    const cap = getCaptured(videoId);
    return cap && cap.at >= since ? cap : null;
  }, 6000);
  if (!wasOn && btn.getAttribute('aria-pressed') === 'true') btn.click();
  return got;
}

const SEGMENT_SELECTOR = 'ytd-transcript-segment-renderer, transcript-segment-view-model';

/** Last resort: read the "Show transcript" panel (always the player's default track). */
async function readTranscriptPanel(): Promise<Cue[]> {
  if (!document.querySelector(SEGMENT_SELECTOR)) {
    const btn = document.querySelector<HTMLElement>('ytd-video-description-transcript-section-renderer button');
    if (!btn) return [];
    btn.click();
    await waitFor(() => document.querySelector(SEGMENT_SELECTOR), 8000);
  }
  const cues: Cue[] = [];
  for (const seg of document.querySelectorAll<HTMLElement>(SEGMENT_SELECTOR)) {
    const all = seg.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const ts = /(?:\d+:)?\d{1,2}:\d{2}/.exec(all);
    if (!ts) continue;
    const text = all.replace(ts[0], '').trim();
    if (text) cues.push({ start: parseTime(ts[0]), end: parseTime(ts[0]), text });
  }
  return cues;
}

async function loadTrack(videoId: string, track: CaptionTrack): Promise<Cue[]> {
  let cap = getCaptured(videoId);
  if (cap) {
    const cues = await loadViaCaptured(cap, track);
    if (cues.length) return cues;
  }

  const direct = await fetchJson3(new URL(track.baseUrl, location.origin));
  if (direct.length) return direct;

  cap = (await triggerCaptions(videoId)) ?? undefined;
  if (cap) {
    const cues = await loadViaCaptured(cap, track);
    if (cues.length) return cues;
  }

  const transcript = await readTranscriptPanel();
  if (transcript.length) return transcript;
  throw new Error('无法获取 YouTube 字幕。可尝试先手动开启一次播放器字幕（CC）后重试。');
}

function trackName(track: CaptionTrack): string {
  return track.name?.simpleText ?? track.name?.runs?.map((r) => r.text).join('') ?? track.languageCode;
}

export const youtube: SiteAdapter = {
  site: 'youtube',

  setup() {
    installTimedtextInterceptor();
  },

  getVideoKey() {
    const id = currentVideoId();
    return id ? `yt:${id}` : null;
  },

  getTitle() {
    return (
      document.querySelector('ytd-watch-metadata h1')?.textContent?.trim() ||
      document.title.replace(/ - YouTube$/, '')
    );
  },

  mountButton(btn) {
    const container =
      document.querySelector('ytd-watch-metadata #top-level-buttons-computed') ??
      document.querySelector('#top-level-buttons-computed');
    if (!container) return false;
    if (btn.parentElement !== container) container.append(btn);
    return true;
  },

  async getTracks(): Promise<TrackList> {
    const videoId = currentVideoId();
    if (!videoId) throw new Error('当前页面不是视频页');
    const resp = await getPlayerResponse(videoId);
    const raw: CaptionTrack[] = (resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).filter(
      (t: CaptionTrack) => !/live chat/i.test(trackName(t)),
    );
    const tracks: Track[] = raw.map((t) => ({
      id: `${t.vssId ?? t.languageCode}|${t.kind ?? ''}`,
      lang: t.languageCode,
      label: trackName(t),
      isAuto: t.kind === 'asr',
      load: () => loadTrack(videoId, t),
    }));
    return {
      tracks,
      // ASR tracks are recognized from the audio, so their language is the spoken one.
      originalLang: raw.find((t) => t.kind === 'asr')?.languageCode,
      emptyHint: '该视频没有可用字幕（包括自动生成字幕），无法生成总结。',
    };
  },

  getVideo() {
    return document.querySelector<HTMLVideoElement>('#movie_player video.html5-main-video') ?? document.querySelector('video');
  },
};
