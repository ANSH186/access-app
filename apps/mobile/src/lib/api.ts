import { API_URL } from './env';
import { speak } from './speech';
import { supabase } from './supabase';
import type {
  CommandResult,
  DestinationResult,
  OcrResult,
  RoutePlan,
  VisionResult,
} from './types';

const FIRST_TIMEOUT_MS = 70_000;
const NORMAL_TIMEOUT_MS = 30_000;
const SLOW_NOTICE_MS = 5_000;

export const WAKING_MESSAGE = 'Waking up the server, this can take up to a minute.';

export class ApiError extends Error {
  /** Plain sentence that is safe to speak aloud. */
  spoken: string;
  status: number;
  code: string;
  constructor(spoken: string, status = 0, code = 'error') {
    super(spoken);
    this.spoken = spoken;
    this.status = status;
    this.code = code;
  }
}

export function errorToSpeech(e: unknown): string {
  if (e instanceof ApiError) return e.spoken;
  if (e instanceof Error && e.message) return e.message;
  return 'Something went wrong. Please try again.';
}

// ---- "server is waking up" notification channel -------------------------------
let slowCount = 0;
const slowListeners = new Set<(slow: boolean) => void>();
export function subscribeSlow(cb: (slow: boolean) => void) {
  slowListeners.add(cb);
  return () => {
    slowListeners.delete(cb);
  };
}
function bumpSlow(delta: number) {
  slowCount = Math.max(0, slowCount + delta);
  slowListeners.forEach((cb) => cb(slowCount > 0));
}

let warm = false; // becomes true after the first successful response

type Options = {
  method?: 'GET' | 'POST';
  json?: unknown;
  form?: FormData;
  /** Called once if the request takes longer than 5 s (server probably waking up). */
  onSlow?: () => void;
};

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError('Please sign in again.', 401, 'unauthenticated');

  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form; // fetch sets the multipart boundary itself
  } else if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }

  const ctrl = new AbortController();
  const timeoutMs = warm ? NORMAL_TIMEOUT_MS : FIRST_TIMEOUT_MS;
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
  let slowFired = false;
  const slowTimer = setTimeout(() => {
    slowFired = true;
    bumpSlow(1);
    speak(WAKING_MESSAGE);
    opts.onSlow?.();
  }, SLOW_NOTICE_MS);

  try {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method: opts.method ?? (body ? 'POST' : 'GET'),
        headers,
        body,
        signal: ctrl.signal,
      });
    } catch (e) {
      if (ctrl.signal.aborted) {
        throw new ApiError(
          'The server took too long to answer. Please try again in a moment.',
          0,
          'timeout',
        );
      }
      throw new ApiError(
        'I could not reach the server. Check your internet connection and try again.',
        0,
        'network',
      );
    }

    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (!res.ok) {
      const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
      let spoken = err?.message;
      if (!spoken) {
        if (res.status === 401) spoken = 'Your session has expired. Please sign in again.';
        else if (res.status === 429) spoken = 'Too many requests. Please wait a minute and try again.';
        else if (res.status >= 500) spoken = 'The server had a problem. Please try again in a minute.';
        else spoken = 'That request did not work. Please try again.';
      }
      throw new ApiError(spoken, res.status, err?.code ?? 'http_error');
    }
    warm = true;
    return json as T;
  } finally {
    clearTimeout(timeout);
    clearTimeout(slowTimer);
    if (slowFired) bumpSlow(-1);
  }
}

type FileLike = { uri: string; name: string; type: string };
function appendFile(form: FormData, field: string, file: FileLike) {
  // React Native's FormData accepts {uri,name,type} objects.
  form.append(field, file as unknown as Blob);
}

export const api = {
  health: () => request<{ status: string; time: string }>('/health'),

  searchDestinations: (q: string, onSlow?: () => void) =>
    request<{ results: DestinationResult[] }>(`/v1/destinations/search?q=${encodeURIComponent(q)}`, {
      onSlow,
    }),

  planRoute: (
    body: { from_node_id: string; to_node_id: string; avoid_stairs: boolean },
    onSlow?: () => void,
  ) => request<RoutePlan>('/v1/routes/plan', { method: 'POST', json: body, onSlow }),

  readSign: (imageUri: string, question?: string, onSlow?: () => void) => {
    const form = new FormData();
    appendFile(form, 'image', { uri: imageUri, name: 'sign.jpg', type: 'image/jpeg' });
    if (question) form.append('question', question);
    return request<OcrResult>('/v1/ocr/read', { method: 'POST', form, onSlow });
  },

  describeScene: (imageUri: string, question?: string, onSlow?: () => void) => {
    const form = new FormData();
    appendFile(form, 'image', { uri: imageUri, name: 'scene.jpg', type: 'image/jpeg' });
    if (question) form.append('question', question);
    return request<VisionResult>('/v1/vision/describe', { method: 'POST', form, onSlow });
  },

  commandText: (text: string, onSlow?: () => void) => {
    const form = new FormData();
    form.append('text', text);
    return request<CommandResult>('/v1/assistant/command', { method: 'POST', form, onSlow });
  },

  commandAudio: (audioUri: string, onSlow?: () => void) => {
    const form = new FormData();
    appendFile(form, 'audio', { uri: audioUri, name: 'command.m4a', type: 'audio/mp4' });
    return request<CommandResult>('/v1/assistant/command', { method: 'POST', form, onSlow });
  },
};

/** Hook-style accessor. The "waking up" notice is spoken and shown by <ApiStatusBanner/>. */
export function useApi() {
  return api;
}
