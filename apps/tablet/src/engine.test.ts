import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultSettings,
  reminderInputSchema,
  type Occurrence,
  type Snapshot,
  type Version,
} from '@faminder/shared';
const mocks = vi.hoisted(() => ({
  meta: new Map<string, unknown>(),
  claimed: new Set<string>(),
  statuses: [] as { id: string; kind: string }[],
  snoozes: [] as unknown[],
  ensure: vi.fn(),
  acknowledged: vi.fn(),
  player: vi.fn(),
  state: { currentState: 'active' },
}));
vi.mock('react-native', () => ({ AppState: mocks.state }));
vi.mock('expo-audio', () => ({ setAudioModeAsync: vi.fn(), createAudioPlayer: mocks.player }));
vi.mock('./chime', () => ({ chimeSource: 101 }));
vi.mock('./storage', () => ({
  get: async (key: string) => structuredClone(mocks.meta.get(key) ?? null),
  put: async (key: string, value: unknown) => {
    mocks.meta.set(key, structuredClone(value));
  },
  ensureSpeech: mocks.ensure,
  pendingEvents: async () => [{ id: 'event-1' }],
  acknowledge: mocks.acknowledged,
  cleanup: vi.fn(),
  wipe: async () => {
    mocks.meta.clear();
    mocks.claimed.clear();
  },
  recoverInterrupted: vi.fn(),
  audioPath: (id: string) => `local/${id}.wav`,
  dueSnoozes: async () => mocks.snoozes,
  removeSnooze: async (id: string) => {
    mocks.snoozes = mocks.snoozes.filter((s) => (s as Occurrence).id !== id);
  },
  claim: async (o: Occurrence) => {
    if (mocks.claimed.has(o.id)) return false;
    mocks.claimed.add(o.id);
    return true;
  },
  record: async (o: Occurrence, kind: string) => {
    mocks.statuses.push({ id: o.id, kind });
  },
}));
import { disconnectDevice, playFile, Scheduler, stopAudio, synchronize } from './engine';
let scheduler: Scheduler | null = null;
const at = Date.parse('2026-10-07T17:30:20Z');
function fixture(revision = 'old', enabled = true): Snapshot {
  const version: Version = {
    ...reminderInputSchema.parse({
      title: 'Dişler',
      text: 'Diş fırçalama zamanı.',
      schedule: { kind: 'daily', time: '20:30' },
    }),
    audioKey: revision === 'old' ? 'a'.repeat(64) : 'b'.repeat(64),
    revision,
    createdAt: new Date(at).toISOString(),
  };
  return {
    family: { id: 'family-1', ...defaultSettings },
    members: [],
    devices: [],
    events: [],
    serverTime: new Date(at).toISOString(),
    capabilities: { speechConfigured: true, model: 'test' },
    reminders: [
      {
        id: 'routine-1',
        familyId: 'family-1',
        content: version,
        enabled,
        updatedAt: new Date(at).toISOString(),
      },
    ],
  };
}
const turns = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
function manualPlayback() {
  let finish!: (s: unknown) => void;
  const players: { volume: number; remove: ReturnType<typeof vi.fn> }[] = [];
  mocks.player.mockImplementation(() => {
    const player = {
      volume: 1,
      addListener: (_: string, cb: typeof finish) => {
        finish = cb;
        return { remove: vi.fn() };
      },
      play: vi.fn(),
      remove: vi.fn(),
    };
    players.push(player);
    return player;
  });
  return { finish: () => finish({ isLoaded: true, didJustFinish: true }), players };
}
beforeEach(() => {
  vi.stubGlobal('AbortSignal', class {});
  vi.useFakeTimers();
  vi.setSystemTime(at);
  vi.stubEnv('EXPO_PUBLIC_API_URL', 'https://faminder.test/api');
  mocks.meta.clear();
  mocks.claimed.clear();
  mocks.statuses.length = 0;
  mocks.snoozes = [];
  mocks.state.currentState = 'active';
  mocks.ensure.mockReset().mockResolvedValue(undefined);
  mocks.acknowledged.mockReset();
  mocks.player.mockReset();
  mocks.player.mockImplementation(() => {
    let listener: (s: unknown) => void;
    return {
      volume: 1,
      addListener: (_event: string, cb: typeof listener) => {
        listener = cb;
        return { remove: vi.fn() };
      },
      play: () => {
        void Promise.resolve().then(() => listener({ isLoaded: true, didJustFinish: true }));
      },
      remove: vi.fn(),
    };
  });
  mocks.meta.set('snapshot', fixture());
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(url.endsWith('/snapshot') ? fixture('new') : { accepted: ['event-1'] }),
          { status: 200 },
        ),
    ),
  );
});
afterEach(async () => {
  await scheduler?.stop();
  scheduler = null;
  stopAudio();
  await turns();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('text delivery and on-demand speech', () => {
  it('installs and acknowledges text immediately without generating audio', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(fixture('new', false))));
    const result = await synchronize('device');
    expect(result.snapshot.reminders[0].content.revision).toBe('new');
    expect(result.snapshot.reminders[0].enabled).toBe(false);
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.acknowledged).toHaveBeenCalledWith(['event-1']);
    const heartbeat = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith('/heartbeat'))!;
    expect(JSON.parse(heartbeat[1]!.body as string)).toEqual({ installed: { 'routine-1': 'new' } });
  });
  it('does not restore an old session after a pending snapshot fetch resolves', async () => {
    let release!: (value: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const sync = synchronize('old-device').catch((e) => e);
    const disconnect = disconnectDevice();
    release(new Response(JSON.stringify(fixture('new'))));
    await Promise.all([sync, disconnect]);
    expect(mocks.meta.size).toBe(0);
  });
  it('does not read old text if a new revision arrives while speech is prepared', async () => {
    mocks.ensure.mockImplementation(async () => {
      mocks.meta.set('snapshot', fixture('new'));
    });
    scheduler = new Scheduler(vi.fn(), vi.fn(), vi.fn(), 'device');
    await scheduler.start();
    await turns();
    expect(mocks.player).not.toHaveBeenCalled();
    expect(mocks.statuses.map((s) => s.kind)).toEqual(['interrupted']);
  });
  it('records a failed first reading when Gemini is unavailable', async () => {
    mocks.ensure.mockRejectedValue(new Error('İnternet gerekli'));
    const error = vi.fn();
    scheduler = new Scheduler(vi.fn(), vi.fn(), error, 'device');
    await scheduler.start();
    await turns();
    expect(mocks.statuses.map((s) => s.kind)).toEqual(['failed']);
    expect(mocks.player).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith('İnternet gerekli');
  });
  it('rechecks quiet hours after speech generation', async () => {
    mocks.ensure.mockImplementation(async () => {
      const s = fixture();
      s.family.quietStart = '20:00';
      mocks.meta.set('snapshot', s);
    });
    scheduler = new Scheduler(vi.fn(), vi.fn(), vi.fn(), 'device');
    await scheduler.start();
    await turns();
    expect(mocks.statuses.map((s) => s.kind)).toEqual(['quiet']);
    expect(mocks.player).not.toHaveBeenCalled();
  });
  it('plays an occurrence at most once across scheduler restarts', async () => {
    scheduler = new Scheduler(vi.fn(), vi.fn(), vi.fn(), 'device');
    await scheduler.start();
    await turns();
    expect(mocks.statuses.map((s) => s.kind)).toEqual(['played']);
    await scheduler.stop();
    mocks.meta.set('lastTick', at - 60000);
    scheduler = new Scheduler(vi.fn(), vi.fn(), vi.fn(), 'device');
    await scheduler.start();
    await turns();
    expect(mocks.player).toHaveBeenCalledTimes(2);
  });
  it('marks overdue routines missed instead of announcing a backlog', async () => {
    vi.setSystemTime(at + 10 * 60000);
    mocks.meta.set('lastTick', at - 60000);
    scheduler = new Scheduler(vi.fn(), vi.fn(), vi.fn(), 'device');
    await scheduler.start();
    await turns();
    expect(mocks.statuses.map((s) => s.kind)).toEqual(['missed']);
    expect(mocks.player).not.toHaveBeenCalled();
  });
  it('shows quiet-hour reminders without playing audio', async () => {
    const snapshot = fixture();
    snapshot.family.quietStart = '20:00';
    mocks.meta.set('snapshot', snapshot);
    const changed = vi.fn();
    scheduler = new Scheduler(changed, vi.fn(), vi.fn(), 'device');
    await scheduler.start();
    await turns();
    expect(mocks.statuses.map((s) => s.kind)).toEqual(['quiet']);
    expect(changed).toHaveBeenCalled();
    expect(mocks.player).not.toHaveBeenCalled();
  });
  it('cancels a snoozed announcement after its routine is paused', async () => {
    const snapshot = fixture('old', false);
    mocks.meta.set('snapshot', snapshot);
    mocks.snoozes = [
      {
        id: 'snooze-1',
        reminderId: 'routine-1',
        scheduledAt: new Date(at).toISOString(),
        version: snapshot.reminders[0].content,
      },
    ];
    scheduler = new Scheduler(vi.fn(), vi.fn(), vi.fn(), 'device');
    await scheduler.start();
    await turns();
    expect(mocks.snoozes).toHaveLength(0);
    expect(mocks.player).not.toHaveBeenCalled();
  });
  it('serializes sound checks and reminders, and cancels the queue on backgrounding', async () => {
    const playback = manualPlayback();
    const first = playFile('test').catch((e) => e),
      second = playFile('reminder').catch((e) => e);
    await turns();
    expect(mocks.player).toHaveBeenCalledTimes(1);
    expect(mocks.player.mock.calls[0][0]).toBe(101);
    expect(playback.players[0].volume).toBeLessThan(1);
    playback.finish();
    await turns();
    expect(mocks.player).toHaveBeenCalledTimes(2);
    expect(mocks.player.mock.calls[1][0]).toBe('local/test.wav');
    expect(playback.players[0].remove).toHaveBeenCalledOnce();
    expect(playback.players[1].volume).toBe(1);
    playback.finish();
    await turns();
    expect(mocks.player).toHaveBeenCalledTimes(3);
    expect(mocks.player.mock.calls[2][0]).toBe(101);
    mocks.state.currentState = 'background';
    stopAudio();
    expect(await first).toBeUndefined();
    expect(await second).toBeInstanceOf(Error);
    expect(playback.players[2].remove).toHaveBeenCalledOnce();
    expect(mocks.player).toHaveBeenCalledTimes(3);
  });
  it('waits for speech preparation before starting the cue', async () => {
    let ready!: () => void;
    const speechReady = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const work = playFile('test', () => speechReady);
    await turns();
    expect(mocks.player).not.toHaveBeenCalled();
    ready();
    await work;
    expect(mocks.player.mock.calls.map(([source]) => source)).toEqual([101, 'local/test.wav']);
  });
  it.each(['paused', 'revised', 'quiet'] as const)(
    'rechecks the reminder after the cue when it becomes %s',
    async (change) => {
      const playback = manualPlayback();
      scheduler = new Scheduler(vi.fn(), vi.fn(), vi.fn(), 'device');
      await scheduler.start();
      await turns();
      expect(mocks.player).toHaveBeenCalledTimes(1);
      const snapshot = fixture(change === 'revised' ? 'new' : 'old', change !== 'paused');
      if (change === 'quiet') snapshot.family.quietStart = '20:00';
      mocks.meta.set('snapshot', snapshot);
      playback.finish();
      await turns();
      expect(mocks.player).toHaveBeenCalledTimes(1);
      expect(mocks.statuses.map((s) => s.kind)).toEqual([
        change === 'quiet' ? 'quiet' : 'interrupted',
      ]);
    },
  );
  it('does not start speech when the cue cannot finish', async () => {
    const playback = manualPlayback();
    const work = playFile('test').catch((e) => e);
    await turns();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await work).toBeInstanceOf(Error);
    expect(mocks.player).toHaveBeenCalledTimes(1);
    expect(playback.players[0].remove).toHaveBeenCalledOnce();
  });
});
