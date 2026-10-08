import { describe, it, expect } from 'vitest';
import {
  occurrencesBetween,
  isQuiet,
  nextOccurrence,
  reminderInputSchema,
  defaultSettings,
  advanceTexts,
  suggestedReminderText,
  reminderPreview,
  type Reminder,
  type Schedule,
} from './index.js';
function reminder(schedule: Partial<Schedule> = {}): Reminder {
  const content = {
    ...reminderInputSchema.parse({
      title: 'Diş zamanı',
      text: 'Dişlerini fırçala',
      schedule: { kind: 'daily', time: '20:30', ...schedule },
    }),
    revision: 'v1',
    audioKey: 'a'.repeat(64),
    createdAt: '2026-10-07T00:00:00Z',
  };
  return {
    id: 'r1',
    familyId: 'f1',
    content,
    enabled: true,
    updatedAt: content.createdAt,
  };
}
describe('wall clock scheduler', () => {
  it('uses household timezone and deterministic occurrence IDs', () => {
    const r = reminder();
    const start = Date.parse('2026-10-07T17:29:00Z');
    expect(occurrencesBetween(r, start, start + 120000).map((o) => o.scheduledAt)).toEqual([
      '2026-10-07T17:30:00.000Z',
    ]);
    const before = occurrencesBetween(r, start, start + 120000)[0].id;
    r.content.revision = 'v2';
    expect(occurrencesBetween(r, start, start + 120000)[0].id).toBe(before);
  });
  it('does not schedule disabled reminders and immediately schedules text', () => {
    const r = reminder();
    r.enabled = false;
    expect(nextOccurrence(r)).toBeNull();
    r.enabled = true;
    expect(nextOccurrence(r, Date.parse('2026-10-07T17:29:00Z'))).not.toBeNull();
  });
  it('respects weekdays and one-off dates', () => {
    const start = Date.parse('2026-10-10T00:00:00Z');
    expect(
      occurrencesBetween(
        reminder({ kind: 'weekly', days: [1, 2, 3, 4, 5] }),
        start,
        start + 86400000,
      ),
    ).toHaveLength(0);
    expect(nextOccurrence(reminder({ kind: 'once', date: '2026-12-31' }), start)?.scheduledAt).toBe(
      '2026-12-31T17:30:00.000Z',
    );
  });
  it('handles cross-midnight windows', () => {
    expect(
      occurrencesBetween(
        reminder({ time: '00:00' }),
        Date.parse('2026-10-07T20:59:00Z'),
        Date.parse('2026-10-07T21:01:00Z'),
      ),
    ).toHaveLength(1);
  });
  it('skips nonexistent DST times and runs once on overlap', () => {
    const r = reminder({ time: '02:30', timezone: 'Europe/Berlin' });
    expect(
      occurrencesBetween(r, Date.parse('2026-03-29T00:00Z'), Date.parse('2026-03-29T23:00Z')),
    ).toHaveLength(0);
    expect(
      occurrencesBetween(r, Date.parse('2026-10-25T00:00Z'), Date.parse('2026-10-25T23:00Z')),
    ).toHaveLength(1);
  });
  it('honors quiet hours wrapping midnight and exclusive end', () => {
    expect(isQuiet(Date.parse('2026-10-07T23:00Z'), defaultSettings)).toBe(true);
    expect(isQuiet(Date.parse('2026-10-08T04:00Z'), defaultSettings)).toBe(false);
    expect(isQuiet(Date.now(), { ...defaultSettings, quietEnabled: false })).toBe(false);
  });
  it('validates schedules', () => {
    expect(() => reminder({ kind: 'weekly', days: [] })).toThrow();
    expect(() => reminder({ time: '25:30' })).toThrow();
    expect(() => reminder({ timezone: 'invalid' })).toThrow();
  });
});

