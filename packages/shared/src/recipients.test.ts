import { describe, expect, it } from 'vitest';
import {
  addressedText,
  advanceTexts,
  announcementVersion,
  recipientLabel,
  reminderBody,
  reminderInputSchema,
  reminderPreview,
  selectedMembers,
} from './index.js';

const input = {
  title: 'satranç dersi',
  text: 'satranç dersin başlıyor',
  schedule: { kind: 'once', time: '19:00', date: '2026-12-31' },
};
describe('selected family members and spoken names', () => {
  it('normalizes legacy selections and respects an explicit whole-family selection', () => {
    expect(reminderInputSchema.parse({ ...input, memberId: 'ates' }).memberIds).toEqual(['ates']);
    expect(reminderInputSchema.parse({ ...input, memberId: 'ates', memberIds: [] })).toMatchObject({
      memberIds: [],
      memberId: null,
    });
    expect(reminderInputSchema.parse({ ...input, memberIds: ['ates', 'bulut'] })).toMatchObject({
      memberIds: ['ates', 'bulut'],
      memberId: null,
    });
    expect(reminderInputSchema.safeParse({ ...input, memberIds: ['ates', 'ates'] }).success).toBe(
      false,
    );
  });
  it('addresses one or multiple people in selection order without changing the authored sentence', () => {
    expect(addressedText(input.text, ['Ateş'])).toBe('Ateş, satranç dersin başlıyor');
    expect(addressedText('çocuklar odanıza çıkma zamanınız geldi', ['Ateş', 'Bulut'])).toBe(
      'Ateş ve Bulut, çocuklar odanıza çıkma zamanınız geldi',
    );
    expect(recipientLabel(['Ateş', 'Bulut', 'Deniz'])).toBe('Ateş, Bulut ve Deniz');
    expect(addressedText(input.text, [])).toBe(input.text);
    const members = [
      { id: 'b', name: 'Bulut', color: 'sage' as const },
      { id: 'a', name: 'Ateş', color: 'sky' as const },
    ];
    expect(selectedMembers({ memberIds: ['a', 'b'] }, members).map((m) => m.name)).toEqual([
      'Ateş',
      'Bulut',
    ]);
  });
  it('does not repeat a pre-existing salutation or strip names used inside the message', () => {
    expect(addressedText('Ateş, satranç dersin başlıyor', ['Ateş'])).toBe(
      'Ateş, satranç dersin başlıyor',
    );
    expect(addressedText('Ateş ve Bulut, odanıza çıkın.', ['Ateş', 'Bulut'])).toBe(
      'Ateş ve Bulut, odanıza çıkın.',
    );
    expect(addressedText('Ateş, odanıza çıkın.', ['Ateş', 'Bulut'])).toBe(
      'Ateş ve Bulut, odanıza çıkın.',
    );
    expect(reminderBody('IŞIK, dersin başlıyor', ['Işık'])).toBe('dersin başlıyor');
    expect(reminderBody('Ateş satranç oynayacak.', ['Ateş'])).toBe('Ateş satranç oynayacak.');
    expect(reminderBody('Ateşkes zamanı.', ['Ateş'])).toBe('Ateşkes zamanı.');
  });
  it('uses plural lessons for multiple recipients in both advance announcements', () => {
    const texts = advanceTexts({ title: 'satranç dersi', advanceReminders: [60, 30] }, [
      'Ateş',
      'Bulut',
    ]).filter((s) => s.day === 'today');
    expect(texts.map((s) => s.text)).toEqual([
      'Ateş ve Bulut, bugün satranç dersiniz var. Derse 1 saat kaldı.',
      'Ateş ve Bulut, satranç dersinize 30 dakika kaldı.',
    ]);
  });
  it('previews the same addressed text used by the scheduler without changing the editor text', () => {
    const form = reminderInputSchema.parse({
      ...input,
      memberIds: ['ates', 'bulut'],
      text: 'çocuklar odanıza çıkma zamanınız geldi',
      advanceReminders: [60],
    });
    const preview = reminderPreview(form, ['Ateş', 'Bulut']);
    expect(preview).toHaveLength(2);
    expect(preview[1].version.text).toBe('Ateş ve Bulut, çocuklar odanıza çıkma zamanınız geldi');
    expect(form.text).toBe('çocuklar odanıza çıkma zamanınız geldi');
    expect(
      announcementVersion({ ...preview[1].version, spokenText: undefined, text: 'Eski metin' })
        ?.text,
    ).toBe('Eski metin');
  });
});
