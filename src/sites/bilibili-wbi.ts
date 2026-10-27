import { fetchJson } from '../utils';

// https://socialsisteryi.github.io/bilibili-API-collect/docs/misc/sign/wbi.html
const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41,
  13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34,
  44, 52,
];

let mixinCache: { key: string; time: number } | null = null;

async function getMixinKey(): Promise<string> {
  if (mixinCache && Date.now() - mixinCache.time < 10 * 60 * 1000) return mixinCache.key;
  const json = await fetchJson('https://api.bilibili.com/x/web-interface/nav');
  const { img_url, sub_url } = json?.data?.wbi_img ?? {};
  if (!img_url || !sub_url) throw new Error('WBI key unavailable');
  const name = (url: string) => url.slice(url.lastIndexOf('/') + 1).split('.')[0];
  const orig = name(img_url) + name(sub_url);
  const key = MIXIN_KEY_ENC_TAB.map((i) => orig[i]).join('').slice(0, 32);
  mixinCache = { key, time: Date.now() };
  return key;
}

export async function signWbi(params: Record<string, string | number>): Promise<string> {
  const mixinKey = await getMixinKey();
  const all: Record<string, string | number> = { ...params, wts: Math.round(Date.now() / 1000) };
  const query = Object.keys(all)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(all[k]).replace(/[!'()*]/g, ''))}`)
    .join('&');
  return `${query}&w_rid=${md5(query + mixinKey)}`;
}

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4,
  11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const len = bytes.length;
  const blocks = ((len + 8) >>> 6) + 1;
  const words = new Uint32Array(blocks * 16);
  for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  words[blocks * 16 - 2] = (len * 8) >>> 0;
  words[blocks * 16 - 1] = Math.floor(len / 0x20000000);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  for (let off = 0; off < words.length; off += 16) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + K[i] + words[off + g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << S[i]) | (f >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0]
    .map((n) =>
      Array.from({ length: 4 }, (_, i) =>
        ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0'),
      ).join(''),
    )
    .join('');
}