function withAdvance(schedule: Partial<Schedule> = {}, offsets = [60, 30]) {
  const r = reminder({ time: '19:00', ...schedule });
  r.content.title = 'satranç dersi';
  r.content.text = suggestedReminderText(r.content.title, 'Ateş');
  r.content.advanceReminders = offsets;
  r.content.advanceSpeech = advanceTexts(r.content, 'Ateş').map((s, i) => ({
    ...s,
    audioKey: String(i).repeat(64),
  }));
  return r;
}
describe('advance announcements', () => {
  it('runs 18:00, 18:30 and 19:00 with separate stable identities and appropriate text', () => {
    const r = withAdvance();
    const occurrences = occurrencesBetween(
      r,
      Date.parse('2026-10-08T14:59Z'),
      Date.parse('2026-10-08T16:01Z'),
    );
    expect(occurrences.map((o) => o.scheduledAt)).toEqual([
      '2026-10-08T15:00:00.000Z',
      '2026-10-08T15:30:00.000Z',
      '2026-10-08T16:00:00.000Z',
    ]);
    expect(occurrences.map((o) => o.version.text)).toEqual([
      'Ateş, bugün satranç dersin var. Derse 1 saat kaldı.',
      'Ateş, satranç dersine 30 dakika kaldı.',
      'Ateş, satranç dersin başladı. İyi dersler.',
    ]);
    expect(new Set(occurrences.map((o) => o.id)).size).toBe(3);
    expect(new Set(occurrences.map((o) => o.version.audioKey)).size).toBe(3);
    r.content.revision = 'edited';
    expect(
      occurrencesBetween(r, Date.parse('2026-10-08T14:59Z'), Date.parse('2026-10-08T16:01Z')).map(
        (o) => o.id,
      ),
    ).toEqual(occurrences.map((o) => o.id));
    expect(occurrences[2].id).toBe('r1:2026-10-08T16:00:00.000Z');
  });
  it('allows no more than two distinct positive whole-minute offsets, up to 24 hours', () => {
    const v = withAdvance().content;
    for (const values of [[60, 30, 15], [30, 30], [0], [-1], [1.5], [1441]])
      expect(reminderInputSchema.safeParse({ ...v, advanceReminders: values }).success).toBe(false);
    expect(
      reminderInputSchema.parse({ ...v, advanceReminders: undefined }).advanceReminders,
    ).toEqual([]);
  });
  it.each(['once', 'weekly'] as const)(
    'finds previous-day advance reminders for %s events',
    (kind) => {
      const r = withAdvance({ kind, date: '2026-10-09', days: [5], time: '00:30' });
      const now = Date.parse('2026-10-08T20:29Z');
      const o = nextOccurrence(r, now)!;
      expect(o.scheduledAt).toBe('2026-10-08T20:30:00.000Z');
      expect(o.eventAt).toBe('2026-10-08T21:30:00.000Z');
      expect(o.version.text).toContain('yarın');
      expect(o.speechDay).toBe('tomorrow');
      expect(nextOccurrence(r, Date.parse(o.scheduledAt) + 1)?.minutesBefore).toBe(30);
    },
  );
  it('measures actual elapsed minutes across daylight saving changes', () => {
    const r = withAdvance({
      kind: 'once',
      date: '2026-03-29',
      timezone: 'Europe/Berlin',
      time: '03:30',
    });
    const o = nextOccurrence(r, Date.parse('2026-03-29T00:00Z'))!;
    expect(o.scheduledAt).toBe('2026-03-29T00:30:00.000Z');
    expect(Date.parse(o.eventAt!) - Date.parse(o.scheduledAt)).toBe(60 * 60000);
    expect(o.version.text).toContain('bugün');
  });
  it('does not say tomorrow when a 24-hour lead spans two calendar dates in a DST gap', () => {
    const r = withAdvance(
      { kind: 'once', date: '2026-03-30', timezone: 'Europe/Berlin', time: '00:00' },
      [1440],
    );
    const o = nextOccurrence(r, Date.parse('2026-03-28T21:00Z'))!;
    expect(o.scheduledAt).toBe('2026-03-28T22:00:00.000Z');
    expect(o.version.text).toContain('öbür gün');
  });
  it('keeps legacy reminders main-only and removes disabled or deleted lead times', () => {
    const r = withAdvance();
    r.content.advanceReminders = [];
    const window = [Date.parse('2026-10-08T14:59Z'), Date.parse('2026-10-08T16:01Z')] as const;
    expect(occurrencesBetween(r, ...window)).toHaveLength(1);
    r.enabled = false;
    expect(occurrencesBetween(r, ...window)).toHaveLength(0);
  });
  it('previews one event and keeps the manually authored main text', () => {
    const r = withAdvance({ kind: 'once', date: '2026-12-31' }, [30, 60]);
    r.content.text = 'Ateş, iyi dersler!';
    const preview = reminderPreview(r.content, 'Ateş');
    expect(preview.map((o) => o.minutesBefore ?? 0)).toEqual([60, 30, 0]);
    expect(preview.at(-1)?.version.text).toBe('Ateş, iyi dersler!');
  });
});
