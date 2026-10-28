import { GM_setClipboard } from '$';
import { h, icon, ICONS } from '../dom';
import { testConnection } from '../llm';
import { renderMarkdown } from '../markdown';
import { DEFAULT_PROMPT } from '../prompt';
import { DEFAULT_SETTINGS, getSettings, saveSettings, type ReasoningEffort, type Settings, type ThinkingMode } from '../settings';
import { trackLabel } from '../subtitle';
import type { Track } from '../types';
import { errorMessage } from '../utils';

export interface PanelCallbacks {
  onGenerate(force: boolean): void;
  onTrackChange(trackId: string): void;
  onStop(): void;
  onDownload(): void;
  onSeek(seconds: number): void;
  onSettingsSaved(): void;
}

export class Panel {
  private readonly el: HTMLDivElement;
  private readonly select: HTMLSelectElement;
  private readonly status: HTMLDivElement;
  private readonly spinner: HTMLSpanElement;
  private readonly statusText: HTMLSpanElement;
  private readonly body: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly toast: HTMLDivElement;
  private md = '';
  private toastTimer = 0;

  constructor(shadow: ShadowRoot, private readonly cb: PanelCallbacks) {
    const iconBtn = (title: string, paths: string[], onClick: () => void) =>
      h('button', { class: 'vs-icon-btn', type: 'button', title, onclick: onClick }, icon(paths, 17));

    this.select = h('select', {
      class: 'vs-select',
      title: '选择字幕轨道',
      onchange: () => cb.onTrackChange(this.select.value),
    });
    this.stopBtn = h('button', { class: 'vs-btn', type: 'button', onclick: () => cb.onStop() }, icon(ICONS.stop, 14), '停止');
    this.stopBtn.hidden = true;
    this.spinner = h('span', { class: 'vs-spinner' });
    this.statusText = h('span');
    this.status = h('div', { class: 'vs-status' }, this.spinner, this.statusText);
    this.status.hidden = true;
    this.content = h('div', {
      class: 'vs-md',
      onclick: (e: Event) => {
        const link = (e.target as Element).closest?.('.vs-ts');
        if (!link) return;
        e.preventDefault();
        cb.onSeek(Number(link.getAttribute('data-t')));
      },
    });
    this.body = h('div', { class: 'vs-body' }, this.content);
    this.toast = h('div', { class: 'vs-toast' });
    this.toast.hidden = true;

    const header = h(
      'div',
      { class: 'vs-header' },
      icon(ICONS.summary, 18),
      h('span', { class: 'vs-title' }, '视频总结'),
      iconBtn('重新生成', ICONS.refresh, () => cb.onGenerate(true)),
      iconBtn('复制 Markdown', ICONS.copy, () => this.copy()),
      iconBtn('下载字幕（SRT）', ICONS.download, () => cb.onDownload()),
      iconBtn('设置', ICONS.settings, () => this.showSettings()),
      iconBtn('关闭', ICONS.close, () => this.close()),
    );

    this.el = h(
      'div',
      { class: 'vs-panel' },
      header,
      h('div', { class: 'vs-bar' }, this.select, this.stopBtn),
      this.status,
      this.body,
      this.toast,
    );
    this.el.hidden = true;
    // Keep typing inside the panel from triggering site keyboard shortcuts.
    for (const type of ['keydown', 'keyup', 'keypress']) {
      this.el.addEventListener(type, (e) => e.stopPropagation());
    }
    makeDraggable(header, this.el);
    shadow.append(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(dark: boolean): void {
    this.el.classList.toggle('dark', dark);
    this.el.hidden = false;
  }

  close(): void {
    this.el.hidden = true;
  }

  setTracks(tracks: Track[], selectedId: string): void {
    this.select.replaceChildren(
      ...(tracks.length
        ? tracks.map((t) => h('option', { value: t.id }, trackLabel(t)))
        : [h('option', { value: '' }, '无可用字幕')]),
    );
    this.select.disabled = !tracks.length;
    this.select.value = selectedId;
  }

  setStatus(text: string | null, loading = false): void {
    this.status.hidden = !text;
    this.statusText.textContent = text ?? '';
    this.spinner.hidden = !loading;
  }

  setRunning(running: boolean): void {
    this.stopBtn.hidden = !running;
  }

  showMarkdown(md: string): void {
    this.md = md;
    this.showView(this.content);
    this.content.replaceChildren(renderMarkdown(md));
    this.body.scrollTop = 0;
  }

  showMessage(text: string, kind: 'info' | 'error' = 'info', action?: { label: string; onClick: () => void }): void {
    this.md = '';
    this.content.replaceChildren(
      h(
        'div',
        { class: `vs-msg ${kind}` },
        h('div', {}, text),
        action && h('button', { class: 'vs-btn primary', type: 'button', onclick: action.onClick }, action.label),
      ),
    );
    this.showView(this.content);
  }

  showIdle(): void {
    this.showMessage('点击下方按钮，获取字幕并生成当前视频的中文总结。', 'info', {
      label: '生成总结',
      onClick: () => this.cb.onGenerate(false),
    });
  }

  showSettings(note?: string): void {
    const s = getSettings();
    const input = (type: string, value: string | number, attrs: Record<string, string> = {}) => {
      const el = h('input', { type, autocomplete: 'off', spellcheck: 'false', ...attrs });
      el.value = String(value);
      return el;
    };
    const field = (label: string, control: HTMLElement) =>
      h('label', { class: 'vs-field' }, h('span', { class: 'vs-label' }, label), control);

    const baseURL = input('text', s.baseURL, { placeholder: DEFAULT_SETTINGS.baseURL });
    const apiKey = input('password', s.apiKey, { placeholder: 'sk-...' });
    const model = input('text', s.model, { placeholder: DEFAULT_SETTINGS.model });
    const temperature = input('number', s.temperature, { min: '0', max: '2', step: '0.1' });
    const chunkTokens = input('number', s.chunkTokens, { min: '2000', step: '1000' });
    const cacheSize = input('number', s.cacheSize, { min: '0', step: '1' });
    const select = (value: string, options: [string, string][]) => {
      const el = h('select', {}, ...options.map(([v, label]) => h('option', { value: v }, label)));
      el.value = value;
      return el;
    };
    const thinking = select(s.thinking, [
      ['disabled', '关闭'],
      ['enabled', '开启'],
      ['auto', '自动（模型自行判断）'],
    ]);
    const reasoningEffort = select(s.reasoningEffort, [
      ['minimal', '最低 minimal'],
      ['low', '低 low'],
      ['medium', '中 medium'],
      ['high', '高 high'],
    ]);
    const prompt = h('textarea', { spellcheck: 'false' });
    prompt.value = s.prompt;
    const msg = h('div', { class: 'vs-form-msg' });

    const read = (): Settings => ({
      baseURL: baseURL.value.trim(),
      apiKey: apiKey.value.trim(),
      model: model.value.trim(),
      temperature: Math.min(2, Math.max(0, Number(temperature.value) || 0)),
      thinking: thinking.value as ThinkingMode,
      reasoningEffort: reasoningEffort.value as ReasoningEffort,
      chunkTokens: Math.max(2000, Number(chunkTokens.value) || DEFAULT_SETTINGS.chunkTokens),
      cacheSize:
        cacheSize.value.trim() === '' || !Number.isFinite(Number(cacheSize.value))
          ? DEFAULT_SETTINGS.cacheSize
          : Math.max(0, Math.floor(Number(cacheSize.value))),
      prompt: prompt.value.trim() || DEFAULT_PROMPT,
    });
    const setMsg = (text: string, kind: '' | 'ok' | 'error' = '') => {
      msg.className = `vs-form-msg ${kind}`;
      msg.textContent = text;
    };
    const back = () => this.showView(this.content);

    const form = h(
      'div',
      { class: 'vs-form' },
      note ? h('div', { class: 'vs-note' }, note) : null,
      field('Base URL（OpenAI 兼容接口）', baseURL),
      field('API Key', apiKey),
      h('div', { class: 'vs-row' }, field('模型', model), field('Temperature', temperature)),
      h('div', { class: 'vs-row' }, field('深度思考', thinking), field('思考程度', reasoningEffort)),
      h(
        'div',
        { class: 'vs-hint' },
        '「深度思考」发送 thinking.type（豆包 / GLM / DeepSeek 等），「思考程度」发送 reasoning_effort（OpenAI / 豆包等）。总结视频一般无需深度思考，关闭更快更省 token。',
      ),
      h(
        'div',
        { class: 'vs-row' },
        field('分段阈值（估算 token）', chunkTokens),
        field('缓存条数（0 为不缓存）', cacheSize),
      ),
      field('系统提示词', prompt),
      msg,
      h(
        'div',
        { class: 'vs-actions-row' },
        h(
          'button',
          {
            class: 'vs-btn primary',
            type: 'button',
            onclick: () => {
              saveSettings(read());
              back();
              this.flash('设置已保存');
              this.cb.onSettingsSaved();
            },
          },
          '保存',
        ),
        h(
          'button',
          {
            class: 'vs-btn',
            type: 'button',
            onclick: async () => {
              setMsg('正在测试连接…');
              try {
                const reply = await testConnection(read());
                setMsg(`连接成功，模型回复：${reply.slice(0, 60)}`, 'ok');
              } catch (e) {
                setMsg(`连接失败：${errorMessage(e)}`, 'error');
              }
            },
          },
          '测试连接',
        ),
        h('button', { class: 'vs-btn', type: 'button', onclick: () => (prompt.value = DEFAULT_PROMPT) }, '恢复默认提示词'),
        h('button', { class: 'vs-btn', type: 'button', onclick: back }, '返回'),
      ),
    );
    this.showView(form);
  }

  private showView(view: HTMLElement): void {
    if (this.body.firstElementChild !== view) this.body.replaceChildren(view);
  }

  private copy(): void {
    if (!this.md) {
      this.flash('暂无可复制的总结');
      return;
    }
    GM_setClipboard(this.md, 'text');
    this.flash('已复制 Markdown');
  }

  flash(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 1600);
  }
}

function makeDraggable(handle: HTMLElement, el: HTMLElement): void {
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const x = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - rect.width);
      const y = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 48);
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.right = 'auto';
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });
}
