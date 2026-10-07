import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import type { Execution, Occurrence, Snapshot, EventKind } from '@faminder/shared';
import { withRequestSignal } from './request';
let database: Promise<SQLite.SQLiteDatabase> | undefined;
export function db() {
  if (!database)
    database = (async () => {
      const d = await SQLite.openDatabaseAsync('faminder.db');
      await d.execAsync(`PRAGMA journal_mode = WAL;
 CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS occurrences (id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY,payload TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS snoozes (id TEXT PRIMARY KEY,payload TEXT NOT NULL,due INTEGER NOT NULL);`);
      return d;
    })();
  return database;
}
export async function get<T>(key: string): Promise<T | null> {
  const row = await (
    await db()
  ).getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key=?', key);
  const value = row ? JSON.parse(row.value) : null;
  // A pre-generated-audio snapshot needs one online sync after upgrading.
  if (key === 'snapshot' && value?.reminders?.some((r: { content?: unknown }) => !r.content))
    return null;
  return value;
}
export async function put(key: string, value: unknown) {
  await (
    await db()
  ).runAsync('INSERT OR REPLACE INTO meta(key,value) VALUES (?,?)', key, JSON.stringify(value));
}
export const credentials = {
  get: () => SecureStore.getItemAsync('faminder.device'),
  set: (token: string) => SecureStore.setItemAsync('faminder.device', token),
  clear: () => SecureStore.deleteItemAsync('faminder.device'),
};
export async function claim(occurrence: Occurrence): Promise<boolean> {
  const result = await (
    await db()
  ).runAsync(
    'INSERT OR IGNORE INTO occurrences(id,payload,status,at) VALUES (?,?,?,?)',
    occurrence.id,
    JSON.stringify(occurrence),
    'claimed',
    Date.now(),
  );
  return result.changes === 1;
}
export async function record(occurrence: Occurrence, kind: EventKind) {
  const event: Execution = {
    id: randomUUID(),
    reminderId: occurrence.reminderId,
    occurrenceId: occurrence.id,
    kind,
    at: new Date().toISOString(),
    title: occurrence.version.title,
  };
  await (
    await db()
  ).withExclusiveTransactionAsync(async (d) => {
    await d.runAsync('UPDATE occurrences SET status=? WHERE id=?', kind, occurrence.id);
    await d.runAsync(
      'INSERT INTO outbox(id,payload) VALUES (?,?)',
      event.id,
      JSON.stringify(event),
    );
  });
}
export async function recoverInterrupted() {
  const rows = await (
    await db()
  ).getAllAsync<{ payload: string }>("SELECT payload FROM occurrences WHERE status='claimed'");
  for (const row of rows) await record(JSON.parse(row.payload), 'interrupted');
}
export async function pendingEvents(): Promise<Execution[]> {
  return (
    await (
      await db()
    ).getAllAsync<{ payload: string }>('SELECT payload FROM outbox ORDER BY rowid LIMIT 100')
  ).map((r) => JSON.parse(r.payload));
}
export async function acknowledge(ids: string[]) {
  const d = await db();
  for (const id of ids) await d.runAsync('DELETE FROM outbox WHERE id=?', id);
}
export async function snooze(o: Occurrence) {
  const due = Date.now() + 5 * 60000;
  const next = {
    ...o,
    id: `${o.reminderId}:snooze:${randomUUID()}`,
    scheduledAt: new Date(due).toISOString(),
  };
  const d = await db();
  await d.runAsync(
    'INSERT INTO snoozes(id,payload,due) VALUES (?,?,?)',
    next.id,
    JSON.stringify(next),
    due,
  );
  await record(o, 'snoozed');
}
export async function dueSnoozes(now: number): Promise<Occurrence[]> {
  return (
    await (
      await db()
    ).getAllAsync<{ payload: string }>('SELECT payload FROM snoozes WHERE due<=? ORDER BY due', now)
  ).map((r) => JSON.parse(r.payload));
}
export async function removeSnooze(id: string) {
  await (await db()).runAsync('DELETE FROM snoozes WHERE id=?', id);
}
export async function recent(): Promise<{ occurrence: Occurrence; status: EventKind }[]> {
  const rows = await (
    await db()
  ).getAllAsync<{ payload: string; status: EventKind }>(
    "SELECT payload,status FROM occurrences WHERE status<>'claimed' ORDER BY at DESC LIMIT 8",
  );
  return rows.map((r) => ({ occurrence: JSON.parse(r.payload), status: r.status }));
}
export const audioDirectory = () => `${FileSystem.documentDirectory}audio/`;
export const audioPath = (id: string) => `${audioDirectory()}${id}.wav`;
export async function ensureSpeech(
  o: Occurrence,
  base: string,
  token: string,
  signal: AbortSignal,
) {
  const key = o.version.audioKey;
  if (!/^[a-f0-9]{64}$/.test(key))
    throw new Error('Ses önbelleği anahtarı geçersiz. Programı eşitleyin.');
  if (signal.aborted) throw new Error('Ses hazırlama iptal edildi.');
  const path = audioPath(key);
  const cached = await FileSystem.getInfoAsync(path);
  if (cached.exists && cached.size >= 44) return;
  const bytes = await withRequestSignal(105000, signal, async (requestSignal) => {
    let response: Response;
    try {
      response = await fetch(`${base}/reminders/${encodeURIComponent(o.reminderId)}/speech`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Faminder-Client': '1',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ revision: o.version.revision, audioKey: key }),
        signal: requestSignal,
      });
    } catch {
      throw new Error(
        signal.aborted
          ? 'Ses hazırlama iptal edildi.'
          : 'Ses alınamadı. Bu metnin ilk okunması için internet ve Gemini bağlantısı gerekir.',
      );
    }
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      throw new Error(detail.error ?? 'Gemini sesi oluşturulamadı.');
    }
    if (response.headers.get('X-Audio-Key') !== key) throw new Error('Ses sürümü uyuşmuyor.');
    return new Uint8Array(await response.arrayBuffer());
  });
  const signature = (from: number, to: number) => String.fromCharCode(...bytes.slice(from, to));
  if (
    bytes.length < 44 ||
    bytes.length > 3 * 1024 * 1024 ||
    signature(0, 4) !== 'RIFF' ||
    signature(8, 12) !== 'WAVE'
  )
    throw new Error('Geçerli bir WAV ses dosyası alınamadı.');
  if (signal.aborted) throw new Error('Ses hazırlama iptal edildi.');
  await FileSystem.makeDirectoryAsync(audioDirectory(), { intermediates: true });
  const temporary = `${path}.part`;
  try {
    new File(temporary).write(bytes);
    if (signal.aborted) throw new Error('Ses hazırlama iptal edildi.');
    await FileSystem.moveAsync({ from: temporary, to: path });
  } finally {
    await FileSystem.deleteAsync(temporary, { idempotent: true });
  }
}
export async function cleanup(snapshot: Snapshot) {
  const d = await db();
  await d.runAsync('DELETE FROM occurrences WHERE at<?', Date.now() - 30 * 86400000);
  const keep = new Set(snapshot.reminders.map((r) => r.content.audioKey).filter(Boolean));
  const snoozes = await d.getAllAsync<{ payload: string }>('SELECT payload FROM snoozes');
  for (const s of snoozes) keep.add((JSON.parse(s.payload) as Occurrence).version.audioKey);
  const recent = await d.getAllAsync<{ payload: string }>('SELECT payload FROM occurrences');
  for (const row of recent) keep.add((JSON.parse(row.payload) as Occurrence).version.audioKey);
  const files = await FileSystem.readDirectoryAsync(audioDirectory()).catch(() => []);
  for (const file of files) {
    if (file.endsWith('.wav') && !keep.has(file.slice(0, -4)))
      await FileSystem.deleteAsync(`${audioDirectory()}${file}`, { idempotent: true });
  }
}
export async function wipe() {
  await credentials.clear();
  const d = await db();
  await d.execAsync(
    'DELETE FROM meta; DELETE FROM occurrences; DELETE FROM outbox; DELETE FROM snoozes;',
  );
  await FileSystem.deleteAsync(audioDirectory(), { idempotent: true });
}
