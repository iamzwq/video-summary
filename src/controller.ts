import { getCached, setCached } from './cache';
import { summarize } from './llm';
import { getSettings, isConfigured } from './settings';
import { cuesToLines, pickDefaultTrack, trackLabel } from './subtitle';
import type { SiteAdapter, TrackList } from './types';
import { Panel } from './ui/panel';
import { createUiRoot } from './ui/root';
import { errorMessage, isAbortError } from './utils';

function isDarkPage(): boolean {
  if (document.documentElement.hasAttribute('dark')) return true;
  const bg = getComputedStyle(document.body ?? document.documentElement).backgroundColor;
  const parts = bg.match(/[\d.]+/g)?.map(Number);
  if (!parts || parts.length < 3 || parts[3] === 0) return false;
  return 0.299 * parts[0] + 0.587 * parts[1] + 0.114 * parts[2] < 128;
}

export class Controller {
  private panel: Panel | null = null;
  private abort: AbortController | null = null;
  private runningKey: string | null = null;
  private needsConfig = false;
  private readonly trackLists = new Map<string, Promise<TrackList>>();
  private readonly selectedTrack = new Map<string, string>();

  constructor(private readonly adapter: SiteAdapter) {}

  private ensurePanel(): Panel {
    this.panel ??= new Panel(createUiRoot(), {
      onGenerate: (force) => this.run({ force }),
      onTrackChange: (trackId) => this.run({ trackId }),
      onStop: () => this.stop(),
      onSeek: (seconds) => {
        const video = this.adapter.getVideo();
        if (!video) return;
        video.currentTime = seconds;
        video.play?.()?.catch?.(() => {});
      },
      onSettingsSaved: () => {
        if (this.needsConfig) {
          this.needsConfig = false;
          this.run();
        }
      },
    });
    this.panel.open(isDarkPage());
    return this.panel;
  }

  openSettings(): void {
    this.ensurePanel().showSettings();
  }

  onVideoChange(key: string | null): void {
    this.cancel();
    if (!this.panel?.isOpen) return;
    if (!key) {
      this.panel.close();
      return;
    }
    this.panel.setTracks([], '');
    this.panel.setStatus(null);
    this.panel.showIdle();
  }

  private cancel(): void {
    const ac = this.abort;
    this.abort = null;
    this.runningKey = null;
    ac?.abort();
    this.panel?.setRunning(false);
  }

  private stop(): void {
    this.cancel();
    this.panel?.setStatus('已停止');
  }

  private getTrackList(key: string): Promise<TrackList> {
    let list = this.trackLists.get(key);
    if (!list) {
      list = this.adapter.getTracks();
      this.trackLists.set(key, list);
      list.then(
        (l) => !l.tracks.length && this.trackLists.delete(key),
        () => this.trackLists.delete(key),
      );
    }
    return list;
  }

  async run(opts: { force?: boolean; trackId?: string } = {}): Promise<void> {
    const key = this.adapter.getVideoKey();
    if (!key) return;
    const panel = this.ensurePanel();
    if (!opts.force && !opts.trackId && this.runningKey === key) return;

    this.cancel();
    const ac = new AbortController();
    this.abort = ac;
    this.runningKey = key;
    const alive = () => this.abort === ac && this.adapter.getVideoKey() === key;
    panel.setRunning(true);

    try {
      panel.setStatus('正在获取字幕列表…', true);
      const list = await this.getTrackList(key);
      if (!alive()) return;
      if (!list.tracks.length) {
        panel.setTracks([], '');
        panel.setStatus(null);
        panel.showMessage(list.emptyHint ?? '该视频没有可用字幕，无法生成总结。', 'error');
        return;
      }

      const wanted = opts.trackId ?? this.selectedTrack.get(key);
      const track = list.tracks.find((t) => t.id === wanted) ?? pickDefaultTrack(list.tracks, list.originalLang);
      this.selectedTrack.set(key, track.id);
      panel.setTracks(list.tracks, track.id);

      const cacheKey = `${key}|${track.id}`;
      const cached = opts.force ? undefined : getCached(cacheKey);
      if (cached) {
        panel.showMarkdown(cached.md);
        panel.setStatus(`已缓存（${new Date(cached.t).toLocaleString()}），可点击右上角重新生成`);
        return;
      }

      const settings = getSettings();
      if (!isConfigured(settings)) {
        this.needsConfig = true;
        panel.setStatus(null);
        panel.showSettings('请先配置 OpenAI 兼容接口的 Base URL、API Key 和模型，保存后将自动开始生成总结。');
        return;
      }

      panel.setStatus(`正在加载字幕（${trackLabel(track)}）…`, true);
      panel.showMarkdown('');
      const cues = await track.load();
      if (!alive()) return;
      const lines = cuesToLines(cues);
      if (!lines.length) throw new Error('字幕内容为空');

      const md = await summarize({
        title: this.adapter.getTitle(),
        lines,
        settings,
        signal: ac.signal,
        onStatus: (text) => alive() && panel.setStatus(text, true),
      });
      if (!alive()) return;
      panel.showMarkdown(md);
      setCached(cacheKey, md);
      panel.setStatus(`已完成 · ${trackLabel(track)}`);
    } catch (e) {
      if (!alive() || isAbortError(e)) return;
      panel.setStatus(null);
      panel.showMessage(errorMessage(e), 'error', { label: '重试', onClick: () => this.run({ force: true }) });
    } finally {
      if (this.abort === ac) {
        this.abort = null;
        this.runningKey = null;
        panel.setRunning(false);
      }
    }
  }
}
