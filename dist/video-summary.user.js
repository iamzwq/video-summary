// ==UserScript==
// @name         视频总结 Video Summary
// @namespace    video-summary
// @version      0.1.0
// @description  在 B站 / YouTube 视频页工具栏添加「视频总结」按钮，获取字幕并通过 OpenAI 兼容接口生成中文总结
// @license      MIT
// @icon         data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%3E%3Ctext%20y%3D%2220%22%20font-size%3D%2220%22%3E%F0%9F%93%9D%3C%2Ftext%3E%3C%2Fsvg%3E
// @match        *://www.bilibili.com/video/*
// @match        *://www.bilibili.com/*/video/*
// @match        *://www.youtube.com/*
// @connect      *
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-start
// @noframes
// ==/UserScript==

(function() {
	"use strict";
	var _GM_addStyle = (() => typeof GM_addStyle != "undefined" ? GM_addStyle : void 0)();
	var _GM_getValue = (() => typeof GM_getValue != "undefined" ? GM_getValue : void 0)();
	var _GM_registerMenuCommand = (() => typeof GM_registerMenuCommand != "undefined" ? GM_registerMenuCommand : void 0)();
	var _GM_setClipboard = (() => typeof GM_setClipboard != "undefined" ? GM_setClipboard : void 0)();
	var _GM_setValue = (() => typeof GM_setValue != "undefined" ? GM_setValue : void 0)();
	var _GM_xmlhttpRequest = (() => typeof GM_xmlhttpRequest != "undefined" ? GM_xmlhttpRequest : void 0)();
	var _unsafeWindow = (() => typeof unsafeWindow != "undefined" ? unsafeWindow : void 0)();
	var KEY$1 = "summaryCache";
	function getCached(key, max) {
		if (max <= 0) return void 0;
		return _GM_getValue(KEY$1, {})[key];
	}
	function setCached(key, md, max) {
		const all = _GM_getValue(KEY$1, {});
		all[key] = {
			md,
			t: Date.now()
		};
		const stale = Object.keys(all).sort((a, b) => all[b].t - all[a].t).slice(Math.max(0, max));
		for (const k of stale) delete all[k];
		_GM_setValue(KEY$1, all);
	}
	var DEFAULT_PROMPT = `你是一名专业的视频内容分析助手。用户会提供视频标题和带时间戳的字幕（字幕可能是任意语言，也可能是语音自动识别生成、含有错别字）。请基于字幕内容输出结构化总结，要求：

1. 无论字幕是什么语言，输出必须使用简体中文；专有名词可保留原文并在括号中注明。
2. 使用 Markdown，严格按以下结构输出，不要添加开场白或结束语：

## 一句话总结
（一句话概括视频主旨）

## 核心要点
（3~8 条无序列表，每条简洁具体）

## 章节大纲
（按时间顺序的无序列表，每行格式为：- [mm:ss] 章节标题：要点。时间戳必须取自字幕中真实存在的时间）

## 关键结论
（视频得出的结论、建议或值得记住的观点）

3. 忠于字幕原文，不编造字幕中没有的信息；忽略广告、赞助口播和无意义的语气词。`;
	var CHUNK_PROMPT = `你是一名视频内容分析助手。用户会提供一个长视频字幕中的一部分（带 [mm:ss] 时间戳，可能是任意语言）。请用简体中文提炼这一部分的内容要点：
- 使用无序列表，按时间顺序输出；
- 每条以该内容对应的 [mm:ss] 时间戳开头；
- 只输出要点，不要开场白，不要编造字幕中没有的信息。`;
	function buildUserMessage(title, transcript) {
		return `视频标题：${title}\n\n字幕：\n${transcript}`;
	}
	function buildChunkMessage(title, index, total, transcript) {
		return `视频标题：${title}\n\n以下是字幕的第 ${index + 1}/${total} 部分：\n${transcript}`;
	}
	function buildMergeMessage(title, notes) {
		return `视频标题：${title}\n\n该视频较长，以下是按时间顺序整理的各部分要点笔记（代替完整字幕）：\n\n${notes.map((note, i) => `### 第 ${i + 1} 部分\n${note}`).join("\n\n")}\n\n请据此输出完整的视频总结。`;
	}
	var sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
	async function waitFor(fn, timeout = 5e3, interval = 200) {
		const end = Date.now() + timeout;
		for (;;) {
			const value = fn();
			if (value) return value;
			if (Date.now() >= end) return null;
			await sleep(interval);
		}
	}
	function formatTime(sec) {
		const s = Math.max(0, Math.floor(sec));
		const h = Math.floor(s / 3600);
		const m = Math.floor(s % 3600 / 60);
		const pad = (n) => String(n).padStart(2, "0");
		return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
	}
	function parseTime(text) {
		return text.split(":").reduce((acc, part) => acc * 60 + Number(part), 0);
	}
	async function fetchJson(url, init) {
		const res = await fetch(url, {
			credentials: "include",
			...init
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return res.json();
	}
	function errorMessage(err) {
		return err instanceof Error ? err.message : String(err);
	}
	function isAbortError(err) {
		return err instanceof DOMException && err.name === "AbortError";
	}
	var baseLang = (lang) => (lang ?? "").toLowerCase().replace("_", "-").split("-")[0];
	function pickDefaultTrack(tracks, originalLang) {
		const orig = baseLang(originalLang);
		const rank = (t) => {
			const lang = baseLang(t.lang);
			if (orig && lang === orig) return 0;
			if (lang === "zh") return 1;
			if (lang === "en") return 2;
			return 3;
		};
		return tracks.map((track, index) => ({
			track,
			index
		})).sort((a, b) => Number(a.track.isAuto) - Number(b.track.isAuto) || rank(a.track) - rank(b.track) || a.index - b.index)[0].track;
	}
	function cuesToSrt(cues) {
		const ts = (sec) => {
			const ms = Math.max(0, Math.round(sec * 1e3));
			const pad = (n, w = 2) => String(n).padStart(w, "0");
			return `${pad(Math.floor(ms / 36e5))}:${pad(Math.floor(ms / 6e4) % 60)}:${pad(Math.floor(ms / 1e3) % 60)},${pad(ms % 1e3, 3)}`;
		};
		return [...cues].sort((a, b) => a.start - b.start).map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text.trim()}\n`).join("\n");
	}
	function trackLabel(track) {
		return `${track.isAuto ? "自动生成" : "手动字幕"} · ${track.label}`;
	}
	var CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef]/g;
	function estimateTokens(text) {
		const cjk = text.match(CJK)?.length ?? 0;
		return cjk + Math.ceil((text.length - cjk) / 4);
	}
	function cuesToLines(cues) {
		const lines = [];
		let start = 0;
		let buf = [];
		let size = 0;
		let prev = "";
		const flush = () => {
			if (buf.length) lines.push(`[${formatTime(start)}] ${buf.join(" ")}`);
			buf = [];
			size = 0;
		};
		for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
			const text = cue.text.replace(/\s+/g, " ").trim();
			if (!text || text === prev) continue;
			prev = text;
			if (!buf.length) start = cue.start;
			buf.push(text);
			size += text.length;
			if (size >= 150 || cue.end - start >= 30) flush();
		}
		flush();
		return lines;
	}
	function chunkLines(lines, budget) {
		const chunks = [];
		let cur = [];
		let tokens = 0;
		for (const line of lines) {
			const t = estimateTokens(line) + 1;
			if (cur.length && tokens + t > budget) {
				chunks.push(cur.join("\n"));
				cur = [];
				tokens = 0;
			}
			cur.push(line);
			tokens += t;
		}
		if (cur.length) chunks.push(cur.join("\n"));
		return chunks;
	}
	function endpoint(baseURL) {
		const base = baseURL.trim().replace(/\/+$/, "");
		return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
	}
	function safeText(read) {
		try {
			const text = read();
			return typeof text === "string" ? text : "";
		} catch {
			return "";
		}
	}
	function chat(s, messages, signal) {
		return new Promise((resolve, reject) => {
			let settled = false;
			const finish = (err, content = "") => {
				if (settled) return;
				settled = true;
				signal?.removeEventListener("abort", onAbort);
				if (err) reject(err);
				else resolve(content);
			};
			const req = _GM_xmlhttpRequest({
				method: "POST",
				url: endpoint(s.baseURL),
				headers: {
					"Content-Type": "application/json",
					...s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}
				},
				data: JSON.stringify({
					model: s.model,
					messages,
					temperature: s.temperature,
					stream: false,
					thinking: { type: s.thinking },
					reasoning_effort: s.reasoningEffort
				}),
				onload: (r) => {
					const text = safeText(() => r.responseText);
					let json;
					try {
						json = JSON.parse(text);
					} catch {
						return finish(new Error(`HTTP ${r.status}: ${text.slice(0, 300) || "响应为空"}`));
					}
					if (r.status >= 400 || json.error) return finish(new Error(json.error?.message || json.message || `HTTP ${r.status}`));
					const choice = json.choices?.[0];
					const content = choice?.message?.content ?? "";
					if (content.trim()) return finish(null, content);
					if (choice?.message?.reasoning_content) return finish(new Error(choice.finish_reason === "length" ? "模型在思考阶段就用完了输出长度，未给出回答" : "模型只返回了思考内容，没有给出回答"));
					finish(new Error("模型没有返回任何内容"));
				},
				onerror: (r) => {
					const detail = [
						r.status ? `HTTP ${r.status}` : "",
						r.error ?? "",
						safeText(() => r.responseText).slice(0, 200)
					].filter(Boolean).join(" ");
					finish(new Error(`网络请求失败${detail ? `（${detail}）` : ""}，请检查 baseURL、网络或脚本管理器的跨域授权`));
				},
				ontimeout: () => finish(new Error("请求超时"))
			});
			const onAbort = () => {
				req.abort();
				finish(new DOMException("Aborted", "AbortError"));
			};
			if (signal?.aborted) onAbort();
			else signal?.addEventListener("abort", onAbort);
		});
	}
	async function testConnection(s) {
		return (await chat(s, [{
			role: "user",
			content: "请只回复：OK"
		}])).trim();
	}
	async function summarize(o) {
		const s = o.settings;
		const chunks = chunkLines(o.lines, Math.max(2e3, s.chunkTokens));
		if (chunks.length === 1) {
			o.onStatus("正在生成总结，请稍候…");
			return chat(s, [{
				role: "system",
				content: s.prompt
			}, {
				role: "user",
				content: buildUserMessage(o.title, chunks[0])
			}], o.signal);
		}
		const notes = [];
		for (let i = 0; i < chunks.length; i++) {
			o.onStatus(`视频较长，正在分段分析字幕（${i + 1}/${chunks.length}）…`);
			notes.push(await chat(s, [{
				role: "system",
				content: CHUNK_PROMPT
			}, {
				role: "user",
				content: buildChunkMessage(o.title, i, chunks.length, chunks[i])
			}], o.signal));
		}
		o.onStatus("正在汇总生成总结，请稍候…");
		return chat(s, [{
			role: "system",
			content: s.prompt
		}, {
			role: "user",
			content: buildMergeMessage(o.title, notes)
		}], o.signal);
	}
	var DEFAULT_SETTINGS = {
		baseURL: "https://api.openai.com/v1",
		apiKey: "",
		model: "gpt-4o-mini",
		temperature: .3,
		thinking: "disabled",
		reasoningEffort: "minimal",
		chunkTokens: 12e3,
		cacheSize: 20,
		prompt: DEFAULT_PROMPT
	};
	var KEY = "settings";
	function getSettings() {
		const saved = _GM_getValue(KEY, {});
		if (saved.thinking === "default") delete saved.thinking;
		if (saved.reasoningEffort === "default") delete saved.reasoningEffort;
		return {
			...DEFAULT_SETTINGS,
			...saved
		};
	}
	function saveSettings(settings) {
		_GM_setValue(KEY, settings);
	}
	function isConfigured(s) {
		if (!s.baseURL.trim() || !s.model.trim()) return false;
		if (s.apiKey.trim()) return true;
		try {
			return /^(localhost|127\.|\[::1\])/.test(new URL(s.baseURL).hostname);
		} catch {
			return false;
		}
	}
	function h(tag, attrs = {}, ...children) {
		const el = document.createElement(tag);
		for (const [key, value] of Object.entries(attrs)) {
			if (value === void 0 || value === false) continue;
			if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
			else if (key === "class") el.className = String(value);
			else el.setAttribute(key, value === true ? "" : String(value));
		}
		for (const child of children) if (child !== null && child !== void 0 && child !== false) el.append(child);
		return el;
	}
	var SVG_NS = "http://www.w3.org/2000/svg";
	function icon(paths, size = 18, className) {
		const svg = document.createElementNS(SVG_NS, "svg");
		svg.setAttribute("viewBox", "0 0 24 24");
		svg.setAttribute("width", String(size));
		svg.setAttribute("height", String(size));
		svg.setAttribute("fill", "none");
		svg.setAttribute("stroke", "currentColor");
		svg.setAttribute("stroke-width", "1.8");
		svg.setAttribute("stroke-linecap", "round");
		svg.setAttribute("stroke-linejoin", "round");
		if (className) svg.setAttribute("class", className);
		for (const d of paths) {
			const path = document.createElementNS(SVG_NS, "path");
			path.setAttribute("d", d);
			svg.append(path);
		}
		return svg;
	}
	var ICONS = {
		summary: [
			"M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z",
			"M14 3v6h6",
			"M8 13h8",
			"M8 17h5"
		],
		refresh: ["M20.5 12a8.5 8.5 0 1 1-2.5-6", "M20.5 4v5h-5"],
		copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
		settings: [
			"M4 21v-7",
			"M4 10V3",
			"M12 21v-9",
			"M12 8V3",
			"M20 21v-5",
			"M20 12V3",
			"M1 14h6",
			"M9 8h6",
			"M17 16h6"
		],
		close: ["M18 6 6 18", "M6 6l12 12"],
		stop: ["M7 7h10v10H7z"],
		download: [
			"M12 4v11",
			"M7 10l5 5 5-5",
			"M5 20h14"
		]
	};
	var TIME = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}`;
	var INLINE = new RegExp(String.raw`(\*\*[^*\n]+?\*\*|\x60[^\x60\n]+\x60|\[${TIME}(?:\s*[-–~]\s*${TIME})?\])`, "g");
	var FIRST_TIME = new RegExp(TIME);
	function inline(text) {
		const out = [];
		let last = 0;
		for (const m of text.matchAll(INLINE)) {
			const index = m.index ?? 0;
			if (index > last) out.push(document.createTextNode(text.slice(last, index)));
			const token = m[0];
			if (token.startsWith("**")) out.push(h("strong", {}, ...inline(token.slice(2, -2))));
			else if (token.startsWith("`")) out.push(h("code", {}, token.slice(1, -1)));
			else {
				const seconds = parseTime(FIRST_TIME.exec(token)[0]);
				out.push(h("a", {
					class: "vs-ts",
					href: "#",
					"data-t": seconds,
					title: "跳转到该时间点"
				}, token.slice(1, -1)));
			}
			last = index + token.length;
		}
		if (last < text.length) out.push(document.createTextNode(text.slice(last)));
		return out;
	}
	function renderMarkdown(md) {
		const frag = document.createDocumentFragment();
		let para = [];
		let lists = [];
		let code = null;
		const flushPara = () => {
			if (!para.length) return;
			const p = h("p");
			para.forEach((line, i) => {
				if (i) p.append(h("br"));
				p.append(...inline(line));
			});
			frag.append(p);
			para = [];
		};
		const resetBlocks = () => {
			flushPara();
			lists = [];
		};
		const openList = (indent, ordered) => {
			const el = h(ordered ? "ol" : "ul");
			const parent = lists[lists.length - 1];
			if (parent) (parent.el.lastElementChild ?? parent.el).append(el);
			else frag.append(el);
			lists.push({
				indent,
				el
			});
			return el;
		};
		for (const raw of md.replace(/\r/g, "").split("\n")) {
			if (code) {
				if (/^\s*```/.test(raw)) {
					frag.append(h("pre", {}, h("code", {}, code.join("\n"))));
					code = null;
				} else code.push(raw);
				continue;
			}
			const line = raw.trimEnd();
			let m;
			if (/^\s*```/.test(line)) {
				resetBlocks();
				code = [];
			} else if (!line.trim()) resetBlocks();
			else if (m = /^\s*(#{1,6})\s+(.*)$/.exec(line)) {
				resetBlocks();
				frag.append(h(m[1].length <= 2 ? "h3" : "h4", {}, ...inline(m[2])));
			} else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
				resetBlocks();
				frag.append(h("hr"));
			} else if (m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)) {
				flushPara();
				const indent = m[1].replace(/\t/g, "  ").length;
				const ordered = /\d/.test(m[2]);
				while (lists.length && indent < lists[lists.length - 1].indent) lists.pop();
				let top = lists[lists.length - 1];
				if (top && indent === top.indent && top.el.tagName === "OL" !== ordered) {
					lists.pop();
					top = lists[lists.length - 1];
				}
				(top && indent <= top.indent ? top.el : openList(indent, ordered)).append(h("li", {}, ...inline(m[3])));
			} else if (m = /^\s*>\s?(.*)$/.exec(line)) {
				resetBlocks();
				frag.append(h("blockquote", {}, ...inline(m[1])));
			} else if (lists.length && /^\s+/.test(raw)) lists[lists.length - 1].el.lastElementChild?.append(" ", ...inline(line.trim()));
			else {
				lists = [];
				para.push(line.trim());
			}
		}
		if (code) frag.append(h("pre", {}, h("code", {}, code.join("\n"))));
		flushPara();
		return frag;
	}
	var Panel = class {
		cb;
		el;
		select;
		status;
		spinner;
		statusText;
		body;
		content;
		stopBtn;
		toast;
		md = "";
		toastTimer = 0;
		constructor(shadow, cb) {
			this.cb = cb;
			const iconBtn = (title, paths, onClick) => h("button", {
				class: "vs-icon-btn",
				type: "button",
				title,
				onclick: onClick
			}, icon(paths, 17));
			this.select = h("select", {
				class: "vs-select",
				title: "选择字幕轨道",
				onchange: () => cb.onTrackChange(this.select.value)
			});
			this.stopBtn = h("button", {
				class: "vs-btn",
				type: "button",
				onclick: () => cb.onStop()
			}, icon(ICONS.stop, 14), "停止");
			this.stopBtn.hidden = true;
			this.spinner = h("span", { class: "vs-spinner" });
			this.statusText = h("span");
			this.status = h("div", { class: "vs-status" }, this.spinner, this.statusText);
			this.status.hidden = true;
			this.content = h("div", {
				class: "vs-md",
				onclick: (e) => {
					const link = e.target.closest?.(".vs-ts");
					if (!link) return;
					e.preventDefault();
					cb.onSeek(Number(link.getAttribute("data-t")));
				}
			});
			this.body = h("div", { class: "vs-body" }, this.content);
			this.toast = h("div", { class: "vs-toast" });
			this.toast.hidden = true;
			const header = h("div", { class: "vs-header" }, icon(ICONS.summary, 18), h("span", { class: "vs-title" }, "视频总结"), iconBtn("重新生成", ICONS.refresh, () => cb.onGenerate(true)), iconBtn("复制 Markdown", ICONS.copy, () => this.copy()), iconBtn("下载字幕（SRT）", ICONS.download, () => cb.onDownload()), iconBtn("设置", ICONS.settings, () => this.showSettings()), iconBtn("关闭", ICONS.close, () => this.close()));
			this.el = h("div", { class: "vs-panel" }, header, h("div", { class: "vs-bar" }, this.select, this.stopBtn), this.status, this.body, this.toast);
			this.el.hidden = true;
			for (const type of [
				"keydown",
				"keyup",
				"keypress"
			]) this.el.addEventListener(type, (e) => e.stopPropagation());
			makeDraggable(header, this.el);
			shadow.append(this.el);
		}
		get isOpen() {
			return !this.el.hidden;
		}
		open(dark) {
			this.el.classList.toggle("dark", dark);
			this.el.hidden = false;
		}
		close() {
			this.el.hidden = true;
		}
		setTracks(tracks, selectedId) {
			this.select.replaceChildren(...tracks.length ? tracks.map((t) => h("option", { value: t.id }, trackLabel(t))) : [h("option", { value: "" }, "无可用字幕")]);
			this.select.disabled = !tracks.length;
			this.select.value = selectedId;
		}
		setStatus(text, loading = false) {
			this.status.hidden = !text;
			this.statusText.textContent = text ?? "";
			this.spinner.hidden = !loading;
		}
		setRunning(running) {
			this.stopBtn.hidden = !running;
		}
		showMarkdown(md) {
			this.md = md;
			this.showView(this.content);
			this.content.replaceChildren(renderMarkdown(md));
			this.body.scrollTop = 0;
		}
		showMessage(text, kind = "info", action) {
			this.md = "";
			this.content.replaceChildren(h("div", { class: `vs-msg ${kind}` }, h("div", {}, text), action && h("button", {
				class: "vs-btn primary",
				type: "button",
				onclick: action.onClick
			}, action.label)));
			this.showView(this.content);
		}
		showIdle() {
			this.showMessage("点击下方按钮，获取字幕并生成当前视频的中文总结。", "info", {
				label: "生成总结",
				onClick: () => this.cb.onGenerate(false)
			});
		}
		showSettings(note) {
			const s = getSettings();
			const input = (type, value, attrs = {}) => {
				const el = h("input", {
					type,
					autocomplete: "off",
					spellcheck: "false",
					...attrs
				});
				el.value = String(value);
				return el;
			};
			const field = (label, control) => h("label", { class: "vs-field" }, h("span", { class: "vs-label" }, label), control);
			const baseURL = input("text", s.baseURL, { placeholder: DEFAULT_SETTINGS.baseURL });
			const apiKey = input("password", s.apiKey, { placeholder: "sk-..." });
			const model = input("text", s.model, { placeholder: DEFAULT_SETTINGS.model });
			const temperature = input("number", s.temperature, {
				min: "0",
				max: "2",
				step: "0.1"
			});
			const chunkTokens = input("number", s.chunkTokens, {
				min: "2000",
				step: "1000"
			});
			const cacheSize = input("number", s.cacheSize, {
				min: "0",
				step: "1"
			});
			const select = (value, options) => {
				const el = h("select", {}, ...options.map(([v, label]) => h("option", { value: v }, label)));
				el.value = value;
				return el;
			};
			const thinking = select(s.thinking, [
				["disabled", "关闭"],
				["enabled", "开启"],
				["auto", "自动（模型自行判断）"]
			]);
			const reasoningEffort = select(s.reasoningEffort, [
				["minimal", "最低 minimal"],
				["low", "低 low"],
				["medium", "中 medium"],
				["high", "高 high"]
			]);
			const prompt = h("textarea", { spellcheck: "false" });
			prompt.value = s.prompt;
			const msg = h("div", { class: "vs-form-msg" });
			const read = () => ({
				baseURL: baseURL.value.trim(),
				apiKey: apiKey.value.trim(),
				model: model.value.trim(),
				temperature: Math.min(2, Math.max(0, Number(temperature.value) || 0)),
				thinking: thinking.value,
				reasoningEffort: reasoningEffort.value,
				chunkTokens: Math.max(2e3, Number(chunkTokens.value) || DEFAULT_SETTINGS.chunkTokens),
				cacheSize: cacheSize.value.trim() === "" || !Number.isFinite(Number(cacheSize.value)) ? DEFAULT_SETTINGS.cacheSize : Math.max(0, Math.floor(Number(cacheSize.value))),
				prompt: prompt.value.trim() || "你是一名专业的视频内容分析助手。用户会提供视频标题和带时间戳的字幕（字幕可能是任意语言，也可能是语音自动识别生成、含有错别字）。请基于字幕内容输出结构化总结，要求：\n\n1. 无论字幕是什么语言，输出必须使用简体中文；专有名词可保留原文并在括号中注明。\n2. 使用 Markdown，严格按以下结构输出，不要添加开场白或结束语：\n\n## 一句话总结\n（一句话概括视频主旨）\n\n## 核心要点\n（3~8 条无序列表，每条简洁具体）\n\n## 章节大纲\n（按时间顺序的无序列表，每行格式为：- [mm:ss] 章节标题：要点。时间戳必须取自字幕中真实存在的时间）\n\n## 关键结论\n（视频得出的结论、建议或值得记住的观点）\n\n3. 忠于字幕原文，不编造字幕中没有的信息；忽略广告、赞助口播和无意义的语气词。"
			});
			const setMsg = (text, kind = "") => {
				msg.className = `vs-form-msg ${kind}`;
				msg.textContent = text;
			};
			const back = () => this.showView(this.content);
			const form = h("div", { class: "vs-form" }, note ? h("div", { class: "vs-note" }, note) : null, field("Base URL（OpenAI 兼容接口）", baseURL), field("API Key", apiKey), h("div", { class: "vs-row" }, field("模型", model), field("Temperature", temperature)), h("div", { class: "vs-row" }, field("深度思考", thinking), field("思考程度", reasoningEffort)), h("div", { class: "vs-hint" }, "「深度思考」发送 thinking.type（豆包 / GLM / DeepSeek 等），「思考程度」发送 reasoning_effort（OpenAI / 豆包等）。总结视频一般无需深度思考，关闭更快更省 token。"), h("div", { class: "vs-row" }, field("分段阈值（估算 token）", chunkTokens), field("缓存条数（0 为不缓存）", cacheSize)), field("系统提示词", prompt), msg, h("div", { class: "vs-actions-row" }, h("button", {
				class: "vs-btn primary",
				type: "button",
				onclick: () => {
					saveSettings(read());
					back();
					this.flash("设置已保存");
					this.cb.onSettingsSaved();
				}
			}, "保存"), h("button", {
				class: "vs-btn",
				type: "button",
				onclick: async () => {
					setMsg("正在测试连接…");
					try {
						const reply = await testConnection(read());
						setMsg(`连接成功，模型回复：${reply.slice(0, 60)}`, "ok");
					} catch (e) {
						setMsg(`连接失败：${errorMessage(e)}`, "error");
					}
				}
			}, "测试连接"), h("button", {
				class: "vs-btn",
				type: "button",
				onclick: () => prompt.value = DEFAULT_PROMPT
			}, "恢复默认提示词"), h("button", {
				class: "vs-btn",
				type: "button",
				onclick: back
			}, "返回")));
			this.showView(form);
		}
		showView(view) {
			if (this.body.firstElementChild !== view) this.body.replaceChildren(view);
		}
		copy() {
			if (!this.md) {
				this.flash("暂无可复制的总结");
				return;
			}
			_GM_setClipboard(this.md, "text");
			this.flash("已复制 Markdown");
		}
		flash(text) {
			this.toast.textContent = text;
			this.toast.hidden = false;
			clearTimeout(this.toastTimer);
			this.toastTimer = window.setTimeout(() => this.toast.hidden = true, 1600);
		}
	};
	function makeDraggable(handle, el) {
		handle.addEventListener("pointerdown", (e) => {
			if (e.button !== 0 || e.target.closest("button")) return;
			const rect = el.getBoundingClientRect();
			const dx = e.clientX - rect.left;
			const dy = e.clientY - rect.top;
			handle.setPointerCapture(e.pointerId);
			const move = (ev) => {
				const x = Math.min(Math.max(0, ev.clientX - dx), window.innerWidth - rect.width);
				const y = Math.min(Math.max(0, ev.clientY - dy), window.innerHeight - 48);
				el.style.left = `${x}px`;
				el.style.top = `${y}px`;
				el.style.right = "auto";
			};
			const up = () => {
				handle.removeEventListener("pointermove", move);
				handle.removeEventListener("pointerup", up);
				handle.removeEventListener("pointercancel", up);
			};
			handle.addEventListener("pointermove", move);
			handle.addEventListener("pointerup", up);
			handle.addEventListener("pointercancel", up);
		});
	}
	var styles_default = "[hidden]{display:none!important}.vs-panel{--bg:#fff;--fg:#18191c;--muted:#61666d;--border:#e3e5e7;--hover:#f1f2f3;--code:#f6f7f8;--accent:#00a1d6;--danger:#f25d59;--ok:#2ea043;box-sizing:border-box;background:var(--bg);width:420px;max-width:calc(100vw - 32px);max-height:calc(100vh - 96px);color:var(--fg);border:1px solid var(--border);pointer-events:auto;border-radius:12px;flex-direction:column;font:14px/1.7 -apple-system,BlinkMacSystemFont,Segoe UI,PingFang SC,Microsoft YaHei,sans-serif;display:flex;position:fixed;top:76px;right:16px;overflow:hidden;box-shadow:0 8px 32px #0000002e}.vs-panel.dark{--bg:#212121;--fg:#e8e8e8;--muted:#a0a0a0;--border:#3a3a3a;--hover:#2e2e2e;--code:#2b2b2b;--accent:#3ea6ff}.vs-header{border-bottom:1px solid var(--border);cursor:move;-webkit-user-select:none;user-select:none;align-items:center;gap:8px;padding:8px 8px 8px 14px;display:flex}.vs-header>svg{color:var(--accent);flex-shrink:0}.vs-title{flex:1;font-size:15px;font-weight:600}.vs-icon-btn{all:unset;width:30px;height:30px;color:var(--muted);cursor:pointer;border-radius:6px;justify-content:center;align-items:center;display:inline-flex}.vs-icon-btn:hover{background:var(--hover);color:var(--fg)}.vs-bar{align-items:center;gap:8px;padding:10px 14px 6px;display:flex}.vs-select{border:1px solid var(--border);background:var(--bg);min-width:0;height:30px;color:var(--fg);font:inherit;border-radius:6px;outline:none;flex:1;padding:0 8px;font-size:13px}.vs-btn{all:unset;box-sizing:border-box;border:1px solid var(--border);height:30px;color:var(--fg);cursor:pointer;white-space:nowrap;border-radius:6px;justify-content:center;align-items:center;gap:4px;padding:0 12px;font-size:13px;display:inline-flex}.vs-btn:hover{background:var(--hover)}.vs-btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}.vs-btn.primary:hover{filter:brightness(1.08)}.vs-status{color:var(--muted);align-items:center;gap:6px;padding:0 14px 6px;font-size:12px;display:flex}.vs-spinner{border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;flex-shrink:0;width:10px;height:10px;animation:.8s linear infinite vs-spin}@keyframes vs-spin{to{transform:rotate(360deg)}}.vs-body{overscroll-behavior:contain;flex:1;min-height:80px;padding:2px 16px 16px;overflow:auto}.vs-md h3{margin:14px 0 6px;font-size:15px}.vs-md h4{margin:12px 0 4px;font-size:14px}.vs-md p{margin:6px 0}.vs-md ul,.vs-md ol{margin:4px 0;padding-left:20px}.vs-md li{margin:3px 0}.vs-md code{background:var(--code);border-radius:4px;padding:1px 4px;font-family:Consolas,Menlo,monospace;font-size:12.5px}.vs-md pre{background:var(--code);border-radius:6px;padding:8px;overflow:auto}.vs-md pre code{padding:0}.vs-md blockquote{border-left:3px solid var(--border);color:var(--muted);margin:6px 0;padding-left:10px}.vs-md hr{border:none;border-top:1px solid var(--border)}.vs-ts{color:var(--accent);font-variant-numeric:tabular-nums;cursor:pointer;text-decoration:none}.vs-ts:hover{text-decoration:underline}.vs-msg{text-align:center;color:var(--muted);padding:28px 8px}.vs-msg.error{color:var(--danger)}.vs-msg .vs-btn{margin-top:14px}.vs-form{flex-direction:column;gap:10px;padding-top:8px;display:flex}.vs-note{background:var(--hover);border-radius:6px;padding:8px 10px;font-size:12px}.vs-field{flex-direction:column;gap:4px;min-width:0;display:flex}.vs-row{gap:10px;display:flex}.vs-row>.vs-field{flex:1}.vs-label{color:var(--muted);font-size:12px}.vs-field input,.vs-field select,.vs-field textarea{box-sizing:border-box;border:1px solid var(--border);background:var(--bg);width:100%;color:var(--fg);font:inherit;border-radius:6px;outline:none;padding:6px 8px;font-size:13px}.vs-field input:focus,.vs-field select:focus,.vs-field textarea:focus{border-color:var(--accent)}.vs-field select{height:32px}.vs-hint{color:var(--muted);margin-top:-4px;font-size:12px;line-height:1.5}.vs-field textarea{resize:vertical;min-height:140px;line-height:1.5}.vs-actions-row{flex-wrap:wrap;gap:8px;display:flex}.vs-form-msg{word-break:break-all;font-size:12px}.vs-form-msg.ok{color:var(--ok)}.vs-form-msg.error{color:var(--danger)}.vs-toast{color:#fff;pointer-events:none;background:#000000bf;border-radius:14px;padding:4px 12px;font-size:12px;position:absolute;bottom:16px;left:50%;transform:translate(-50%)}";
	var HOST_STYLE = {
		all: "initial",
		position: "fixed",
		top: "0",
		left: "0",
		width: "0",
		height: "0",
		overflow: "visible",
		"z-index": "2147483646",
		"pointer-events": "none"
	};
	function createUiRoot() {
		const host = document.createElement("video-summary-ui");
		for (const [prop, value] of Object.entries(HOST_STYLE)) host.style.setProperty(prop, value, "important");
		const shadow = host.attachShadow({ mode: "closed" });
		try {
			const sheet = new CSSStyleSheet();
			sheet.replaceSync(styles_default);
			shadow.adoptedStyleSheets = [sheet];
		} catch {
			const style = document.createElement("style");
			style.textContent = styles_default;
			shadow.append(style);
		}
		const mount = () => {
			if (!host.isConnected) document.documentElement.append(host);
		};
		mount();
		new MutationObserver(mount).observe(document.documentElement, { childList: true });
		return shadow;
	}
	function isDarkPage() {
		if (document.documentElement.hasAttribute("dark")) return true;
		const parts = getComputedStyle(document.body ?? document.documentElement).backgroundColor.match(/[\d.]+/g)?.map(Number);
		if (!parts || parts.length < 3 || parts[3] === 0) return false;
		return .299 * parts[0] + .587 * parts[1] + .114 * parts[2] < 128;
	}
	var Controller = class {
		adapter;
		panel = null;
		abort = null;
		runningKey = null;
		needsConfig = false;
		trackLists = new Map();
		selectedTrack = new Map();
		constructor(adapter) {
			this.adapter = adapter;
		}
		ensurePanel() {
			this.panel ??= new Panel(createUiRoot(), {
				onGenerate: (force) => this.run({ force }),
				onTrackChange: (trackId) => this.run({ trackId }),
				onStop: () => this.stop(),
				onDownload: () => this.download(),
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
				}
			});
			this.panel.open(isDarkPage());
			return this.panel;
		}
		openSettings() {
			this.ensurePanel().showSettings();
		}
		onVideoChange(key) {
			this.cancel();
			if (!this.panel?.isOpen) return;
			if (!key) {
				this.panel.close();
				return;
			}
			this.panel.setTracks([], "");
			this.panel.setStatus(null);
			this.panel.showIdle();
		}
		cancel() {
			const ac = this.abort;
			this.abort = null;
			this.runningKey = null;
			ac?.abort();
			this.panel?.setRunning(false);
		}
		stop() {
			this.cancel();
			this.panel?.setStatus("已停止");
		}
		getTrackList(key) {
			let list = this.trackLists.get(key);
			if (!list) {
				list = this.adapter.getTracks();
				this.trackLists.set(key, list);
				list.then((l) => !l.tracks.length && this.trackLists.delete(key), () => this.trackLists.delete(key));
			}
			return list;
		}
		async download() {
			const key = this.adapter.getVideoKey();
			const panel = this.panel;
			if (!key || !panel) return;
			try {
				const list = await this.getTrackList(key);
				if (!list.tracks.length) {
					panel.flash("该视频没有可用字幕");
					return;
				}
				const wanted = this.selectedTrack.get(key);
				const track = list.tracks.find((t) => t.id === wanted) ?? pickDefaultTrack(list.tracks, list.originalLang);
				panel.flash("正在下载字幕…");
				const cues = await track.load();
				if (!cues.length) throw new Error("字幕内容为空");
				const name = `${this.adapter.getTitle() || key} [${track.label}]`.replace(/[\\/:*?"<>|\r\n]+/g, "_").slice(0, 150);
				const url = URL.createObjectURL(new Blob(["﻿" + cuesToSrt(cues)], { type: "text/plain;charset=utf-8" }));
				const a = document.createElement("a");
				a.href = url;
				a.download = `${name}.srt`;
				document.body.append(a);
				a.click();
				a.remove();
				setTimeout(() => URL.revokeObjectURL(url), 1e4);
				panel.flash("字幕已下载");
			} catch (e) {
				panel.flash(`下载失败：${errorMessage(e)}`);
			}
		}
		async run(opts = {}) {
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
				panel.setStatus("正在获取字幕列表…", true);
				const list = await this.getTrackList(key);
				if (!alive()) return;
				if (!list.tracks.length) {
					panel.setTracks([], "");
					panel.setStatus(null);
					panel.showMessage(list.emptyHint ?? "该视频没有可用字幕，无法生成总结。", "error");
					return;
				}
				const wanted = opts.trackId ?? this.selectedTrack.get(key);
				const track = list.tracks.find((t) => t.id === wanted) ?? pickDefaultTrack(list.tracks, list.originalLang);
				this.selectedTrack.set(key, track.id);
				panel.setTracks(list.tracks, track.id);
				const cacheKey = `${key}|${track.id}`;
				const cacheSize = getSettings().cacheSize;
				const cached = opts.force ? void 0 : getCached(cacheKey, cacheSize);
				if (cached) {
					panel.showMarkdown(cached.md);
					panel.setStatus(`已缓存（${new Date(cached.t).toLocaleString()}），可点击右上角重新生成`);
					return;
				}
				const settings = getSettings();
				if (!isConfigured(settings)) {
					this.needsConfig = true;
					panel.setStatus(null);
					panel.showSettings("请先配置 OpenAI 兼容接口的 Base URL、API Key 和模型，保存后将自动开始生成总结。");
					return;
				}
				panel.setStatus(`正在加载字幕（${trackLabel(track)}）…`, true);
				panel.showMarkdown("");
				const cues = await track.load();
				if (!alive()) return;
				const lines = cuesToLines(cues);
				if (!lines.length) throw new Error("字幕内容为空");
				const md = await summarize({
					title: this.adapter.getTitle(),
					lines,
					settings,
					signal: ac.signal,
					onStatus: (text) => alive() && panel.setStatus(text, true)
				});
				if (!alive()) return;
				panel.showMarkdown(md);
				setCached(cacheKey, md, settings.cacheSize);
				panel.setStatus(`已完成 · ${trackLabel(track)}`);
			} catch (e) {
				if (!alive() || isAbortError(e)) return;
				panel.setStatus(null);
				panel.showMessage(errorMessage(e), "error", {
					label: "重试",
					onClick: () => this.run({ force: true })
				});
			} finally {
				if (this.abort === ac) {
					this.abort = null;
					this.runningKey = null;
					panel.setRunning(false);
				}
			}
		}
	};
	var MIXIN_KEY_ENC_TAB = [
		46,
		47,
		18,
		2,
		53,
		8,
		23,
		32,
		15,
		50,
		10,
		31,
		58,
		3,
		45,
		35,
		27,
		43,
		5,
		49,
		33,
		9,
		42,
		19,
		29,
		28,
		14,
		39,
		12,
		38,
		41,
		13,
		37,
		48,
		7,
		16,
		24,
		55,
		40,
		61,
		26,
		17,
		0,
		1,
		60,
		51,
		30,
		4,
		22,
		25,
		54,
		21,
		56,
		59,
		6,
		63,
		57,
		62,
		11,
		36,
		20,
		34,
		44,
		52
	];
	var mixinCache = null;
	async function getMixinKey() {
		if (mixinCache && Date.now() - mixinCache.time < 6e5) return mixinCache.key;
		const { img_url, sub_url } = (await fetchJson("https://api.bilibili.com/x/web-interface/nav"))?.data?.wbi_img ?? {};
		if (!img_url || !sub_url) throw new Error("WBI key unavailable");
		const name = (url) => url.slice(url.lastIndexOf("/") + 1).split(".")[0];
		const orig = name(img_url) + name(sub_url);
		const key = MIXIN_KEY_ENC_TAB.map((i) => orig[i]).join("").slice(0, 32);
		mixinCache = {
			key,
			time: Date.now()
		};
		return key;
	}
	async function signWbi(params) {
		const mixinKey = await getMixinKey();
		const all = {
			...params,
			wts: Math.round(Date.now() / 1e3)
		};
		const query = Object.keys(all).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(all[k]).replace(/[!'()*]/g, ""))}`).join("&");
		return `${query}&w_rid=${md5(query + mixinKey)}`;
	}
	var S = [
		7,
		12,
		17,
		22,
		7,
		12,
		17,
		22,
		7,
		12,
		17,
		22,
		7,
		12,
		17,
		22,
		5,
		9,
		14,
		20,
		5,
		9,
		14,
		20,
		5,
		9,
		14,
		20,
		5,
		9,
		14,
		20,
		4,
		11,
		16,
		23,
		4,
		11,
		16,
		23,
		4,
		11,
		16,
		23,
		4,
		11,
		16,
		23,
		6,
		10,
		15,
		21,
		6,
		10,
		15,
		21,
		6,
		10,
		15,
		21,
		6,
		10,
		15,
		21
	];
	var K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
	function md5(input) {
		const bytes = new TextEncoder().encode(input);
		const len = bytes.length;
		const blocks = (len + 8 >>> 6) + 1;
		const words = new Uint32Array(blocks * 16);
		for (let i = 0; i < len; i++) words[i >> 2] |= bytes[i] << i % 4 * 8;
		words[len >> 2] |= 128 << len % 4 * 8;
		words[blocks * 16 - 2] = len * 8 >>> 0;
		words[blocks * 16 - 1] = Math.floor(len / 536870912);
		let a0 = 1732584193;
		let b0 = 4023233417;
		let c0 = 2562383102;
		let d0 = 271733878;
		for (let off = 0; off < words.length; off += 16) {
			let a = a0;
			let b = b0;
			let c = c0;
			let d = d0;
			for (let i = 0; i < 64; i++) {
				let f;
				let g;
				if (i < 16) {
					f = b & c | ~b & d;
					g = i;
				} else if (i < 32) {
					f = d & b | ~d & c;
					g = (5 * i + 1) % 16;
				} else if (i < 48) {
					f = b ^ c ^ d;
					g = (3 * i + 5) % 16;
				} else {
					f = c ^ (b | ~d);
					g = 7 * i % 16;
				}
				f = f + a + K[i] + words[off + g] >>> 0;
				a = d;
				d = c;
				c = b;
				b = b + (f << S[i] | f >>> 32 - S[i]) >>> 0;
			}
			a0 = a0 + a >>> 0;
			b0 = b0 + b >>> 0;
			c0 = c0 + c >>> 0;
			d0 = d0 + d >>> 0;
		}
		return [
			a0,
			b0,
			c0,
			d0
		].map((n) => Array.from({ length: 4 }, (_, i) => (n >>> i * 8 & 255).toString(16).padStart(2, "0")).join("")).join("");
	}
	var VIDEO_PATH = /^\/(?:[\w-]+\/)?video\/(BV[0-9A-Za-z]{10}|av\d+)/i;
	var TOOLBAR_SELECTORS = [
		".video-toolbar-left-main",
		".video-toolbar-left",
		".toolbar-left"
	];
	function parseLocation() {
		const m = VIDEO_PATH.exec(location.pathname);
		if (!m) return null;
		const p = Number(new URLSearchParams(location.search).get("p"));
		return {
			id: m[1],
			p: p >= 1 ? p : 1
		};
	}
	var lastTitle = "";
	var hydrated = false;
	function isHydrated() {
		if (hydrated) return true;
		if (document.readyState !== "complete") return false;
		const app = _unsafeWindow.document.querySelector("#app");
		const nav = performance.getEntriesByType("navigation")[0];
		const sinceLoad = nav?.loadEventEnd ? performance.now() - nav.loadEventEnd : 0;
		hydrated = Boolean(app?.__vue__ || app?.__vue_app__) || sinceLoad > 3e3;
		return hydrated;
	}
	async function getVideoInfo(ref) {
		const json = await fetchJson(`https://api.bilibili.com/x/web-interface/view?${/^av/i.test(ref.id) ? `aid=${ref.id.slice(2)}` : `bvid=${ref.id}`}`);
		if (json.code !== 0) throw new Error(`获取视频信息失败：${json.message ?? json.code}`);
		const data = json.data;
		const pages = data.pages ?? [];
		const page = pages.find((x) => x.page === ref.p) ?? pages[0];
		lastTitle = pages.length > 1 && page?.part ? `${data.title} - ${page.part}` : data.title;
		return {
			aid: data.aid,
			cid: page?.cid ?? data.cid
		};
	}
	async function fetchSubtitleList(aid, cid) {
		const pick = (json) => {
			if (json?.code !== 0 || json.data?.cid && json.data.cid !== cid) return [];
			return json.data?.subtitle?.subtitles ?? [];
		};
		for (let attempt = 0; attempt < 2; attempt++) {
			try {
				const list = pick(await fetchJson(`https://api.bilibili.com/x/player/wbi/v2?${await signWbi({
					aid,
					cid
				})}`));
				if (list.length) return list;
			} catch {}
			try {
				const list = pick(await fetchJson(`https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`));
				if (list.length) return list;
			} catch {}
			await sleep(600);
		}
		return [];
	}
	async function loadSubtitle(sub) {
		let url = sub.subtitle_url ?? "";
		if (!url) throw new Error("无法获取该字幕的地址（B站 AI 字幕需要登录后才能获取）");
		if (url.startsWith("//")) url = `https:${url}`;
		url = url.replace(/^http:/, "https:");
		return ((await fetchJson(url, { credentials: "omit" }))?.body ?? []).map((item) => ({
			start: item.from,
			end: item.to,
			text: item.content
		}));
	}
	var bilibili = {
		site: "bilibili",
		setup() {},
		getVideoKey() {
			const ref = parseLocation();
			return ref ? `bili:${ref.id}:p${ref.p}` : null;
		},
		getTitle() {
			return lastTitle || document.querySelector("h1.video-title, .video-title")?.textContent?.trim() || document.title;
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
		async getTracks() {
			const ref = parseLocation();
			if (!ref) throw new Error("当前页面不是视频页");
			const { aid, cid } = await getVideoInfo(ref);
			const tracks = (await fetchSubtitleList(aid, cid)).map((sub) => ({
				id: sub.id_str ?? String(sub.id ?? sub.lan),
				lang: sub.lan.replace(/^ai-/, ""),
				label: sub.lan_doc || sub.lan,
				isAuto: sub.lan.startsWith("ai-") || (sub.ai_type ?? 0) > 0 || sub.type === 1,
				load: () => loadSubtitle(sub)
			}));
			return {
				tracks,
				originalLang: tracks.find((t) => t.isAuto)?.lang ?? "zh",
				emptyHint: "该视频没有可用字幕。如果视频有 AI 字幕，请先登录 B站 后重试。"
			};
		},
		getVideo() {
			return document.querySelector("#bilibili-player video, #bilibili-player bwp-video, video, bwp-video");
		}
	};
	var captured = new Map();
	function getCaptured(videoId) {
		return captured.get(videoId);
	}
	function record(rawUrl, text) {
		if (!rawUrl.includes("/api/timedtext")) return;
		let url;
		try {
			url = new URL(rawUrl, location.origin);
		} catch {
			return;
		}
		const videoId = url.searchParams.get("v");
		if (!videoId) return;
		const prev = captured.get(videoId);
		if (prev?.url.includes("pot=") && !url.searchParams.has("pot")) return;
		captured.set(videoId, {
			url: url.href,
			text: text ?? (prev?.url === url.href ? prev.text : void 0),
			at: Date.now()
		});
	}
	function installTimedtextInterceptor() {
		try {
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) record(entry.name);
			}).observe({
				type: "resource",
				buffered: true
			});
		} catch {}
		const win = _unsafeWindow;
		try {
			const proto = win.XMLHttpRequest.prototype;
			const originalOpen = proto.open;
			proto.open = function(...args) {
				const url = String(args[1] ?? "");
				if (url.includes("/api/timedtext")) this.addEventListener("load", () => {
					try {
						record(this.responseURL || url, this.responseText);
					} catch {
						record(this.responseURL || url);
					}
				});
				return originalOpen.apply(this, args);
			};
		} catch {}
		try {
			const originalFetch = win.fetch;
			win.fetch = function(input, init) {
				const promise = originalFetch.call(this, input, init);
				const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
				if (url.includes("/api/timedtext")) promise.then((res) => res.clone().text()).then((text) => record(url, text)).catch(() => {});
				return promise;
			};
		} catch {}
	}
	function currentVideoId() {
		if (location.pathname !== "/watch") return null;
		return new URLSearchParams(location.search).get("v");
	}
	function extractJson(source, marker) {
		const m = marker.exec(source);
		if (!m) return null;
		const start = m.index + m[0].length - 1;
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let i = start; i < source.length; i++) {
			const c = source[i];
			if (inString) {
				if (escaped) escaped = false;
				else if (c === "\\") escaped = true;
				else if (c === "\"") inString = false;
				continue;
			}
			if (c === "\"") inString = true;
			else if (c === "{") depth++;
			else if (c === "}" && --depth === 0) try {
				return JSON.parse(source.slice(start, i + 1));
			} catch {
				return null;
			}
		}
		return null;
	}
	async function getPlayerResponse(videoId) {
		try {
			const resp = _unsafeWindow.document.getElementById("movie_player")?.getPlayerResponse?.();
			if (resp?.videoDetails?.videoId === videoId) return resp;
		} catch {}
		const resp = extractJson(await (await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, { credentials: "include" })).text(), /ytInitialPlayerResponse\s*=\s*\{/);
		if (resp?.videoDetails?.videoId && resp.videoDetails.videoId !== videoId) return null;
		return resp;
	}
	function parseJson3(data) {
		const cues = [];
		for (const event of data?.events ?? []) {
			if (!event.segs) continue;
			const text = event.segs.map((seg) => seg.utf8 ?? "").join("").replace(/\s+/g, " ").trim();
			if (!text) continue;
			const start = (event.tStartMs ?? 0) / 1e3;
			cues.push({
				start,
				end: start + (event.dDurationMs ?? 0) / 1e3,
				text
			});
		}
		return cues;
	}
	function parseJson3Text(text) {
		if (!text?.trim()) return [];
		try {
			return parseJson3(JSON.parse(text));
		} catch {
			return [];
		}
	}
	async function fetchJson3(url) {
		url.searchParams.set("fmt", "json3");
		try {
			const res = await fetch(url.href, { credentials: "include" });
			if (!res.ok) return [];
			return parseJson3Text(await res.text());
		} catch {
			return [];
		}
	}
	async function loadViaCaptured(cap, track) {
		const url = new URL(cap.url);
		const p = url.searchParams;
		if (!p.get("tlang") && p.get("lang") === track.languageCode && (p.get("kind") ?? "") === (track.kind ?? "")) {
			const cues = parseJson3Text(cap.text);
			if (cues.length) return cues;
		}
		p.delete("tlang");
		p.delete("name");
		p.set("lang", track.languageCode);
		if (track.kind) p.set("kind", track.kind);
		else p.delete("kind");
		return fetchJson3(url);
	}
	async function triggerCaptions(videoId) {
		const btn = document.querySelector("#movie_player .ytp-subtitles-button");
		if (!btn || getComputedStyle(btn).display === "none") return null;
		const since = Date.now();
		const wasOn = btn.getAttribute("aria-pressed") === "true";
		if (wasOn) {
			btn.click();
			await sleep(300);
		}
		btn.click();
		const got = await waitFor(() => {
			const cap = getCaptured(videoId);
			return cap && cap.at >= since ? cap : null;
		}, 6e3);
		if (!wasOn && btn.getAttribute("aria-pressed") === "true") btn.click();
		return got;
	}
	var SEGMENT_SELECTOR = "ytd-transcript-segment-renderer, transcript-segment-view-model";
	async function readTranscriptPanel() {
		if (!document.querySelector(SEGMENT_SELECTOR)) {
			const btn = document.querySelector("ytd-video-description-transcript-section-renderer button");
			if (!btn) return [];
			btn.click();
			await waitFor(() => document.querySelector(SEGMENT_SELECTOR), 8e3);
		}
		const cues = [];
		for (const seg of document.querySelectorAll(SEGMENT_SELECTOR)) {
			const all = seg.textContent?.replace(/\s+/g, " ").trim() ?? "";
			const ts = /(?:\d+:)?\d{1,2}:\d{2}/.exec(all);
			if (!ts) continue;
			const text = all.replace(ts[0], "").trim();
			if (text) cues.push({
				start: parseTime(ts[0]),
				end: parseTime(ts[0]),
				text
			});
		}
		return cues;
	}
	async function loadTrack(videoId, track) {
		let cap = getCaptured(videoId);
		if (cap) {
			const cues = await loadViaCaptured(cap, track);
			if (cues.length) return cues;
		}
		const direct = await fetchJson3(new URL(track.baseUrl, location.origin));
		if (direct.length) return direct;
		cap = await triggerCaptions(videoId) ?? void 0;
		if (cap) {
			const cues = await loadViaCaptured(cap, track);
			if (cues.length) return cues;
		}
		const transcript = await readTranscriptPanel();
		if (transcript.length) return transcript;
		throw new Error("无法获取 YouTube 字幕。可尝试先手动开启一次播放器字幕（CC）后重试。");
	}
	function trackName(track) {
		return track.name?.simpleText ?? track.name?.runs?.map((r) => r.text).join("") ?? track.languageCode;
	}
	var youtube = {
		site: "youtube",
		setup() {
			installTimedtextInterceptor();
		},
		getVideoKey() {
			const id = currentVideoId();
			return id ? `yt:${id}` : null;
		},
		getTitle() {
			return document.querySelector("ytd-watch-metadata h1")?.textContent?.trim() || document.title.replace(/ - YouTube$/, "");
		},
		mountButton(btn) {
			const container = document.querySelector("ytd-watch-metadata #top-level-buttons-computed") ?? document.querySelector("#top-level-buttons-computed");
			if (!container) return false;
			if (btn.parentElement !== container) container.append(btn);
			return true;
		},
		async getTracks() {
			const videoId = currentVideoId();
			if (!videoId) throw new Error("当前页面不是视频页");
			const raw = ((await getPlayerResponse(videoId))?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []).filter((t) => !/live chat/i.test(trackName(t)));
			return {
				tracks: raw.map((t) => ({
					id: `${t.vssId ?? t.languageCode}|${t.kind ?? ""}`,
					lang: t.languageCode,
					label: trackName(t),
					isAuto: t.kind === "asr",
					load: () => loadTrack(videoId, t)
				})),
				originalLang: raw.find((t) => t.kind === "asr")?.languageCode,
				emptyHint: "该视频没有可用字幕（包括自动生成字幕），无法生成总结。"
			};
		},
		getVideo() {
			return document.querySelector("#movie_player video.html5-main-video") ?? document.querySelector("video");
		}
	};
	var BUTTON_CSS = `
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
	var styled = false;
	function createSiteButton(site, onClick) {
		if (!styled) {
			_GM_addStyle(BUTTON_CSS);
			styled = true;
		}
		const title = "获取视频字幕并用 AI 生成中文总结";
		const handle = (e) => {
			e.preventDefault();
			e.stopPropagation();
			onClick();
		};
		if (site === "bilibili") return h("div", { class: "toolbar-left-item-wrap vs-entry" }, h("div", {
			class: "video-toolbar-left-item vs-bili-btn",
			title,
			onclick: handle
		}, icon(ICONS.summary, 28, "video-toolbar-item-icon"), h("span", { class: "video-toolbar-item-text" }, "视频总结")));
		return h("button", {
			class: "vs-entry vs-yt-btn",
			type: "button",
			title,
			onclick: handle
		}, icon(ICONS.summary, 20), h("span", {}, "视频总结"));
	}
	var adapter = location.hostname.endsWith("bilibili.com") ? bilibili : youtube;
	adapter.setup();
	var controller = new Controller(adapter);
	_GM_registerMenuCommand("生成视频总结", () => controller.run());
	_GM_registerMenuCommand("视频总结设置", () => controller.openSettings());
	var button = null;
	var lastKey;
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
	window.addEventListener("yt-navigate-finish", tick);
	window.addEventListener("popstate", tick);
	document.addEventListener("DOMContentLoaded", tick);
})();
