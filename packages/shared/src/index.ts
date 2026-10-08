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
export const reminderInputSchema = z
  .object({
    title: z.string().trim().min(1).max(80),
    text: z.string().trim().min(1).max(400),
    memberId: z.string().nullable().default(null),
    memberIds: z
      .array(z.string().min(1))
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length, 'Aynı kişi birden fazla seçilemez.')
      .optional(),
    color: z.enum(colors).default('sage'),
    icon: z.enum(['sun', 'book', 'brush', 'moon', 'meal', 'heart']).default('sun'),
    voice: z.enum(voices).default('Kore'),
    style: z.enum(['warm', 'calm', 'cheerful']).default('warm'),
    schedule: scheduleSchema,
    advanceReminders: z
      .array(z.number().int().min(1).max(1440))
      .max(2, 'En fazla iki ön hatırlatma ekleyebilirsiniz.')
      .refine(
        (values) => new Set(values).size === values.length,
        'Ön hatırlatma süreleri farklı olmalı.',
      )
      .default([]),
    enabled: z.boolean().default(true),
  })
  .transform((input) => {
    const memberIds = reminderMemberIds(input);
    return { ...input, memberIds, memberId: memberIds.length === 1 ? memberIds[0] : null };
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
  advanceSpeech?: AdvanceSpeech[];
  spokenText?: string;
};
export type SpeechDay = 'today' | 'tomorrow' | 'dayAfterTomorrow';
export type AdvanceSpeech = {
  minutesBefore: number;
  day: SpeechDay;
  text: string;
  audioKey: string;
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
  minutesBefore?: number;
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
export type Occurrence = {
  id: string;
  reminderId: string;
  scheduledAt: string;
  version: Version;
  minutesBefore?: number;
  eventAt?: string;
  speechDay?: SpeechDay;
};
export const defaultSettings: Settings = {
  familyName: 'Ailem',
  timezone: 'Europe/Istanbul',
  quietStart: '22:00',
  quietEnd: '07:00',
  quietEnabled: true,
};
export const dayLabels = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

// An explicit empty list means the whole family, including for legacy clients.
export function reminderMemberIds(input: {
  memberIds?: string[];
  memberId?: string | null;
}): string[] {
  return input.memberIds ?? (input.memberId ? [input.memberId] : []);
}
export function selectedMembers(
  input: { memberIds?: string[]; memberId?: string | null },
  members: Member[],
): Member[] {
  return reminderMemberIds(input).flatMap((id) => {
    const member = members.find((m) => m.id === id);
    return member ? [member] : [];
  });
}
type Recipients = string | string[];
const namesList = (names?: Recipients): string[] =>
  (typeof names === 'string' ? [names] : (names ?? [])).map((name) => name.trim()).filter(Boolean);
export function recipientLabel(names?: Recipients): string {
  const list = namesList(names);
  return list.length < 2 ? (list[0] ?? '') : `${list.slice(0, -1).join(', ')} ve ${list.at(-1)}`;
}
export function reminderBody(text: string, names?: Recipients): string {
  const body = text.trim();
  // Older reminders often already start with the selected person's name.
  const prefixes = [recipientLabel(names), ...namesList(names)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  for (const prefix of prefixes) {
    if (!body.toLocaleLowerCase('tr-TR').startsWith(prefix.toLocaleLowerCase('tr-TR'))) continue;
    const rest = body.slice(prefix.length);
    if (/^\s*[,!:]/.test(rest)) {
      const stripped = rest.replace(/^\s*[,!:]\s*/, '');
      if (stripped) return stripped;
    }
  }
  return body;
}
export function addressedText(text: string, names?: Recipients): string {
  const who = recipientLabel(names);
  const body = reminderBody(text, names);
  return who && body ? `${who}, ${body}` : body;
}

export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours} saat` : '', rest ? `${rest} dakika` : ''].filter(Boolean).join(' ');
}
export function advanceText(
  title: string,
  minutes: number,
  name?: Recipients,
  day: SpeechDay = 'today',
) {
  const activity = title.trim().replace(/[.!?]+$/, '');
  const names = namesList(name);
  const who = names.length ? `${recipientLabel(names)}, ` : '';
  const when = day === 'today' ? 'bugün' : day === 'tomorrow' ? 'yarın' : 'öbür gün';
  const lesson = names.length > 0 && / dersi$/i.test(activity);
  const subject = lesson
    ? activity.replace(/dersi$/i, names.length > 1 ? 'dersiniz' : 'dersin')
    : activity;
  if (minutes >= 60)
    return `${who}${when} ${subject} var. ${lesson ? 'Derse' : 'Başlamasına'} ${durationLabel(minutes)} kaldı.`;
  return lesson
    ? `${who}${activity.replace(/dersi$/i, names.length > 1 ? 'dersinize' : 'dersine')} ${durationLabel(minutes)} kaldı.`
    : `${who}${activity} için ${durationLabel(minutes)} kaldı.`;
}
export function suggestedReminderText(title: string, name?: Recipients): string {
  const activity = title.trim().replace(/[.!?]+$/, '');
  const names = namesList(name);
  const who = names.length ? `${recipientLabel(names)}, ` : '';
  if (/ dersi$/i.test(activity))
    return `${who}${names.length ? activity.replace(/dersi$/i, names.length > 1 ? 'dersiniz' : 'dersin') : activity} başladı. İyi dersler.`;
  return `${who}${activity.replace(/ zamanı$/i, '')} zamanı.`;
}
export function advanceTexts(
  input: Pick<ReminderInput, 'title' | 'advanceReminders'>,
  name?: Recipients,
) {
  return (input.advanceReminders ?? []).flatMap((minutesBefore) =>
    (['today', 'tomorrow', 'dayAfterTomorrow'] as const).map((day) => ({
      minutesBefore,
      day,
      text: advanceText(input.title, minutesBefore, name, day),
    })),
  );
}
export function announcementVersion(
  v: Version,
  minutesBefore = 0,
  day: SpeechDay = 'today',
): Version | null {
  if (!minutesBefore) return v.spokenText ? { ...v, text: v.spokenText } : v;
  if (!v.advanceReminders?.includes(minutesBefore)) return null;
  const speech = v.advanceSpeech?.find((s) => s.minutesBefore === minutesBefore && s.day === day);
  return speech ? { ...v, text: speech.text, audioKey: speech.audioKey } : null;
}

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
  const offsets = [0, ...(v.advanceReminders ?? [])];
  // A notification can fall on the day before its event, including weekly/one-off events.
  const end = DateTime.fromMillis(to + Math.max(...offsets) * 60000, {
    zone: v.schedule.timezone,
  }).endOf('day');
  for (let count = 0; day <= end && count < 32; count++, day = day.plus({ days: 1 })) {
    const at = onDay(v.schedule, day);
    if (!at) continue;
    for (const minutesBefore of offsets) {
      const due = at.minus({ minutes: minutesBefore });
      if (due.toMillis() < from || due.toMillis() > to) continue;
      const eventAt = at.toUTC().toISO()!;
      const scheduledAt = due.toUTC().toISO()!;
      const speechDay = due.hasSame(at, 'day')
        ? 'today'
        : due.plus({ days: 1 }).hasSame(at, 'day')
          ? 'tomorrow'
          : 'dayAfterTomorrow';
      const version = announcementVersion(v, minutesBefore, speechDay);
      if (!version) continue;
      result.push({
        id: `${reminder.id}:${eventAt}${minutesBefore ? `:before:${minutesBefore}` : ''}`,
        reminderId: reminder.id,
        scheduledAt,
        version,
        ...(minutesBefore ? { minutesBefore, eventAt, speechDay } : {}),
      });
    }
  }
  return result.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
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
        Math.max(now, at.startOf('day').toMillis() - 86400000),
        at.endOf('day').toMillis(),
      )[0] ?? null
    );
  }
  return occurrencesBetween(reminder, now, now + 8 * 86400000)[0] ?? null;
}
export function reminderPreview(input: ReminderInput, name?: Recipients): Occurrence[] {
  if (!scheduleSchema.safeParse(input.schedule).success) return [];
  input = {
    ...input,
    advanceReminders: [...new Set(input.advanceReminders)].filter(
      (v) => Number.isInteger(v) && v >= 1 && v <= 1440,
    ),
  };
  const version: Version = {
    ...input,
    revision: 'preview',
    audioKey: 'preview',
    createdAt: '',
    spokenText: addressedText(input.text, name),
    advanceSpeech: advanceTexts(input, name).map((s) => ({ ...s, audioKey: 'preview' })),
  };
  const reminder = { id: 'preview', enabled: true, content: version };
  const now =
    input.schedule.kind === 'once'
      ? DateTime.fromISO(input.schedule.date!, { zone: input.schedule.timezone })
          .startOf('day')
          .toMillis()
      : Date.now();
  const main = nextOccurrence({ ...reminder, content: { ...version, advanceReminders: [] } }, now);
  if (!main) return [];
  const eventTime = Date.parse(main.scheduledAt);
  return occurrencesBetween(reminder, eventTime - 1440 * 60000, eventTime).filter(
    (o) => (o.eventAt ?? o.scheduledAt) === main.scheduledAt,
  );
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
