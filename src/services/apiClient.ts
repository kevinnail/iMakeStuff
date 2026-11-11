import { getBackendBaseUrl } from '@/constants/runtime';

export type ApiErrorKind =
  'unauthorized' | 'forbidden' | 'conflict' | 'server' | 'network' | 'invalid-response' | 'http';

export class ApiClientError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly body?: unknown;

  constructor(message: string, kind: ApiErrorKind, status?: number, body?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

export function mapStatusToErrorKind(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 409) return 'conflict';
  if (status >= 500) return 'server';
  return 'http';
}

function joinUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
    return body.error;
  }

  return `Request failed (${status})`;
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }

  const text = await response.text();
  return text.length > 0 ? text : null;
}

export async function requestJson<ResponseBody>(
  path: string,
  init: RequestInit = {},
): Promise<ResponseBody> {
  const url = joinUrl(getBackendBaseUrl(), path);
  const headers = new Headers(init.headers ?? {});

  if (!headers.has('accept')) headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      credentials: 'include',
      headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network request failed';
    throw new ApiClientError(message, 'network');
  }

  const body = await parseResponseBody(response);

  if (!response.ok) {
    const kind = mapStatusToErrorKind(response.status);
    throw new ApiClientError(
      extractErrorMessage(body, response.status),
      kind,
      response.status,
      body,
    );
  }

  if (body === null || body === '') {
    throw new ApiClientError(
      'Expected JSON response body',
      'invalid-response',
      response.status,
      body,
    );
  }

  if (typeof body !== 'object') {
    throw new ApiClientError(
      'Expected JSON object response body',
      'invalid-response',
      response.status,
      body,
    );
  }

  return body as ResponseBody;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
}

export function fetchBackendHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>('/health', { method: 'GET' });
}
