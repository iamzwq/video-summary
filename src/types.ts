export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface Track {
  id: string;
  lang: string;
  label: string;
  isAuto: boolean;
  load(): Promise<Cue[]>;
}

export interface TrackList {
  tracks: Track[];
  /** Spoken language of the video, used to rank tracks. */
  originalLang?: string;
  /** Shown when `tracks` is empty. */
  emptyHint?: string;
}

export type SiteName = 'bilibili' | 'youtube';

export interface SiteAdapter {
  site: SiteName;
  /** Runs at document-start. */
  setup(): void;
  /** Stable id of the current video, or null when not on a video page. */
  getVideoKey(): string | null;
  getTitle(): string;
  /** Ensures the entry button sits inside the toolbar; returns false if the toolbar is not ready. */
  mountButton(btn: HTMLElement): boolean;
  getTracks(): Promise<TrackList>;
  getVideo(): HTMLVideoElement | null;
}
