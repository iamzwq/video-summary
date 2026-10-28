import { GM_getValue, GM_setValue } from '$';
import { DEFAULT_PROMPT } from './prompt';

export type ThinkingMode = 'enabled' | 'disabled' | 'auto';
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface Settings {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
  /** Sent as `thinking: { type }` (Doubao / GLM / DeepSeek style). */
  thinking: ThinkingMode;
  /** Sent as `reasoning_effort` (OpenAI / Doubao style). */
  reasoningEffort: ReasoningEffort;
  chunkTokens: number;
  /** Max number of cached summaries; 0 disables caching. */
  cacheSize: number;
  prompt: string;
}

export const DEFAULT_SETTINGS: Settings = {
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.3,
  thinking: 'disabled',
  reasoningEffort: 'minimal',
  chunkTokens: 12000,
  cacheSize: 20,
  prompt: DEFAULT_PROMPT,
};

const KEY = 'settings';

export function getSettings(): Settings {
  const saved = GM_getValue<Partial<Record<keyof Settings, unknown>>>(KEY, {});
  // Older versions stored 'default' for these two fields.
  if (saved.thinking === 'default') delete saved.thinking;
  if (saved.reasoningEffort === 'default') delete saved.reasoningEffort;
  return { ...DEFAULT_SETTINGS, ...(saved as Partial<Settings>) };
}

export function saveSettings(settings: Settings): void {
  GM_setValue(KEY, settings);
}

export function isConfigured(s: Settings): boolean {
  if (!s.baseURL.trim() || !s.model.trim()) return false;
  if (s.apiKey.trim()) return true;
  try {
    // Local servers such as Ollama do not need a key.
    return /^(localhost|127\.|\[::1\])/.test(new URL(s.baseURL).hostname);
  } catch {
    return false;
  }
}
