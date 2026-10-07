import { describe, it, expect } from 'vitest';
import {
  occurrencesBetween,
  isQuiet,
  nextOccurrence,
  reminderInputSchema,
  defaultSettings,
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
