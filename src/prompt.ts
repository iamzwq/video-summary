export const DEFAULT_PROMPT = `你是一名专业的视频内容分析助手。用户会提供视频标题和带时间戳的字幕（字幕可能是任意语言，也可能是语音自动识别生成、含有错别字）。请基于字幕内容输出结构化总结，要求：

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

export const CHUNK_PROMPT = `你是一名视频内容分析助手。用户会提供一个长视频字幕中的一部分（带 [mm:ss] 时间戳，可能是任意语言）。请用简体中文提炼这一部分的内容要点：
- 使用无序列表，按时间顺序输出；
- 每条以该内容对应的 [mm:ss] 时间戳开头；
- 只输出要点，不要开场白，不要编造字幕中没有的信息。`;

export function buildUserMessage(title: string, transcript: string): string {
  return `视频标题：${title}\n\n字幕：\n${transcript}`;
}

export function buildChunkMessage(title: string, index: number, total: number, transcript: string): string {
  return `视频标题：${title}\n\n以下是字幕的第 ${index + 1}/${total} 部分：\n${transcript}`;
}

export function buildMergeMessage(title: string, notes: string[]): string {
  const body = notes.map((note, i) => `### 第 ${i + 1} 部分\n${note}`).join('\n\n');
  return `视频标题：${title}\n\n该视频较长，以下是按时间顺序整理的各部分要点笔记（代替完整字幕）：\n\n${body}\n\n请据此输出完整的视频总结。`;
}
