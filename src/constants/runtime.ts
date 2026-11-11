import Constants from 'expo-constants';

type BackendTarget = 'local' | 'railway';

type RuntimeExtra = {
  backendTarget?: string;
  apiBaseUrlLocal?: string;
  apiBaseUrlRailway?: string;
};

const DEFAULT_LOCAL_API_BASE_URL = 'http://localhost:7890';

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function normalizeBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return stripWrappingQuotes(value).replace(/\/+$/, '');
}

function readBackendTarget(raw: string | undefined): BackendTarget {
  const normalized = (raw ?? '').toLowerCase();
  return normalized === 'railway' ? 'railway' : 'local';
}

const extra = (Constants.expoConfig?.extra ?? {}) as RuntimeExtra;

const backendTarget = readBackendTarget(
  asNonEmptyString(process.env.EXPO_PUBLIC_BACKEND_TARGET) ?? asNonEmptyString(extra.backendTarget),
);

const localBaseUrl = normalizeBaseUrl(
  asNonEmptyString(process.env.EXPO_PUBLIC_API_BASE_URL_LOCAL) ??
    asNonEmptyString(extra.apiBaseUrlLocal) ??
    DEFAULT_LOCAL_API_BASE_URL,
)!;

const railwayBaseUrl = normalizeBaseUrl(
  asNonEmptyString(process.env.EXPO_PUBLIC_API_BASE_URL_RAILWAY) ??
    asNonEmptyString(extra.apiBaseUrlRailway),
);

export function getBackendTarget(): BackendTarget {
  return backendTarget;
}

export function getBackendBaseUrl(): string {
  if (backendTarget === 'railway' && railwayBaseUrl) {
    return railwayBaseUrl;
  }

  return localBaseUrl;
}
