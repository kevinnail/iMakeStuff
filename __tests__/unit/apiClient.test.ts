import { ApiClientError, fetchBackendHealth, mapStatusToErrorKind } from '@/services/apiClient';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        backendTarget: 'local',
        apiBaseUrlLocal: 'http://localhost:7890',
        apiBaseUrlRailway: 'https://example.up.railway.app',
      },
    },
  },
}));

function makeJsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('mapStatusToErrorKind', () => {
  // Otherwise a signed out or unsubscribed phone shows a general error instead of asking to sign in or subscribe.
  it('maps auth and conflict statuses', () => {
    expect(mapStatusToErrorKind(401)).toBe('unauthorized');
    expect(mapStatusToErrorKind(403)).toBe('forbidden');
    expect(mapStatusToErrorKind(409)).toBe('conflict');
  });

  // Otherwise a server outage reads as a bad request and the phone stops retrying a push that would work later.
  it('maps 5xx statuses to server', () => {
    expect(mapStatusToErrorKind(500)).toBe('server');
    expect(mapStatusToErrorKind(503)).toBe('server');
  });

  // Otherwise an ordinary 400 or 404 gets mistaken for an auth or server problem.
  it('maps other statuses to generic http', () => {
    expect(mapStatusToErrorKind(400)).toBe('http');
    expect(mapStatusToErrorKind(404)).toBe('http');
  });
});

describe('fetchBackendHealth', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // Otherwise the app can't reach the server at the configured address or drops the session cookie.
  it('returns the health body from the configured server with credentials', async () => {
    const health = { status: 'ok', timestamp: '2026-11-10T12:00:00.000Z' };
    const fetchMock = jest.fn().mockResolvedValue(makeJsonResponse(health, 200));
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await expect(fetchBackendHealth()).resolves.toEqual(health);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:7890/health');
    expect(requestInit.method).toBe('GET');
    expect(requestInit.credentials).toBe('include');
  });

  // Otherwise the server's own reason, like a missing subscription, never reaches the screen.
  it('maps a 403 response to a forbidden error carrying the server message', async () => {
    const errorBody = { error: 'Subscription required' };
    global.fetch = jest
      .fn()
      .mockResolvedValue(makeJsonResponse(errorBody, 403)) as unknown as typeof global.fetch;

    const error = await fetchBackendHealth().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toEqual(
      expect.objectContaining({
        message: 'Subscription required',
        kind: 'forbidden',
        status: 403,
        body: errorBody,
      }),
    );
  });

  // Otherwise no signal or a server that's down crashes the call instead of becoming an error the Backup screen can show.
  it('maps network failures to a network error', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('Network down')) as unknown as typeof global.fetch;

    const error = await fetchBackendHealth().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toEqual(
      expect.objectContaining({ message: 'Network down', kind: 'network', status: undefined }),
    );
  });
});
