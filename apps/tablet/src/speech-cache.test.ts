import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { reminderInputSchema, type Occurrence } from '@faminder/shared';
const mock = vi.hoisted(() => ({ files: new Map<string, Uint8Array>(), move: vi.fn() }));
vi.mock('expo-sqlite', () => ({}));
vi.mock('expo-secure-store', () => ({}));
vi.mock('expo-crypto', () => ({ randomUUID: vi.fn() }));
vi.mock('expo-file-system', () => ({
  File: class {
    constructor(public path: string) {}
    write(value: Uint8Array) {
      mock.files.set(this.path, value);
    }
  },
}));
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///test/',
  getInfoAsync: async (path: string) =>
    mock.files.has(path) ? { exists: true, size: mock.files.get(path)!.length } : { exists: false },
  makeDirectoryAsync: vi.fn(),
  moveAsync: mock.move,
  deleteAsync: async (path: string) => {
    mock.files.delete(path);
  },
}));
import { audioPath, ensureSpeech } from './storage';
const key = 'a'.repeat(64);
const wav = new Uint8Array(44);
wav.set([82, 73, 70, 70]);
wav.set([87, 65, 86, 69], 8);
const occurrence: Occurrence = {
  id: 'event-1',
  reminderId: 'routine-1',
  scheduledAt: new Date().toISOString(),
  version: {
    ...reminderInputSchema.parse({
      title: 'Su molası',
      text: 'Bir bardak su içelim.',
      schedule: { kind: 'daily', time: '16:00' },
    }),
    revision: 'v1',
    audioKey: key,
    createdAt: new Date().toISOString(),
  },
};
const response = () =>
  new Response(wav, { headers: { 'Content-Type': 'audio/wav', 'X-Audio-Key': key } });
const run = (o = occurrence, signal = new AbortController().signal) =>
  ensureSpeech(o, 'https://faminder.test/api', 'device-token', signal);
beforeEach(() => {
  // Match React Native: only AbortController supplies signals, with no static helpers.
  vi.stubGlobal('AbortSignal', class {});
  mock.files.clear();
  mock.move.mockReset().mockImplementation(async ({ from, to }: { from: string; to: string }) => {
    mock.files.set(to, mock.files.get(from)!);
    mock.files.delete(from);
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response()),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('tablet speech cache', () => {
  it('generates on first read, then reuses the local WAV offline even after a schedule edit', async () => {
    await run();
    expect(mock.files.has(audioPath(key))).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://faminder.test/api/reminders/routine-1/speech');
    expect(JSON.parse(options!.body as string)).toEqual({ revision: 'v1', audioKey: key });
    vi.mocked(fetch).mockRejectedValue(new Error('Offline'));
    await run({ ...occurrence, version: { ...occurrence.version, revision: 'v2' } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not play old cached speech for a changed text when offline', async () => {
    await run();
    vi.mocked(fetch).mockRejectedValue(new Error('Offline'));
    await expect(
      run({
        ...occurrence,
        version: { ...occurrence.version, text: 'Farklı metin', audioKey: 'b'.repeat(64) },
      }),
    ).rejects.toThrow('ilk okunması için internet');
    expect(mock.files.has(audioPath('b'.repeat(64)))).toBe(false);
  });
  it('shows provider errors and does not cache their response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: 'Gemini anahtarı eksik' }), { status: 503 }),
    );
    await expect(run()).rejects.toThrow('Gemini anahtarı eksik');
    expect(mock.files.size).toBe(0);
  });
  it('rejects a mismatched cache key or malformed WAV', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(wav, { headers: { 'X-Audio-Key': 'different' } }),
    );
    await expect(run()).rejects.toThrow('sürümü');
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('not-audio', { headers: { 'X-Audio-Key': key } }),
    );
    await expect(run()).rejects.toThrow('WAV');
    expect(mock.files.size).toBe(0);
  });
  it('does not write a response when playback is canceled during generation', async () => {
    const controller = new AbortController();
    vi.mocked(fetch).mockImplementation(async (_url, options) => {
      controller.abort();
      expect(options?.signal?.aborted).toBe(true);
      return response();
    });
    await expect(run(occurrence, controller.signal)).rejects.toThrow('iptal');
    expect(mock.files.size).toBe(0);
  });
  it('aborts a stalled request on React Native without static AbortSignal helpers', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        }),
    );
    const result = run().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(105000);
    expect(await result).toMatchObject({
      message: expect.stringContaining('ilk okunması için internet'),
    });
    expect(mock.files.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cleans incomplete files when committing the cache fails', async () => {
    mock.move.mockRejectedValueOnce(new Error('Disk error'));
    await expect(run()).rejects.toThrow('Disk error');
    expect(mock.files.size).toBe(0);
  });
});
