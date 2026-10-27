import css from './styles.css?inline';

const HOST_STYLE: Record<string, string> = {
  all: 'initial',
  position: 'fixed',
  top: '0',
  left: '0',
  width: '0',
  height: '0',
  overflow: 'visible',
  'z-index': '2147483646',
  'pointer-events': 'none',
};

/** Closed shadow root for the panel; styles go through CSSOM so a strict CSP cannot block them. */
export function createUiRoot(): ShadowRoot {
  const host = document.createElement('video-summary-ui');
  for (const [prop, value] of Object.entries(HOST_STYLE)) {
    host.style.setProperty(prop, value, 'important');
  }
  const shadow = host.attachShadow({ mode: 'closed' });

  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement('style');
    style.textContent = css;
    shadow.append(style);
  }

  const mount = () => {
    if (!host.isConnected) document.documentElement.append(host);
  };
  mount();
  new MutationObserver(mount).observe(document.documentElement, { childList: true });
  return shadow;
}
