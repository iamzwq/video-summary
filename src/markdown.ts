import { h } from './dom';
import { parseTime } from './utils';

const TIME = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}`;
const INLINE = new RegExp(String.raw`(\*\*[^*\n]+?\*\*|\x60[^\x60\n]+\x60|\[${TIME}(?:\s*[-–~]\s*${TIME})?\])`, 'g');
const FIRST_TIME = new RegExp(TIME);

function inline(text: string): Node[] {
  const out: Node[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const index = m.index ?? 0;
    if (index > last) out.push(document.createTextNode(text.slice(last, index)));
    const token = m[0];
    if (token.startsWith('**')) {
      out.push(h('strong', {}, ...inline(token.slice(2, -2))));
    } else if (token.startsWith('`')) {
      out.push(h('code', {}, token.slice(1, -1)));
    } else {
      const seconds = parseTime(FIRST_TIME.exec(token)![0]);
      out.push(h('a', { class: 'vs-ts', href: '#', 'data-t': seconds, title: '跳转到该时间点' }, token.slice(1, -1)));
    }
    last = index + token.length;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

type ListEl = HTMLUListElement | HTMLOListElement;

/** Renders a Markdown subset straight to DOM nodes (text only, no HTML passthrough). */
export function renderMarkdown(md: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let para: string[] = [];
  let lists: { indent: number; el: ListEl }[] = [];
  let code: string[] | null = null;

  const flushPara = () => {
    if (!para.length) return;
    const p = h('p');
    para.forEach((line, i) => {
      if (i) p.append(h('br'));
      p.append(...inline(line));
    });
    frag.append(p);
    para = [];
  };
  const resetBlocks = () => {
    flushPara();
    lists = [];
  };
  const openList = (indent: number, ordered: boolean) => {
    const el = h(ordered ? 'ol' : 'ul');
    const parent = lists[lists.length - 1];
    if (parent) (parent.el.lastElementChild ?? parent.el).append(el);
    else frag.append(el);
    lists.push({ indent, el });
    return el;
  };

  for (const raw of md.replace(/\r/g, '').split('\n')) {
    if (code) {
      if (/^\s*```/.test(raw)) {
        frag.append(h('pre', {}, h('code', {}, code.join('\n'))));
        code = null;
      } else {
        code.push(raw);
      }
      continue;
    }
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (/^\s*```/.test(line)) {
      resetBlocks();
      code = [];
    } else if (!line.trim()) {
      resetBlocks();
    } else if ((m = /^\s*(#{1,6})\s+(.*)$/.exec(line))) {
      resetBlocks();
      frag.append(h(m[1].length <= 2 ? 'h3' : 'h4', {}, ...inline(m[2])));
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      resetBlocks();
      frag.append(h('hr'));
    } else if ((m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      flushPara();
      const indent = m[1].replace(/\t/g, '  ').length;
      const ordered = /\d/.test(m[2]);
      while (lists.length && indent < lists[lists.length - 1].indent) lists.pop();
      let top = lists[lists.length - 1];
      if (top && indent === top.indent && (top.el.tagName === 'OL') !== ordered) {
        lists.pop();
        top = lists[lists.length - 1];
      }
      const el = top && indent <= top.indent ? top.el : openList(indent, ordered);
      el.append(h('li', {}, ...inline(m[3])));
    } else if ((m = /^\s*>\s?(.*)$/.exec(line))) {
      resetBlocks();
      frag.append(h('blockquote', {}, ...inline(m[1])));
    } else if (lists.length && /^\s+/.test(raw)) {
      lists[lists.length - 1].el.lastElementChild?.append(' ', ...inline(line.trim()));
    } else {
      lists = [];
      para.push(line.trim());
    }
  }
  if (code) frag.append(h('pre', {}, h('code', {}, code.join('\n'))));
  flushPara();
  return frag;
}
