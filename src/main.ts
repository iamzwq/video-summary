import { GM_registerMenuCommand } from '$';
import { Controller } from './controller';
import { bilibili } from './sites/bilibili';
import { youtube } from './sites/youtube';
import { createSiteButton } from './ui/button';

const adapter = location.hostname.endsWith('bilibili.com') ? bilibili : youtube;
adapter.setup();

const controller = new Controller(adapter);
GM_registerMenuCommand('生成视频总结', () => controller.run());
GM_registerMenuCommand('视频总结设置', () => controller.openSettings());

let button: HTMLElement | null = null;
let lastKey: string | null | undefined;

// Both sites are SPAs that re-render the toolbar; poll cheaply to follow navigation and re-mount.
function tick() {
  const key = adapter.getVideoKey();
  if (key !== lastKey) {
    lastKey = key;
    controller.onVideoChange(key);
  }
  if (!key) {
    button?.remove();
    return;
  }
  button ??= createSiteButton(adapter.site, () => controller.run());
  adapter.mountButton(button);
}

setInterval(tick, 800);
window.addEventListener('yt-navigate-finish', tick);
window.addEventListener('popstate', tick);
document.addEventListener('DOMContentLoaded', tick);
