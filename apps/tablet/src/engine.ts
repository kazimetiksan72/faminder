import { AppState } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { occurrencesBetween, isQuiet, type Snapshot, type Occurrence } from '@faminder/shared';
import * as store from './storage';
import { withRequestSignal } from './request';

export const apiBase = () => process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? '';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, token?: string, body?: unknown): Promise<T> {
  if (!apiBase()) throw new Error('Tablet için EXPO_PUBLIC_API_URL ayarlanmalı.');
  return withRequestSignal(15000, undefined, async (signal) => {
    const response = await fetch(`${apiBase()}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Faminder-Client': '1',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const value = await response.json();
    if (!response.ok) throw new ApiError(value.error ?? 'Bağlantı kurulamadı.', response.status);
    return value;
  });
}
type SyncResult = { snapshot: Snapshot; clockSkewMs: number };
let inFlight: Promise<SyncResult> | null = null;
let sessionGeneration = 0;
let disconnecting = false;
export function synchronize(token: string): Promise<SyncResult> {
  if (disconnecting) return Promise.reject(new Error('Tablet bağlantısı kaldırılıyor.'));
  if (inFlight) return inFlight;
  const generation = sessionGeneration;
  const check = () => {
    if (generation !== sessionGeneration) throw new Error('Tablet oturumu değişti.');
  };
  const work = synchronizeSession(token, check);
  inFlight = work;
  return work.finally(() => {
    if (inFlight === work) inFlight = null;
  });
}
export async function disconnectDevice() {
  disconnecting = true;
  sessionGeneration++;
  stopAudio();
  try {
    // Drain any download before wiping, so an old session cannot restore family data.
    await inFlight?.catch(() => {});
    await playbackQueue;
    await store.wipe();
  } finally {
    disconnecting = false;
  }
}
async function synchronizeSession(token: string, check: () => void): Promise<SyncResult> {
  const incoming = await api<Snapshot>('/snapshot', token);
  const clockSkewMs = Date.parse(incoming.serverTime) - Date.now();
  check();
  // Text and schedules become available immediately; speech is generated at playback.
  const installed = incoming;
  await store.put('snapshot', installed);
  const events = await store.pendingEvents();
  if (events.length) {
    const answer = await api<{ accepted: string[] }>('/device/events', token, events);
    check();
    await store.acknowledge(answer.accepted);
  }
  check();
  await api('/device/heartbeat', token, {
    installed: Object.fromEntries(installed.reminders.map((r) => [r.id, r.content.revision])),
  });
  check();
  await store.put('lastSync', new Date().toISOString());
  if (Date.now() - ((await store.get<number>('lastCleanup')) ?? 0) > 86400000) {
    await store.cleanup(installed);
    await store.put('lastCleanup', Date.now());
  }
  return { snapshot: installed, clockSkewMs };
}
let stopCurrent: (() => void) | null = null;
let playbackQueue: Promise<void> = Promise.resolve();
let playbackGeneration = 0;
let speechController = new AbortController();
export function stopAudio() {
  playbackGeneration++;
  speechController.abort();
  speechController = new AbortController();
  stopCurrent?.();
}
export function readReminder(o: Occurrence, token: string, verify?: () => Promise<void>) {
  return playFile(o.version.audioKey, async (signal) => {
    await store.ensureSpeech(o, apiBase(), token, signal);
    await verify?.();
  });
}
class SkippedSpeech extends Error {
  constructor(public kind: 'quiet' | 'missed' | 'interrupted') {
    super(kind);
  }
}
export function playFile(
  audioKey: string,
  prepare?: (signal: AbortSignal) => Promise<void>,
): Promise<void> {
  const generation = playbackGeneration;
  const signal = speechController.signal;
  const check = () => {
    if (generation !== playbackGeneration || AppState.currentState !== 'active')
      throw new Error('Ses yarıda kesildi.');
  };
  const work = playbackQueue.then(async () => {
    check();
    await prepare?.(signal);
    check();
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
    });
    check();
    const player = createAudioPlayer(store.audioPath(audioKey), { updateInterval: 250 });
    player.volume = 1;
    await new Promise<void>((resolve, reject) => {
      let finished = false,
        loaded = false;
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        subscription.remove();
        player.remove();
        stopCurrent = null;
        error ? reject(error) : resolve();
      };
      const timeout = setTimeout(
        () => finish(new Error(loaded ? 'Ses oynatma süresi aşıldı.' : 'Ses dosyası açılamadı.')),
        90000,
      );
      const subscription = player.addListener('playbackStatusUpdate', (status) => {
        if (status.isLoaded) loaded = true;
        if (status.didJustFinish) finish();
      });
      stopCurrent = () => finish(new Error('Ses yarıda kesildi.'));
      try {
        player.play();
      } catch (e) {
        finish(e as Error);
      }
    });
  });
  playbackQueue = work.catch(() => {});
  return work;
}
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;
  private startup: Promise<void> | null = null;
  private tickWork: Promise<void> | null = null;
  private running = false;
  private last = Date.now();
  constructor(
    private changed: (o: Occurrence | null) => void,
    private updated: () => void,
    private error: (message: string) => void,
    private token: string,
  ) {}
  start() {
    this.running = true;
    this.startup = this.initialize();
    return this.startup;
  }
  private async initialize() {
    try {
      await store.recoverInterrupted();
      this.last = (await store.get<number>('lastTick')) ?? Date.now() - 120000;
      if (!this.running) return;
      this.timer = setInterval(() => void this.tick(), 1000);
      void this.tick();
    } catch (e) {
      this.error((e as Error).message);
    }
  }
  async stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    stopAudio();
    await Promise.all([this.startup, this.tickWork]);
  }
  tick(): Promise<void> {
    if (this.busy || !this.running || AppState.currentState !== 'active') return Promise.resolve();
    this.busy = true;
    this.tickWork = this.runTick();
    return this.tickWork;
  }
  private async runTick() {
    try {
      const snapshot = await store.get<Snapshot>('snapshot');
      if (!snapshot) return;
      const now = Date.now();
      const from = this.last > now ? now - 120000 : Math.max(this.last + 1, now - 86400000);
      const due = [
        ...snapshot.reminders.flatMap((r) => occurrencesBetween(r, from, now)),
        ...(await store.dueSnoozes(now)),
      ].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
      for (const o of due) {
        if (!this.running || AppState.currentState !== 'active') break;
        // Re-read the persisted version between queued announcements.
        const latest = await store.get<Snapshot>('snapshot');
        const current = latest?.reminders.find((r) => r.id === o.reminderId);
        if (!current?.enabled || current.content?.revision !== o.version.revision) {
          await store.removeSnooze(o.id);
          continue;
        }
        if (!(await store.claim(o))) {
          await store.removeSnooze(o.id);
          continue;
        }
        await store.removeSnooze(o.id);
        if (Date.now() - Date.parse(o.scheduledAt) > 120000) {
          await store.record(o, 'missed');
          continue;
        }
        this.changed(o);
        if (isQuiet(Date.now(), latest!.family)) {
          await store.record(o, 'quiet');
          this.updated();
          continue;
        }
        try {
          await readReminder(o, this.token, async () => {
            const refreshed = await store.get<Snapshot>('snapshot');
            const r = refreshed?.reminders.find((r) => r.id === o.reminderId);
            if (
              !this.running ||
              !r?.enabled ||
              r.content.revision !== o.version.revision ||
              r.content.audioKey !== o.version.audioKey
            )
              throw new SkippedSpeech('interrupted');
            if (Date.now() - Date.parse(o.scheduledAt) > 120000) throw new SkippedSpeech('missed');
            if (isQuiet(Date.now(), refreshed!.family)) throw new SkippedSpeech('quiet');
          });
          await store.record(o, 'played');
        } catch (e) {
          await store.record(
            o,
            e instanceof SkippedSpeech
              ? e.kind
              : this.running && AppState.currentState === 'active'
                ? 'failed'
                : 'interrupted',
          );
          if (!(e instanceof SkippedSpeech)) this.error((e as Error).message);
        }
        this.updated();
      }
      this.last = now;
      await store.put('lastTick', now);
      this.updated();
    } catch (e) {
      this.error((e as Error).message);
    } finally {
      this.busy = false;
    }
  }
}
