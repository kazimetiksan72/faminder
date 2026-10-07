import {
  reminderInputSchema,
  defaultSettings,
  type Snapshot,
  type ReminderInput,
  type Settings,
  type Member,
} from '@faminder/shared';
const key = 'faminder.demo.v1';
export const isDemo = () => window.location.pathname === '/demo';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function request<T = unknown>(
  path: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-Faminder-Client': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(data.error || 'İşlem tamamlanamadı.', response.status);
  return data;
}
const uuid = () => crypto.randomUUID();
function initialDemo(): Snapshot {
  const familyId = 'demo-family';
  const now = new Date().toISOString();
  const members: Member[] = [
    { id: 'elif', name: 'Elif', color: 'peach' },
    { id: 'deniz', name: 'Deniz', color: 'sky' },
    { id: 'anne', name: 'Anne', color: 'lavender' },
    { id: 'baba', name: 'Baba', color: 'sage' },
  ];
  const samples = [
    [
      'Güne birlikte başlayalım',
      'Kahvaltı hazır! Güzel bir güne birlikte başlayalım.',
      '07:30',
      null,
      'sun',
      'meal',
    ],
    [
      'Okul çantası hazır mı?',
      'Deniz, su şişeni ve ödevlerini çantana koymayı unutma.',
      '08:15',
      'deniz',
      'sky',
      'book',
    ],
    [
      'Biraz kitap, biraz hayal',
      'Elif, en sevdiğin kitabı seç. Birlikte okuma zamanı.',
      '17:00',
      'elif',
      'lavender',
      'book',
    ],
    [
      'Oyuncaklar evine dönsün',
      'Oyuncakları birlikte yerlerine koyalım mı?',
      '19:00',
      null,
      'peach',
      'heart',
    ],
    [
      'Minik dişler, kocaman gülüşler',
      'Elif ve Deniz, dişlerimizi fırçalama zamanı.',
      '20:30',
      null,
      'sage',
      'brush',
    ],
    [
      'Tatlı rüyalar zamanı',
      'Pijamalarımızı giyelim, yeni bir hikâye bizi bekliyor.',
      '21:00',
      null,
      'lavender',
      'moon',
    ],
  ];
  const reminders = samples.map(([title, text, time, memberId, color, icon]) => {
    const content = {
      ...reminderInputSchema.parse({
        title,
        text,
        memberId,
        color,
        icon,
        schedule: { kind: 'daily', time },
      }),
      revision: uuid(),
      audioKey: uuid(),
      createdAt: now,
    };
    return {
      id: uuid(),
      familyId,
      content,
      enabled: true,
      updatedAt: now,
    };
  });
  return {
    family: { id: familyId, ...defaultSettings, familyName: 'Yılmaz Ailesi' },
    members,
    reminders,
    devices: [
      {
        id: 'demo-device',
        name: 'Salon tableti',
        lastSeenAt: now,
        lastSyncAt: now,
        installed: Object.fromEntries(reminders.map((r) => [r.id, r.content.revision])),
        revoked: false,
      },
    ],
    events: [],
    serverTime: now,
    capabilities: { speechConfigured: false, model: 'gemini-3.8-flash-lite-tts' },
  };
}
export function demoSnapshot(): Snapshot {
  const value = localStorage.getItem(key);
  if (value) {
    try {
      const saved = JSON.parse(value);
      saved.reminders = saved.reminders.map((r: any) => {
        const { audioId: _legacyFile, ...content } = r.content ?? r.desired;
        return {
          id: r.id,
          familyId: r.familyId,
          enabled: r.enabled,
          updatedAt: r.updatedAt,
          content: { ...content, audioKey: content.audioKey ?? uuid() },
        };
      });
      localStorage.setItem(key, JSON.stringify(saved));
      return saved;
    } catch {}
  }
  const s = initialDemo();
  localStorage.setItem(key, JSON.stringify(s));
  return s;
}
function mutate(fn: (s: Snapshot) => void) {
  const s = demoSnapshot();
  fn(s);
  localStorage.setItem(key, JSON.stringify(s));
}
export const client = {
  snapshot: async () => {
    if (isDemo()) return demoSnapshot();
    const data = await request<Snapshot>('/snapshot');
    return data;
  },
  save: async (input: ReminderInput, id?: string) => {
    if (!isDemo())
      return request(id ? `/reminders/${id}` : '/reminders', input, id ? 'PUT' : 'POST');
    mutate((s) => {
      const now = new Date().toISOString();
      const content = { ...input, revision: uuid(), audioKey: uuid(), createdAt: now };
      const r = {
        id: id ?? uuid(),
        familyId: s.family.id,
        content,
        enabled: input.enabled,
        updatedAt: now,
      };
      const index = s.reminders.findIndex((v) => v.id === id);
      if (index < 0) s.reminders.push(r);
      else s.reminders[index] = r;
    });
  },
  toggle: async (id: string, enabled: boolean) => {
    if (!isDemo()) return request(`/reminders/${id}/enabled`, { enabled }, 'PATCH');
    mutate((s) => {
      const r = s.reminders.find((r) => r.id === id)!;
      r.enabled = enabled;
      r.content.enabled = enabled;
    });
  },
  remove: async (id: string) => {
    if (!isDemo()) return request(`/reminders/${id}`, undefined, 'DELETE');
    mutate((s) => {
      s.reminders = s.reminders.filter((r) => r.id !== id);
    });
  },
  addMember: async (name: string, color: string) => {
    if (!isDemo()) return request('/members', { name, color });
    mutate((s) => {
      s.members.push({ id: uuid(), name, color: color as Member['color'] });
    });
  },
  removeMember: async (id: string) => {
    if (!isDemo()) return request(`/members/${id}`, undefined, 'DELETE');
    mutate((s) => {
      if (s.reminders.some((r) => r.content.memberId === id))
        throw new Error('Önce bu kişinin rutinlerini başka bir kişiye atayın.');
      s.members = s.members.filter((m) => m.id !== id);
    });
  },
  settings: async (settings: Settings) => {
    if (!isDemo()) return request('/settings', settings, 'PUT');
    mutate((s) => {
      s.family = { ...s.family, ...settings };
    });
  },
  pair: async (code: string, name: string) => {
    if (isDemo())
      throw new Error('Gerçek bir tablet bağlamak için demo modundan çıkıp hesap oluşturun.');
    return request('/devices/pair', { code, name });
  },
  revoke: async (id: string) => {
    if (!isDemo()) return request(`/devices/${id}`, undefined, 'DELETE');
    mutate((s) => {
      s.devices = s.devices.filter((d) => d.id !== id);
    });
  },
};
