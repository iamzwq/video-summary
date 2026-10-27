import { unsafeWindow } from '$';
import type { Cue, SiteAdapter, Track, TrackList } from '../types';
import { fetchJson, sleep } from '../utils';
import { signWbi } from './bilibili-wbi';

// Covers /video/BV… and localized paths such as /zh-Hans/video/BV…
const VIDEO_PATH = /^\/(?:[\w-]+\/)?video\/(BV[0-9A-Za-z]{10}|av\d+)/i;
const TOOLBAR_SELECTORS = ['.video-toolbar-left-main', '.video-toolbar-left', '.toolbar-left'];

interface BiliSubtitle {
  id?: number;
  id_str?: string;
  lan: string;
  lan_doc?: string;
  subtitle_url?: string;
  ai_type?: number;
  type?: number;
}

interface VideoRef {
  id: string;
  p: number;
}

function parseLocation(): VideoRef | null {
  const m = VIDEO_PATH.exec(location.pathname);
  if (!m) return null;
  const p = Number(new URLSearchParams(location.search).get('p'));
  return { id: m[1], p: p >= 1 ? p : 1 };
}

let lastTitle = '';
let hydrated = false;

// Touching SSR markup before Vue hydrates makes it re-render #app, which wipes the separately mounted #biliMainHeader.
function isHydrated(): boolean {
  if (hydrated) return true;
  if (document.readyState !== 'complete') return false;
  const app = unsafeWindow.document.querySelector('#app') as any;
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const sinceLoad = nav?.loadEventEnd ? performance.now() - nav.loadEventEnd : 0;
  hydrated = Boolean(app?.__vue__ || app?.__vue_app__) || sinceLoad > 3000;
  return hydrated;
}

async function getVideoInfo(ref: VideoRef) {
  const query = /^av/i.test(ref.id) ? `aid=${ref.id.slice(2)}` : `bvid=${ref.id}`;
  const json = await fetchJson(`https://api.bilibili.com/x/web-interface/view?${query}`);
  if (json.code !== 0) throw new Error(`获取视频信息失败：${json.message ?? json.code}`);
  const data = json.data;
  const pages: { cid: number; page: number; part?: string }[] = data.pages ?? [];
  const page = pages.find((x) => x.page === ref.p) ?? pages[0];
  lastTitle = pages.length > 1 && page?.part ? `${data.title} - ${page.part}` : data.title;
  return { aid: data.aid as number, cid: (page?.cid ?? data.cid) as number };
}

async function fetchSubtitleList(aid: number, cid: number): Promise<BiliSubtitle[]> {
  const pick = (json: any): BiliSubtitle[] => {
    // The API occasionally answers for a different video; ignore those responses.
    if (json?.code !== 0 || (json.data?.cid && json.data.cid !== cid)) return [];
    return json.data?.subtitle?.subtitles ?? [];
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const list = pick(await fetchJson(`https://api.bilibili.com/x/player/wbi/v2?${await signWbi({ aid, cid })}`));
      if (list.length) return list;
    } catch {
      // Fall through to the unsigned endpoint.
    }
    try {
      const list = pick(await fetchJson(`https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`));
      if (list.length) return list;
    } catch {
      // Retry below.
    }
    await sleep(600);
  }
  return [];
}

async function loadSubtitle(sub: BiliSubtitle): Promise<Cue[]> {
  let url = sub.subtitle_url ?? '';
  if (!url) throw new Error('无法获取该字幕的地址（B站 AI 字幕需要登录后才能获取）');
  if (url.startsWith('//')) url = `https:${url}`;
  url = url.replace(/^http:/, 'https:');
  const json = await fetchJson(url, { credentials: 'omit' });
  return ((json?.body ?? []) as { from: number; to: number; content: string }[]).map((item) => ({
    start: item.from,
    end: item.to,
    text: item.content,
  }));
}

export const bilibili: SiteAdapter = {
  site: 'bilibili',

  setup() {},

  getVideoKey() {
    const ref = parseLocation();
    return ref ? `bili:${ref.id}:p${ref.p}` : null;
  },

  getTitle() {
    return lastTitle || document.querySelector('h1.video-title, .video-title')?.textContent?.trim() || document.title;
  },

  mountButton(btn) {
    if (!isHydrated()) return false;
    for (const selector of TOOLBAR_SELECTORS) {
      const container = document.querySelector(selector);
      if (container) {
        if (btn.parentElement !== container) container.append(btn);
        return true;
      }
    }
    return false;
  },

  async getTracks(): Promise<TrackList> {
    const ref = parseLocation();
    if (!ref) throw new Error('当前页面不是视频页');
    const { aid, cid } = await getVideoInfo(ref);
    const subs = await fetchSubtitleList(aid, cid);
    const tracks: Track[] = subs.map((sub) => ({
      id: sub.id_str ?? String(sub.id ?? sub.lan),
      lang: sub.lan.replace(/^ai-/, ''),
      label: sub.lan_doc || sub.lan,
      isAuto: sub.lan.startsWith('ai-') || (sub.ai_type ?? 0) > 0 || sub.type === 1,
      load: () => loadSubtitle(sub),
    }));
    return {
      tracks,
      // AI subtitles are recognized from speech, so their language is the spoken one.
      originalLang: tracks.find((t) => t.isAuto)?.lang ?? 'zh',
      emptyHint: '该视频没有可用字幕。如果视频有 AI 字幕，请先登录 B站 后重试。',
    };
  },

  getVideo() {
    return document.querySelector<HTMLVideoElement>(
      '#bilibili-player video, #bilibili-player bwp-video, video, bwp-video',
    );
  },
};
