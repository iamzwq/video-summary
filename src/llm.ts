import { GM_xmlhttpRequest } from '$';
import { buildChunkMessage, buildMergeMessage, buildUserMessage, CHUNK_PROMPT } from './prompt';
import type { Settings } from './settings';
import { chunkLines } from './subtitle';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function endpoint(baseURL: string): string {
  const base = baseURL.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

function safeText(read: () => string): string {
  try {
    const text = read();
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}

/** Calls an OpenAI-compatible chat completion (non-streaming) and resolves with the answer text. */
export function chat(s: Settings, messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null, content = '') => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(content);
    };

    const req = GM_xmlhttpRequest({
      method: 'POST',
      url: endpoint(s.baseURL),
      headers: {
        'Content-Type': 'application/json',
        ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {}),
      },
      data: JSON.stringify({
        model: s.model,
        messages,
        temperature: s.temperature,
        stream: false,
        thinking: { type: s.thinking },
        reasoning_effort: s.reasoningEffort,
      }),
      onload: (r) => {
        const text = safeText(() => r.responseText);
        let json: any;
        try {
          json = JSON.parse(text);
        } catch {
          return finish(new Error(`HTTP ${r.status}: ${text.slice(0, 300) || '响应为空'}`));
        }
        if (r.status >= 400 || json.error) {
          return finish(new Error(json.error?.message || json.message || `HTTP ${r.status}`));
        }
        const choice = json.choices?.[0];
        const content: string = choice?.message?.content ?? '';
        if (content.trim()) return finish(null, content);
        if (choice?.message?.reasoning_content) {
          return finish(
            new Error(
              choice.finish_reason === 'length'
                ? '模型在思考阶段就用完了输出长度，未给出回答'
                : '模型只返回了思考内容，没有给出回答',
            ),
          );
        }
        finish(new Error('模型没有返回任何内容'));
      },
      onerror: (r) => {
        const detail = [r.status ? `HTTP ${r.status}` : '', r.error ?? '', safeText(() => r.responseText).slice(0, 200)]
          .filter(Boolean)
          .join(' ');
        finish(new Error(`网络请求失败${detail ? `（${detail}）` : ''}，请检查 baseURL、网络或脚本管理器的跨域授权`));
      },
      ontimeout: () => finish(new Error('请求超时')),
    });

    const onAbort = () => {
      req.abort();
      finish(new DOMException('Aborted', 'AbortError'));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort);
  });
}

export async function testConnection(s: Settings): Promise<string> {
  const reply = await chat(s, [{ role: 'user', content: '请只回复：OK' }]);
  return reply.trim();
}

export interface SummarizeOptions {
  title: string;
  lines: string[];
  settings: Settings;
  signal: AbortSignal;
  onStatus: (text: string) => void;
}

/** Single pass for short transcripts; map-reduce over chunks for long ones. */
export async function summarize(o: SummarizeOptions): Promise<string> {
  const s = o.settings;
  const chunks = chunkLines(o.lines, Math.max(2000, s.chunkTokens));
  if (chunks.length === 1) {
    o.onStatus('正在生成总结，请稍候…');
    return chat(
      s,
      [
        { role: 'system', content: s.prompt },
        { role: 'user', content: buildUserMessage(o.title, chunks[0]) },
      ],
      o.signal,
    );
  }

  const notes: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    o.onStatus(`视频较长，正在分段分析字幕（${i + 1}/${chunks.length}）…`);
    notes.push(
      await chat(
        s,
        [
          { role: 'system', content: CHUNK_PROMPT },
          { role: 'user', content: buildChunkMessage(o.title, i, chunks.length, chunks[i]) },
        ],
        o.signal,
      ),
    );
  }
  o.onStatus('正在汇总生成总结，请稍候…');
  return chat(
    s,
    [
      { role: 'system', content: s.prompt },
      { role: 'user', content: buildMergeMessage(o.title, notes) },
    ],
    o.signal,
  );
}
