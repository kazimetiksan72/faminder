import { DateTime } from 'luxon';
import { z } from 'zod';

export const voices = ['Kore', 'Aoede', 'Puck', 'Charon', 'Fenrir'] as const;
export const colors = ['sage', 'peach', 'lavender', 'sky', 'sun'] as const;
export const clockSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Geçerli bir saat seçin.');
export const timezoneSchema = z
  .string()
  .refine((v) => DateTime.now().setZone(v).isValid, 'Geçerli bir saat dilimi seçin.');
export const memberSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(colors).default('sage'),
});
export const scheduleSchema = z
  .object({
    kind: z.enum(['daily', 'weekly', 'once']),
    time: clockSchema,
    days: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    date: z.string().optional(),
    timezone: timezoneSchema.default('Europe/Istanbul'),
  })
  .superRefine((s, ctx) => {
    if (s.kind === 'weekly' && !s.days.length)
      ctx.addIssue({ code: 'custom', message: 'En az bir gün seçin.', path: ['days'] });
    if (
      s.kind === 'once' &&
      (!s.date || !/^\d{4}-\d{2}-\d{2}$/.test(s.date) || !DateTime.fromISO(s.date).isValid)
    )
      ctx.addIssue({ code: 'custom', message: 'Geçerli bir tarih seçin.', path: ['date'] });
  });
export const reminderInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(400),
  memberId: z.string().nullable().default(null),
  color: z.enum(colors).default('sage'),
  icon: z.enum(['sun', 'book', 'brush', 'moon', 'meal', 'heart']).default('sun'),
  voice: z.enum(voices).default('Kore'),
  style: z.enum(['warm', 'calm', 'cheerful']).default('warm'),
  schedule: scheduleSchema,
  enabled: z.boolean().default(true),
});
export const settingsSchema = z.object({
  timezone: timezoneSchema,
  quietStart: clockSchema,
  quietEnd: clockSchema,
  quietEnabled: z.boolean(),
  familyName: z.string().trim().min(1).max(60),
});
export type ReminderInput = z.infer<typeof reminderInputSchema>;
export type Schedule = z.infer<typeof scheduleSchema>;
export type Member = z.infer<typeof memberSchema> & { id: string };
export type Settings = z.infer<typeof settingsSchema>;
export type Version = ReminderInput & {
  revision: string;
  audioKey: string;
  createdAt: string;
};
export type Reminder = {
  id: string;
  familyId: string;
  content: Version;
  enabled: boolean;
  updatedAt: string;
};
export type Device = {
  id: string;
  name: string;
  lastSeenAt: string | null;
  lastSyncAt: string | null;
  installed: Record<string, string>;
  revoked: boolean;
};
export type EventKind =
  | 'played'
  | 'completed'
  | 'snoozed'
  | 'missed'
  | 'failed'
  | 'quiet'
  | 'interrupted';
export type Execution = {
  id: string;
  reminderId: string;
  occurrenceId: string;
  kind: EventKind;
  at: string;
  title: string;
  deviceId?: string;
};
export type Snapshot = {
  family: Settings & { id: string };
  members: Member[];
  reminders: Reminder[];
  devices: Device[];
  events: Execution[];
  serverTime: string;
  capabilities: { speechConfigured: boolean; model: string };
};
export type Occurrence = { id: string; reminderId: string; scheduledAt: string; version: Version };
export const defaultSettings: Settings = {
  familyName: 'Ailem',
  timezone: 'Europe/Istanbul',
  quietStart: '22:00',
  quietEnd: '07:00',
  quietEnabled: true,
};
export const dayLabels = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

// Repeated wall-clock times in DST overlap run once (the earliest instant).
// Nonexistent wall-clock times in a DST gap are skipped rather than shifted.
function onDay(schedule: Schedule, day: DateTime): DateTime | null {
  if (schedule.kind === 'weekly' && !schedule.days.includes(day.weekday)) return null;
  if (schedule.kind === 'once' && schedule.date !== day.toISODate()) return null;
  const [hour, minute] = schedule.time.split(':').map(Number);
  const local = day.set({ hour, minute, second: 0, millisecond: 0 });
  if (local.hour !== hour || local.minute !== minute) return null;
  return local.getPossibleOffsets().sort((a, b) => a.toMillis() - b.toMillis())[0] ?? local;
}
export function occurrencesBetween(
  reminder: Pick<Reminder, 'id' | 'enabled' | 'content'>,
  from: number,
  to: number,
): Occurrence[] {
  const v = reminder.content;
  if (!reminder.enabled || !v || to < from) return [];
  const result: Occurrence[] = [];
  let day = DateTime.fromMillis(from, { zone: v.schedule.timezone }).startOf('day');
  const end = DateTime.fromMillis(to, { zone: v.schedule.timezone }).endOf('day');
  for (let count = 0; day <= end && count < 32; count++, day = day.plus({ days: 1 })) {
    const at = onDay(v.schedule, day);
    if (at && at.toMillis() >= from && at.toMillis() <= to) {
      const scheduledAt = at.toUTC().toISO()!;
      result.push({
        id: `${reminder.id}:${scheduledAt}`,
        reminderId: reminder.id,
        scheduledAt,
        version: v,
      });
    }
  }
  return result;
}
export function nextOccurrence(
  reminder: Pick<Reminder, 'id' | 'enabled' | 'content'>,
  now = Date.now(),
): Occurrence | null {
  if (reminder.content?.schedule.kind === 'once') {
    const at = DateTime.fromISO(reminder.content.schedule.date!, {
      zone: reminder.content.schedule.timezone,
    });
    return (
      occurrencesBetween(
        reminder,
        Math.max(now, at.startOf('day').toMillis()),
        at.endOf('day').toMillis(),
      )[0] ?? null
    );
  }
  return occurrencesBetween(reminder, now, now + 8 * 86400000)[0] ?? null;
}
export function isQuiet(now: number, settings: Settings): boolean {
  if (!settings.quietEnabled || settings.quietStart === settings.quietEnd) return false;
  const time = DateTime.fromMillis(now, { zone: settings.timezone }).toFormat('HH:mm');
  return settings.quietStart < settings.quietEnd
    ? time >= settings.quietStart && time < settings.quietEnd
    : time >= settings.quietStart || time < settings.quietEnd;
}
export function scheduleLabel(s: Schedule): string {
  if (s.kind === 'daily') return 'Her gün';
  if (s.kind === 'once') return DateTime.fromISO(s.date!).setLocale('tr').toFormat('d MMMM yyyy');
  if ([1, 2, 3, 4, 5].every((d) => s.days.includes(d)) && s.days.length === 5) return 'Hafta içi';
  return [...s.days]
    .sort()
    .map((d) => dayLabels[d - 1])
    .join(', ');
}
