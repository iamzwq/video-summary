import { unsafeWindow } from '$';

export interface CapturedTimedtext {
  url: string;
  text?: string;
  at: number;
}

const captured = new Map<string, CapturedTimedtext>();

export function getCaptured(videoId: string): CapturedTimedtext | undefined {
  return captured.get(videoId);
}

function record(rawUrl: string, text?: string) {
  if (!rawUrl.includes('/api/timedtext')) return;
  let url: URL;
  try {
    url = new URL(rawUrl, location.origin);
  } catch {
    return;
  }
  const videoId = url.searchParams.get('v');
  if (!videoId) return;
  const prev = captured.get(videoId);
  // Only URLs issued by the player carry the PO token (`pot`); never downgrade to one without it.
  if (prev?.url.includes('pot=') && !url.searchParams.has('pot')) return;
  captured.set(videoId, {
    url: url.href,
    text: text ?? (prev?.url === url.href ? prev.text : undefined),
    at: Date.now(),
  });
}

/**
 * Captures the player's own timedtext requests (which carry the PO token), following kiss-translator.
 * The resource timing observer works from any script world; the XHR/fetch hooks additionally
 * capture the response body when the script shares the page world.
 */
export function installTimedtextInterceptor(): void {
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record(entry.name);
    }).observe({ type: 'resource', buffered: true });
  } catch {
    // PerformanceObserver unavailable.
  }

  const win = unsafeWindow as typeof window;
  try {
    const proto = win.XMLHttpRequest.prototype;
    const originalOpen = proto.open;
    proto.open = function (this: XMLHttpRequest, ...args: unknown[]) {
      const url = String(args[1] ?? '');
      if (url.includes('/api/timedtext')) {
        this.addEventListener('load', () => {
          try {
            record(this.responseURL || url, this.responseText);
          } catch {
            record(this.responseURL || url);
          }
        });
      }
      return (originalOpen as (...a: unknown[]) => void).apply(this, args);
    } as typeof proto.open;
  } catch {
    // Page world not reachable.
  }

  try {
    const originalFetch = win.fetch;
    win.fetch = function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
      const promise = originalFetch.call(this, input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/timedtext')) {
        promise
          .then((res) => res.clone().text())
          .then((text) => record(url, text))
          .catch(() => {});
      }
      return promise;
    } as typeof win.fetch;
  } catch {
    // Page world not reachable.
  }
}
