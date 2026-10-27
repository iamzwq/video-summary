import { GM_addStyle } from '$';
import { h, icon, ICONS } from '../dom';
import type { SiteName } from '../types';

const BUTTON_CSS = `
.vs-entry .video-toolbar-left-item { width: auto !important; }
.vs-bili-btn { display: flex; align-items: center; cursor: pointer; user-select: none; transition: color .2s; }
.vs-bili-btn:hover { color: #00aeec; }
.vs-bili-btn svg { width: 28px; height: 28px; margin-right: 8px; flex-shrink: 0; }
.vs-yt-btn {
  display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
  height: 36px; padding: 0 16px; margin-left: 8px; border: none; border-radius: 18px;
  background: var(--yt-spec-additive-background, rgba(0,0,0,.05)); color: var(--yt-spec-text-primary, #0f0f0f);
  font-family: Roboto, Arial, sans-serif; font-size: 14px; font-weight: 500; white-space: nowrap; cursor: pointer;
}
.vs-yt-btn:hover { background: var(--yt-spec-mono-tonal-hover, rgba(0,0,0,.1)); }
.vs-yt-btn svg { width: 20px; height: 20px; }
`;

let styled = false;

export function createSiteButton(site: SiteName, onClick: () => void): HTMLElement {
  if (!styled) {
    GM_addStyle(BUTTON_CSS);
    styled = true;
  }
  const title = '获取视频字幕并用 AI 生成中文总结';
  const handle = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  };
  if (site === 'bilibili') {
    return h(
      'div',
      { class: 'toolbar-left-item-wrap vs-entry' },
      h(
        'div',
        { class: 'video-toolbar-left-item vs-bili-btn', title, onclick: handle },
        icon(ICONS.summary, 28, 'video-toolbar-item-icon'),
        h('span', { class: 'video-toolbar-item-text' }, '视频总结'),
      ),
    );
  }
  return h(
    'button',
    { class: 'vs-entry vs-yt-btn', type: 'button', title, onclick: handle },
    icon(ICONS.summary, 20),
    h('span', {}, '视频总结'),
  );
}
