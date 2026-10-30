import type { SearchHit } from '../src/core/types';
import {
  PLAYBACK_SESSION_KEY,
  PLAYBACK_SESSION_VERSION,
  clearSession,
  createSessionRecorder,
  loadSession,
  parseSession,
  planRestore,
  saveSession,
  serializeSession,
} from '../src/services/playbackSession';
import type { PlaybackSession, SessionStore } from '../src/services/playbackSession';

function hit(username = 'peer_one', filename = 'Music\\Daft Punk\\01 - One More Time.mp3'): SearchHit {
  return {
    username,
    filename,
    size: 5_000_000,
    extension: 'mp3',
    slotFree: true,
    avgSpeed: 100_000,
    queueLength: 0,
    bitrate: 320,
    durationSec: 200,
  };
}

function session(overrides: Partial<PlaybackSession> = {}): PlaybackSession {
  return {
    version: PLAYBACK_SESSION_VERSION,
    hit: hit(),
    source: 'network',
    queue: [hit('peer_two', 'Music\\Daft Punk\\02 - Aerodynamic.mp3')],
    context: { label: 'Recherche « daft punk »', items: [hit()], index: 0 },
    catalogContext: null,
    shuffle: true,
    repeat: false,
    positionSec: 42.4,
    savedAt: 1_700_000_000_000,
    ...overrides,
  };
}

/** In-memory stand-in for AsyncStorage. */
function fakeStore(initial: Record<string, string> = {}): SessionStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: jest.fn(async key => data.get(key) ?? null),
    setItem: jest.fn(async (key, value) => {
      data.set(key, value);
    }),
    removeItem: jest.fn(async key => {
      data.delete(key);
    }),
  };
}

describe('playback session serialisation', () => {
  it('round-trips every field under a version', () => {
    const saved = session();
    const parsed = parseSession(serializeSession(saved));

    expect(parsed).toEqual(saved);
    expect(parsed?.version).toBe(PLAYBACK_SESSION_VERSION);
  });

  it('rejects a session from an unknown version', () => {
    const raw = JSON.stringify({ ...session(), version: 99 });
    expect(parseSession(raw)).toBeNull();
  });

  it('rejects corrupted JSON and a session without a playable hit', () => {
    expect(parseSession('{ not json')).toBeNull();
    expect(parseSession(JSON.stringify({ ...session(), hit: null }))).toBeNull();
    expect(parseSession(JSON.stringify({ ...session(), hit: { username: '' } }))).toBeNull();
  });

  it('drops invalid queue entries and clamps an out-of-range context index', () => {
    const parsed = parseSession(
      JSON.stringify({
        ...session(),
        queue: [hit(), { username: 'broken' }],
        context: { label: 'Liste', items: [hit()], index: 7 },
      }),
    );

    expect(parsed?.queue).toHaveLength(1);
    expect(parsed?.context?.index).toBe(0);
  });

  it('keeps a versioned session on disk and clears it on request', async () => {
    const store = fakeStore();
    await saveSession(session(), store);
    expect(store.data.has(PLAYBACK_SESSION_KEY)).toBe(true);
    expect((await loadSession(store))?.positionSec).toBe(42.4);

    await clearSession(store);
    expect(store.data.has(PLAYBACK_SESSION_KEY)).toBe(false);
    expect(await loadSession(store)).toBeNull();
  });
});

describe('debounced session recorder', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits before writing, then writes the latest position once', async () => {
    const store = fakeStore();
    let position = 10;
    const recorder = createSessionRecorder({
      store,
      debounceMs: 1000,
      tickMs: 0,
      snapshot: () => session(),
      position: async () => position,
    });

    recorder.touch();
    expect(store.setItem).not.toHaveBeenCalled();
    position = 12.5;
    recorder.touch();
    await jest.advanceTimersByTimeAsync(1000);

    expect(store.setItem).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(store.data.get(PLAYBACK_SESSION_KEY)!);
    expect(saved.positionSec).toBe(12.5);
    expect(saved.version).toBe(PLAYBACK_SESSION_VERSION);

    await recorder.stop();
  });

  it('flushes a pending session on shutdown without waiting for the timer', async () => {
    const store = fakeStore();
    const recorder = createSessionRecorder({
      store,
      debounceMs: 60_000,
      tickMs: 0,
      snapshot: () => session({ positionSec: 3 }),
      position: async () => 77.2,
    });

    recorder.touch();
    await recorder.stop();

    const saved = JSON.parse(store.data.get(PLAYBACK_SESSION_KEY)!);
    expect(saved.positionSec).toBeCloseTo(77.2, 5);
  });

  it('clears the stored session when playback stops', async () => {
    const store = fakeStore({ [PLAYBACK_SESSION_KEY]: serializeSession(session()) });
    let snapshot: PlaybackSession | null = session();
    const recorder = createSessionRecorder({
      store,
      debounceMs: 10,
      tickMs: 0,
      snapshot: () => (snapshot ? session() : null),
      position: async () => 0,
    });

    recorder.touch();
    snapshot = null;
    await jest.advanceTimersByTimeAsync(10);

    expect(store.data.has(PLAYBACK_SESSION_KEY)).toBe(false);
    await recorder.stop();
  });

  it('does not schedule a write when nothing is playing', async () => {
    const store = fakeStore();
    const recorder = createSessionRecorder({
      store,
      debounceMs: 10,
      tickMs: 0,
      snapshot: () => null,
      position: async () => 0,
    });

    recorder.touch();
    await jest.advanceTimersByTimeAsync(10);
    expect(store.setItem).not.toHaveBeenCalled();

    await recorder.stop();
  });
});

describe('restore decision', () => {
  const base = session();

  it('plays the local copy when the track is still cached', () => {
    expect(planRestore(base, { online: false, cached: true })).toBe('play-cache');
    expect(planRestore({ ...base, source: 'cache' }, { online: true, cached: true })).toBe('play-cache');
  });

  it('uses the network source when it is online and nothing is cached', () => {
    expect(planRestore(base, { online: true, cached: false })).toBe('play-network');
  });

  it('waits instead of losing the session while offline', () => {
    expect(planRestore(base, { online: false, cached: false })).toBe('wait');
  });
});
