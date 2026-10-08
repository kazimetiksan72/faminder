import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Home,
  CalendarDays,
  Users,
  Tablet,
  History,
  Settings,
  Plus,
  Bell,
  ArrowUpRight,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Search,
  X,
  Check,
  CheckCheck,
  Play,
  Pause,
  Pencil,
  Trash2,
  LogOut,
  Leaf,
  Sun,
  Moon,
  BookOpen,
  Utensils,
  Heart,
  Sparkles,
  Volume2,
  Wifi,
  RefreshCw,
  Menu,
  AlertCircle,
  CheckCircle2,
  Clock3,
  AudioLines,
  Monitor,
} from 'lucide-react';
import {
  dayLabels,
  colors,
  voices,
  scheduleLabel,
  nextOccurrence,
  reminderInputSchema,
  durationLabel,
  reminderPreview,
  suggestedReminderText,
  type Reminder,
  type ReminderInput,
  type Snapshot,
  type Occurrence,
  type Settings as FamilySettings,
} from '@faminder/shared';
import { ApiError, client, isDemo, request } from './client';
type View = 'home' | 'routines' | 'family' | 'devices' | 'history' | 'settings';
const nav = [
  ['home', 'Genel bakış', Home],
  ['routines', 'Rutinler', CalendarDays],
  ['family', 'Ailem', Users],
  ['devices', 'Tabletler', Tablet],
  ['history', 'Geçmiş', History],
  ['settings', 'Ayarlar', Settings],
] as const;
const icons = {
  sun: Sun,
  book: BookOpen,
  brush: Sparkles,
  moon: Moon,
  meal: Utensils,
  heart: Heart,
};
const eventNames = {
  played: 'Seslendirildi',
  completed: 'Tamamlandı',
  snoozed: '5 dakika ertelendi',
  missed: 'Kaçırıldı',
  failed: 'Ses oynatılamadı',
  quiet: 'Sessiz saat',
  interrupted: 'Yarıda kesildi',
};
const dateIn = (date: Date, timezone = 'Europe/Istanbul') =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(date);
const longDate = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
const shift = (date: string, n: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
function Logo() {
  return (
    <div className="brand">
      <span className="brand-symbol">
        <Bell size={23} strokeWidth={2.3} />
        <span />
      </span>
      faminder<span className="brand-dot">.</span>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    document.body.style.overflow = 'hidden';
    ref.current?.querySelector<HTMLElement>('input,button,select')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') {
        const focusable = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input,select,textarea,[tabindex="0"]',
        );
        if (!focusable?.length) return;
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Kapat" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Login({ onLogin, initialError }: { onLogin: () => void; initialError: string }) {
  const [register, setRegister] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(initialError);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await request(`/auth/${register ? 'register' : 'login'}`, fields);
      onLogin();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <div className="auth-story">
        <Logo />
        <div>
          <span className="eyebrow">EVİNİZİN KÜÇÜK HATIRLATICISI</span>
          <h1>
            Birlikte yaşamanın
            <br />
            <em>güzel bir ritmi var.</em>
          </h1>
          <p>
            Çantalar hazırlanır. Hikâyeler okunur.
            <br />
            Küçük rutinler, güzel alışkanlıklara dönüşür.
          </p>
          <HouseArt />
        </div>
        <span className="auth-foot">Daha az “unutma”, daha çok birlikte.</span>
      </div>
      <div className="auth-form">
        <div className="auth-form-inner">
          <div className="mini-label">
            <Leaf size={16} /> AİLENİZE BİRAZ YER AÇIN
          </div>
          <h2>{register ? 'Ailenizin ritmini kuralım.' : 'Yeniden hoş geldiniz.'}</h2>
          <p>
            {register
              ? 'Evinizin günlük rutinleri, tek bir yerde.'
              : 'Bugünün küçük hatırlatıcıları sizi bekliyor.'}
          </p>
          <form onSubmit={submit}>
            {register && (
              <>
                <label>
                  Adınız
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    maxLength={60}
                    placeholder="Adınız"
                  />
                </label>
                <label>
                  Aile adı
                  <input
                    name="familyName"
                    required
                    maxLength={60}
                    placeholder="Örn. Yılmaz Ailesi"
                  />
                </label>
              </>
            )}
            <label>
              E-posta
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                placeholder="siz@ornek.com"
              />
            </label>
            <label>
              Parola
              <input
                name="password"
                type="password"
                autoComplete={register ? 'new-password' : 'current-password'}
                required
                minLength={10}
                maxLength={128}
                placeholder="En az 10 karakter"
              />
            </label>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? 'Bir dakika…' : register ? 'Ailemi oluştur' : 'Giriş yap'}
              <ArrowRight size={17} />
            </button>
          </form>
          <p className="auth-switch">
            {register ? 'Zaten hesabınız var mı?' : 'Henüz hesabınız yok mu?'}{' '}
            <button
              onClick={() => {
                setRegister(!register);
                setError('');
              }}
            >
              {register ? 'Giriş yapın' : 'Ailenizi oluşturun'}
            </button>
          </p>
          <div className="auth-demo">
            <span>Önce bir göz atmak ister misiniz?</span>
            <a href="/demo">
              Örnek aileyi keşfet <ArrowUpRight size={15} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
function HouseArt() {
  return (
    <svg className="house-art" viewBox="0 0 370 230" fill="none" aria-hidden="true">
      <ellipse cx="196" cy="212" rx="133" ry="12" fill="#173f34" opacity=".09" />
      <path d="M88 110L192 34L296 110V202H88V110Z" fill="#E8DBC4" />
      <path
        d="M68 111L192 20L316 111"
        stroke="#F3F0E4"
        strokeWidth="15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M240 58V29H265V77" fill="#D9CBAF" />
      <rect x="111" y="115" width="45" height="50" rx="4" fill="#D3AE71" />
      <path d="M133 117V164M114 140H153" stroke="#F7EEDD" strokeWidth="4" />
      <rect x="226" y="115" width="45" height="50" rx="4" fill="#D3AE71" />
      <path d="M248 117V164M229 140H268" stroke="#F7EEDD" strokeWidth="4" />
      <path d="M175 201V152A18 18 0 0 1 211 152V201" fill="#6F9079" />
      <circle cx="201" cy="171" r="3" fill="#EDE7D5" />
      <path d="M56 203V159M327 203V172" stroke="#7B8C65" strokeWidth="4" />
      <ellipse cx="47" cy="162" rx="12" ry="22" transform="rotate(-35 47 162)" fill="#ABC298" />
      <ellipse cx="67" cy="151" rx="12" ry="25" transform="rotate(28 67 151)" fill="#8EA780" />
      <ellipse cx="318" cy="168" rx="10" ry="19" transform="rotate(-30 318 168)" fill="#ACC499" />
      <ellipse cx="337" cy="162" rx="10" ry="22" transform="rotate(30 337 162)" fill="#87A080" />
      <circle cx="291" cy="32" r="16" fill="#ECCB86" />
      <path
        d="M172 90C172 80 185 78 192 88C200 78 212 80 212 90C212 101 192 111 192 111C192 111 172 101 172 90Z"
        fill="#CA856F"
      />
    </svg>
  );
}

export default function App() {
  const [data, setData] = useState<Snapshot | null>(null),
    [loading, setLoading] = useState(true),
    [authError, setAuthError] = useState('');
  const [view, setView] = useState<View>('home'),
    [selected, setSelected] = useState(dateIn(new Date())),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all');
  const [editor, setEditor] = useState<Reminder | 'new' | null>(null),
    [memberModal, setMemberModal] = useState(false),
    [pairModal, setPairModal] = useState(false),
    [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState(''),
    [confirm, setConfirm] = useState<{ message: string; action: () => Promise<unknown> } | null>(
      null,
    ),
    [working, setWorking] = useState(false);
  const [playing, setPlaying] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const audioUrl = useRef<string | null>(null);
  async function refresh() {
    try {
      setData(await client.snapshot());
      setAuthError('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setData(null);
      else {
        setAuthError((e as Error).message);
      }
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      clearInterval(timer);
      previewRequest.current?.abort();
      player.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timeout);
  }, [toast]);
  async function act(action: () => Promise<unknown>, message: string) {
    setWorking(true);
    try {
      await action();
      await refresh();
      setToast(message);
      return true;
    } catch (e) {
      setToast((e as Error).message);
      return false;
    } finally {
      setWorking(false);
    }
  }
  async function preview(r: Reminder, occurrence?: Occurrence) {
    previewRequest.current?.abort();
    player.current?.pause();
    if (playing === r.id) {
      setPlaying(null);
      return;
    }
    if (isDemo()) {
      setToast(
        'Demo modunda gerçek ses üretilmez. Kendi ailenizle ses önizlemesini kullanabilirsiniz.',
      );
      return;
    }
    const controller = new AbortController();
    previewRequest.current = controller;
    setPlaying(r.id);
    setToast('Gemini sesi hazırlanıyor…');
    try {
      const response = await fetch(`/api/reminders/${r.id}/speech`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Faminder-Client': '1' },
        body: JSON.stringify({
          revision: r.content.revision,
          audioKey: occurrence?.version.audioKey ?? r.content.audioKey,
          ...(occurrence?.minutesBefore
            ? { minutesBefore: occurrence.minutesBefore, day: occurrence.speechDay }
            : {}),
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(105000)]),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error ?? 'Ses üretilemedi.');
      }
      const blob = await response.blob();
      if (controller.signal.aborted || previewRequest.current !== controller) return;
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl.current);
      player.current = audio;
      audio.onended = () => setPlaying(null);
      audio.onerror = () => {
        setPlaying(null);
        setToast('Ses oynatılamadı.');
      };
      await audio.play();
      setToast('');
    } catch (e) {
      if (!controller.signal.aborted && previewRequest.current === controller) {
        setPlaying(null);
        setToast((e as Error).message);
      }
    }
  }
  if (loading)
    return (
      <div className="loading-screen">
        <Logo />
        <span className="spinner" />
        Evinizin ritmi yükleniyor…
      </div>
    );
  if (!data) return <Login initialError={authError} onLogin={() => void refresh()} />;
  const today = dateIn(new Date(), data.family.timezone);
  const active = data.reminders.filter((r) => r.enabled);
  const due = data.reminders.filter((r) => {
    const s = r.content.schedule;
    const day = new Date(`${selected}T12:00:00Z`).getUTCDay() || 7;
    return (
      s.kind === 'daily' ||
      (s.kind === 'weekly' && s.days.includes(day)) ||
      (s.kind === 'once' && s.date === selected)
    );
  });
  const shown = (view === 'home' ? due : data.reminders)
    .filter(
      (r) =>
        (filter === 'all' || (filter === 'active' ? r.enabled : !r.enabled)) &&
        `${r.content.title} ${r.content.text}`
          .toLocaleLowerCase('tr')
          .includes(query.toLocaleLowerCase('tr')),
    )
    .sort((a, b) => a.content.schedule.time.localeCompare(b.content.schedule.time));
  const next = active
    .map((r) => ({ r, occurrence: nextOccurrence(r) }))
    .filter((x) => x.occurrence)
    .sort((a, b) => a.occurrence!.scheduledAt.localeCompare(b.occurrence!.scheduledAt))[0];
  const weekStart = shift(selected, -((new Date(`${selected}T12:00:00Z`).getUTCDay() || 7) - 1));
  const done = new Set(
    data.events
      .filter(
        (e) => e.kind === 'completed' && dateIn(new Date(e.at), data.family.timezone) === selected,
      )
      .map((e) => e.reminderId),
  ).size;
  function go(v: View) {
    setView(v);
    setQuery('');
    setFilter('all');
    setSidebar(false);
  }
  return (
    <div className="app-shell">
      {sidebar && <div className="sidebar-backdrop" onClick={() => setSidebar(false)} />}
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <a className="brand-link" href={isDemo() ? '/demo' : '/'}>
          <Logo />
        </a>
        <div className="family-switch">
          <div className="family-house">
            <Home size={21} />
          </div>
          <div>
            <strong>{data.family.familyName}</strong>
            <span>Birlikte, her gün.</span>
          </div>
          <Leaf size={15} />
        </div>
        <span className="nav-caption">AİLE ALANINIZ</span>
        <nav>
          {nav.map(([id, label, Icon]) => (
            <button key={id} className={view === id ? 'selected' : ''} onClick={() => go(id)}>
              <Icon size={19} />
              <span>{label}</span>
              {id === 'routines' && <small>{data.reminders.length}</small>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="note-icon">
            <Heart size={20} />
          </span>
          <strong>
            Küçük rutinler,
            <br />
            büyük güzel anlar.
          </strong>
          <p>
            Hatırlatmayı bize bırakın.
            <br />
            Birlikte olmaya zaman kalsın.
          </p>
          <span className="note-spark">✧</span>
        </div>
        <div className="sidebar-bottom">
          <div className="avatar sage">{data.family.familyName[0]}</div>
          <div>
            <strong>Aile yöneticisi</strong>
            <span>{isDemo() ? 'Örnek aile hesabı' : 'Kişisel aile alanı'}</span>
          </div>
          <button
            className="icon-button"
            aria-label="Çıkış yap"
            onClick={() =>
              isDemo()
                ? window.location.assign('/')
                : void act(async () => {
                    await request('/auth/logout', {});
                    setData(null);
                  }, 'Çıkış yapıldı.')
            }
          >
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="Menüyü aç"
              onClick={() => setSidebar(true)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">Aile alanı</span>
            <ChevronRight size={13} />
            <strong>{nav.find((n) => n[0] === view)?.[1]}</strong>
          </div>
          <div className="topbar-right">
            {isDemo() && (
              <a className="demo-tag" href="/">
                Demo modu · Hesap oluştur <ArrowUpRight size={12} />
              </a>
            )}
            <span className="today-label">
              <CalendarDays size={15} />
              {longDate(today)}
            </span>
            <div className="avatar small sage">{data.family.familyName[0]}</div>
          </div>
        </header>
        <main>
          {authError && (
            <div className="warning">
              <AlertCircle size={17} />
              {authError}
              <button onClick={() => void refresh()}>Tekrar dene</button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {view === 'home' ? 'HER GÜN, BİRAZ DAHA BİRLİKTE' : 'FAMINDER · AİLE ALANI'}
              </span>
              <h1>
                {view === 'home'
                  ? 'Evinizin ritmi burada.'
                  : view === 'routines'
                    ? 'Küçük rutinler, güzel alışkanlıklar.'
                    : view === 'family'
                      ? 'Bu evin güzel insanları.'
                      : view === 'devices'
                        ? 'Evinizin hatırlatan sesi.'
                        : view === 'history'
                          ? 'Günün küçük adımları.'
                          : 'Tam da ailenize göre.'}
                <span className="heading-leaf">{view === 'home' && <Leaf size={28} />}</span>
              </h1>
              <p>
                {view === 'home'
                  ? 'Günü kolaylaştıran küçük hatırlatıcılar, aileniz için bir arada.'
                  : view === 'routines'
                    ? 'Her hatırlatıcı, gününüzde küçük bir yer açar.'
                    : view === 'family'
                      ? 'Rutinleri aile üyelerine göre kişiselleştirin.'
                      : view === 'devices'
                        ? 'Tabletlerinizi eşleştirin, hatırlatıcıların ulaştığından emin olun.'
                        : view === 'history'
                          ? 'Tabletlerden gelen seslendirme ve tamamlanma kayıtları.'
                          : 'Ailenizin saat dilimini ve sessiz saatlerini düzenleyin.'}
              </p>
            </div>
            {(view === 'home' || view === 'routines') && (
              <button className="button primary" onClick={() => setEditor('new')}>
                <Plus size={18} />
                Yeni hatırlatıcı
              </button>
            )}
            {view === 'family' && (
              <button className="button primary" onClick={() => setMemberModal(true)}>
                <Plus size={18} />
                Aile üyesi ekle
              </button>
            )}
            {view === 'devices' && (
              <button className="button primary" onClick={() => setPairModal(true)}>
                <Plus size={18} />
                Tablet bağla
              </button>
            )}
          </div>
          {view === 'home' && (
            <>
              <div className="hero">
                <div className="hero-copy">
                  <span className="hero-label">
                    <span /> AİLENİZİN GÜNLÜK RİTMİ
                  </span>
                  <h2>
                    Hatırlamak bize,
                    <br />
                    <em>birlikte olmak size.</em>
                  </h2>
                  <p>
                    {active.length
                      ? `${active.length} küçük hatırlatıcı, gününüze eşlik etmeye hazır.`
                      : 'İlk hatırlatıcınızı ekleyin, evinizin ritmini birlikte kuralım.'}
                  </p>
                  <button className="hero-link" onClick={() => go('routines')}>
                    Aile rutinlerine göz at <ArrowRight size={17} />
                  </button>
                </div>
                <HouseArt />
                <div className="hero-floating">
                  <div className="floating-icon">
                    <Check size={19} />
                  </div>
                  <div>
                    <strong>Bir küçük hatırlatma.</strong>
                    <span>Biraz daha huzurlu bir gün.</span>
                  </div>
                </div>
              </div>
              <div className="stats">
                <Stat
                  label="Bugünün rutinleri"
                  value={due.length}
                  detail="Güne eşlik eden küçük adımlar"
                  icon={<CalendarDays size={21} />}
                  color="sage"
                />
                <Stat
                  label="Tamamlanan"
                  value={done}
                  detail={done ? 'Harika, adım adım ilerliyoruz.' : 'Her küçük adım bir başlangıç.'}
                  icon={<CheckCheck size={21} />}
                  color="peach"
                />
                <Stat
                  label="Aile üyeleri"
                  value={data.members.length}
                  detail="Aynı evin farklı ritimleri"
                  icon={<Users size={21} />}
                  color="lavender"
                />
              </div>
            </>
          )}
          {(view === 'home' || view === 'routines') && (
            <div className={view === 'home' ? 'dashboard-grid' : 'routines-full'}>
              <section className="panel routine-panel">
                <div className="section-heading">
                  <div>
                    <h2>{view === 'home' ? 'Günün akışı' : 'Tüm hatırlatıcılar'}</h2>
                    <span>
                      {view === 'home'
                        ? longDate(selected)
                        : `${data.reminders.length} hatırlatıcı · Ailenizin ortak programı`}
                    </span>
                  </div>
                  {view === 'home' && (
                    <div className="date-buttons">
                      <button
                        className="icon-button"
                        aria-label="Önceki hafta"
                        onClick={() => setSelected(shift(selected, -7))}
                      >
                        <ChevronLeft size={17} />
                      </button>
                      <button onClick={() => setSelected(today)}>Bugün</button>
                      <button
                        className="icon-button"
                        aria-label="Sonraki hafta"
                        onClick={() => setSelected(shift(selected, 7))}
                      >
                        <ChevronRight size={17} />
                      </button>
                    </div>
                  )}
                </div>
                {view === 'home' && (
                  <div className="week-strip">
                    {dayLabels.map((day, i) => {
                      const date = shift(weekStart, i);
                      return (
                        <button
                          key={date}
                          className={`${date === selected ? 'active' : ''} ${date === today ? 'is-today' : ''}`}
                          onClick={() => setSelected(date)}
                        >
                          <span>{day}</span>
                          <strong>{Number(date.slice(-2))}</strong>
                          <i />
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="list-toolbar">
                  <div className="tabs">
                    <button
                      className={filter === 'all' ? 'active' : ''}
                      onClick={() => setFilter('all')}
                    >
                      Tümü
                    </button>
                    <button
                      className={filter === 'active' ? 'active' : ''}
                      onClick={() => setFilter('active')}
                    >
                      Aktif
                    </button>
                    <button
                      className={filter === 'paused' ? 'active' : ''}
                      onClick={() => setFilter('paused')}
                    >
                      Duraklatılan
                    </button>
                  </div>
                  <label className="search">
                    <Search size={16} />
                    <input
                      aria-label="Hatırlatıcı ara"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Rutinlerde ara"
                    />
                  </label>
                </div>
                <div className="routine-list">
                  {shown.length ? (
                    shown.map((r) => (
                      <RoutineCard
                        key={r.id}
                        reminder={r}
                        data={data}
                        playing={playing === r.id}
                        onPlay={() => void preview(r)}
                        onEdit={() => setEditor(r)}
                        onToggle={() =>
                          void act(
                            () => client.toggle(r.id, !r.enabled),
                            r.enabled
                              ? 'Hatırlatıcı duraklatıldı.'
                              : 'Hatırlatıcı etkinleştirildi.',
                          )
                        }
                        disabled={working}
                      />
                    ))
                  ) : (
                    <Empty
                      icon={<CalendarDays />}
                      title="Burada henüz bir rutin yok."
                      description={
                        query
                          ? 'Başka bir arama deneyin.'
                          : 'Günün küçük bir anını hatırlatıcıya dönüştürün.'
                      }
                      action={
                        <button className="button secondary" onClick={() => setEditor('new')}>
                          <Plus size={17} />
                          Hatırlatıcı ekle
                        </button>
                      }
                    />
                  )}
                </div>
                <div className="panel-foot">
                  <Volume2 size={14} /> Metinler tablette Gemini ile seslendirilir. İlk okuma için
                  internet gerekir.
                </div>
              </section>
              {view === 'home' && (
                <aside className="right-column">
                  <section className="panel next-card">
                    <span className="mini-label">
                      <Clock3 size={15} /> SIRADAKİ KÜÇÜK ADIM
                    </span>
                    {next ? (
                      <>
                        <div className="next-time">
                          {new Intl.DateTimeFormat('tr-TR', {
                            timeZone: data.family.timezone,
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(next.occurrence!.scheduledAt))}
                          <span>
                            {dateIn(
                              new Date(next.occurrence!.scheduledAt),
                              data.family.timezone,
                            ) === today
                              ? 'bugün'
                              : longDate(
                                  dateIn(
                                    new Date(next.occurrence!.scheduledAt),
                                    data.family.timezone,
                                  ),
                                )}
                          </span>
                        </div>
                        <h3>{next.r.content!.title}</h3>
                        {next.occurrence!.minutesBefore && (
                          <span className="advance-tag">
                            {durationLabel(next.occurrence!.minutesBefore)} önce · Ön hatırlatma
                          </span>
                        )}
                        <p>“{next.occurrence!.version.text}”</p>
                        <button
                          className="button secondary full"
                          onClick={() => void preview(next.r, next.occurrence!)}
                        >
                          <Play size={15} />
                          Sesi dinle
                        </button>
                      </>
                    ) : (
                      <>
                        <h3>Güzel bir başlangıç yapalım.</h3>
                        <p>İlk hatırlatıcınızı eklediğinizde burada görünecek.</p>
                      </>
                    )}
                  </section>
                  <section className="panel family-card">
                    <div className="section-heading">
                      <h2>Ailem</h2>
                      <button className="text-button" onClick={() => go('family')}>
                        Tümü <ArrowUpRight size={14} />
                      </button>
                    </div>
                    <div className="member-bubbles">
                      {data.members.slice(0, 5).map((m) => (
                        <div key={m.id}>
                          <div className={`avatar ${m.color}`}>{m.name[0]}</div>
                          <span>{m.name}</span>
                        </div>
                      ))}
                      <button
                        className="add-person"
                        aria-label="Aile üyesi ekle"
                        onClick={() => setMemberModal(true)}
                      >
                        <Plus size={18} />
                      </button>
                    </div>
                  </section>
                  <section className="panel device-card">
                    <div className="device-card-icon">
                      <Tablet size={27} />
                      <span
                        className={
                          data.devices.some(
                            (d) => d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 90000,
                          )
                            ? 'online'
                            : ''
                        }
                      />
                    </div>
                    <h3>{data.devices[0]?.name || 'Evinize bir ses ekleyin'}</h3>
                    <p>
                      {data.devices.length
                        ? `${data.devices.length} tablet ailenize bağlı.`
                        : 'Tabletinizi bağlayın, rutinler evinizde ses bulsun.'}
                    </p>
                    <button
                      className="text-button"
                      onClick={() => (data.devices.length ? go('devices') : setPairModal(true))}
                    >
                      {data.devices.length ? 'Tabletleri yönet' : 'Tablet bağla'}
                      <ArrowRight size={15} />
                    </button>
                  </section>
                </aside>
              )}
            </div>
          )}
          {view === 'family' && (
            <div className="member-grid">
              {data.members.map((m) => (
                <section className="panel member-card" key={m.id}>
                  <div className={`avatar large ${m.color}`}>{m.name[0]}</div>
                  <h2>{m.name}</h2>
                  <p>
                    {data.reminders.filter((r) => r.content.memberId === m.id).length} kişisel
                    hatırlatıcı
                  </p>
                  <button
                    className="text-button muted"
                    onClick={() =>
                      setConfirm({
                        message: `${m.name} aile üyelerinden kaldırılsın mı?`,
                        action: () => client.removeMember(m.id),
                      })
                    }
                  >
                    <Trash2 size={14} />
                    Kaldır
                  </button>
                </section>
              ))}
              <button className="member-add" onClick={() => setMemberModal(true)}>
                <Plus size={28} />
                <strong>Aile üyesi ekle</strong>
                <span>Herkesin kendi küçük rutinleri var.</span>
              </button>
            </div>
          )}
          {view === 'devices' && (
            <div className="device-grid">
              {data.devices.map((d) => {
                const online = !!d.lastSeenAt && Date.now() - Date.parse(d.lastSeenAt) < 90000;
                const installed = data.reminders.filter(
                  (r) => d.installed[r.id] === r.content.revision,
                ).length;
                return (
                  <section className="panel device-detail" key={d.id}>
                    <div className="device-detail-top">
                      <Tablet size={34} />
                      <span className={`status-badge ${online ? 'ready' : 'paused'}`}>
                        <span />
                        {online ? 'Bağlı' : 'Çevrimdışı'}
                      </span>
                    </div>
                    <h2>{d.name}</h2>
                    <p>
                      {installed} / {data.reminders.length} metin eşitlendi hatırlatıcı tablete
                      ulaştı
                    </p>
                    <div className="sync-progress">
                      <div
                        style={{
                          width: `${(100 * installed) / Math.max(1, data.reminders.length)}%`,
                        }}
                      />
                    </div>
                    <div className="device-meta">
                      <span>Son eşitleme</span>
                      <strong>
                        {d.lastSyncAt
                          ? new Date(d.lastSyncAt).toLocaleString('tr-TR', {
                              timeZone: data.family.timezone,
                            })
                          : 'İlk bağlantı bekleniyor'}
                      </strong>
                    </div>
                    <button
                      className="text-button danger"
                      onClick={() =>
                        setConfirm({
                          message: `${d.name} bağlantısı kaldırılsın mı? Çevrimdışı cihaz, bağlantı kurana kadar indirdiği rutinleri çalıştırabilir.`,
                          action: () => client.revoke(d.id),
                        })
                      }
                    >
                      Bağlantıyı kaldır <Trash2 size={14} />
                    </button>
                  </section>
                );
              })}
              {!data.devices.length && (
                <Empty
                  icon={<Monitor />}
                  title="Henüz bağlı bir tablet yok."
                  description="Tablet uygulamasındaki altı haneli kodla evinizi bağlayın."
                  action={
                    <button className="button primary" onClick={() => setPairModal(true)}>
                      Tablet bağla
                    </button>
                  }
                />
              )}
            </div>
          )}
          {view === 'history' && (
            <section className="panel history-panel">
              {data.events.length ? (
                data.events.map((e) => (
                  <div className="history-row" key={`${e.deviceId}:${e.id}`}>
                    <div className={`routine-icon ${e.kind === 'completed' ? 'sage' : 'sky'}`}>
                      {e.kind === 'completed' ? <CheckCircle2 size={20} /> : <History size={20} />}
                    </div>
                    <div>
                      <strong>{e.title}</strong>
                      <span>
                        {e.minutesBefore ? `${durationLabel(e.minutesBefore)} önce · ` : ''}
                        {eventNames[e.kind]}
                      </span>
                    </div>
                    <time>
                      {new Date(e.at).toLocaleString('tr-TR', { timeZone: data.family.timezone })}
                    </time>
                  </div>
                ))
              ) : (
                <Empty
                  icon={<History />}
                  title="Hikâyeniz henüz başlıyor."
                  description="Tabletiniz rutinleri seslendirdikçe ve tamamladıkça kayıtlar burada görünecek."
                />
              )}
            </section>
          )}
          {view === 'settings' && (
            <SettingsForm
              data={data}
              onSave={(s) => act(() => client.settings(s), 'Aile ayarları güncellendi.')}
              busy={working}
            />
          )}
          <footer className="page-footer">
            <span>
              <Leaf size={13} /> Ailenizin günlük ritmi.
            </span>
            <span>Faminder · Sevgiyle hatırlatır.</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Bell size={18} />
          <span>{toast}</span>
          <button className="icon-button" aria-label="Bildirimi kapat" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {editor && (
        <Editor
          data={data}
          reminder={editor === 'new' ? undefined : editor}
          onClose={() => setEditor(null)}
          onSave={async (v) => {
            const ok = await act(
              () => client.save(v, editor === 'new' ? undefined : editor.id),
              isDemo()
                ? 'Demo hatırlatıcısı kaydedildi.'
                : 'Hatırlatıcı kaydedildi. Metin tabletlerinize aktarılıyor.',
            );
            if (ok) setEditor(null);
          }}
          onDelete={
            editor === 'new'
              ? undefined
              : () =>
                  setConfirm({
                    message: 'Bu hatırlatıcı silinsin mi?',
                    action: async () => {
                      await client.remove(editor.id);
                      setEditor(null);
                    },
                  })
          }
          busy={working}
        />
      )}
      {memberModal && (
        <Modal title="Aileye birini ekleyin" onClose={() => setMemberModal(false)}>
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              if (
                await act(
                  () => client.addMember(String(form.get('name')), String(form.get('color'))),
                  'Aile üyesi eklendi.',
                )
              )
                setMemberModal(false);
            }}
          >
            <label>
              Adı
              <input name="name" required maxLength={40} placeholder="Örn. Elif" />
            </label>
            <label>
              Rengi
              <select name="color">
                {colors.map((c) => (
                  <option value={c} key={c}>
                    {
                      {
                        sage: 'Adaçayı',
                        peach: 'Şeftali',
                        lavender: 'Lavanta',
                        sky: 'Gökyüzü',
                        sun: 'Güneş',
                      }[c]
                    }
                  </option>
                ))}
              </select>
            </label>
            <button className="button primary full" disabled={working}>
              Aileye ekle <Plus size={16} />
            </button>
          </form>
        </Modal>
      )}
      {pairModal && (
        <Modal title="Evinize bir tablet bağlayın" onClose={() => setPairModal(false)}>
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              if (
                await act(
                  () => client.pair(String(form.get('code')), String(form.get('name'))),
                  'Tablet bağlandı. İlk eşitleme bekleniyor.',
                )
              )
                setPairModal(false);
            }}
          >
            <div className="info-box">
              <Tablet size={24} />
              <p>Tablet uygulamasını açın. Ekranda gördüğünüz altı haneli kodu buraya girin.</p>
            </div>
            <label>
              Eşleştirme kodu
              <input
                className="code-input"
                name="code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                placeholder="000000"
              />
            </label>
            <label>
              Tabletin adı
              <input name="name" required maxLength={50} defaultValue="Salon tableti" />
            </label>
            <button className="button primary full" disabled={working}>
              Tableti bağla <ArrowRight size={16} />
            </button>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal title="Devam edilsin mi?" onClose={() => setConfirm(null)}>
          <div className="modal-body">
            <p>{confirm.message}</p>
            <div className="form-actions">
              <button className="button secondary" onClick={() => setConfirm(null)}>
                Vazgeç
              </button>
              <button
                className="button destructive"
                disabled={working}
                onClick={async () => {
                  if (await act(confirm.action, 'İşlem tamamlandı.')) setConfirm(null);
                }}
              >
                Evet, kaldır
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  detail,
  icon,
  color,
}: {
  label: string;
  value: number;
  detail: string;
  icon: ReactNode;
  color: string;
}) {
  return (
    <div className="stat panel">
      <div>
        <span>{label}</span>
        <strong>
          {value}
          <small>{detail}</small>
        </strong>
      </div>
      <div className={`stat-icon ${color}`}>{icon}</div>
    </div>
  );
}
function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
function RoutineCard({
  reminder: r,
  data,
  playing,
  onPlay,
  onEdit,
  onToggle,
  disabled,
}: {
  reminder: Reminder;
  data: Snapshot;
  playing: boolean;
  onPlay: () => void;
  onEdit: () => void;
  onToggle: () => void;
  disabled: boolean;
}) {
  const v = r.content,
    Icon = icons[v.icon];
  const member = data.members.find((m) => m.id === v.memberId);
  const delivered = data.devices.filter((d) => d.installed[r.id] === r.content?.revision).length;
  const status = !r.enabled
    ? 'Duraklatıldı'
    : isDemo()
      ? 'Örnek rutin'
      : delivered
        ? `${delivered} tablete ulaştı`
        : 'Metin eşitleniyor';
  return (
    <article className={`routine ${!r.enabled ? 'disabled' : ''}`}>
      <div className="routine-time">
        {v.schedule.time}
        <span>{scheduleLabel(v.schedule)}</span>
      </div>
      <div className={`routine-icon ${v.color}`}>
        <Icon size={22} />
      </div>
      <div className="routine-copy">
        <button onClick={onEdit}>
          <h3>{v.title}</h3>
        </button>
        <p>{v.text}</p>
        <div className="routine-meta">
          <span className="person-tag">
            <span className={`person-dot ${member?.color ?? 'sage'}`} />
            {member?.name ?? 'Tüm aile'}
          </span>
          {!!v.advanceReminders?.length && (
            <span className="advance-tag">
              <Bell size={12} />
              {v.advanceReminders.map((minutes) => `${durationLabel(minutes)} önce`).join(' · ')}
            </span>
          )}
          <span
            className={`status-badge ${!r.enabled ? 'paused' : delivered || isDemo() ? 'ready' : 'pending'}`}
          >
            <span />
            {status}
          </span>
        </div>
      </div>
      <div className="routine-actions">
        <button
          className="icon-button"
          aria-label={`${v.title} sesini ${playing ? 'durdur' : 'dinle'}`}
          onClick={onPlay}
        >
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <button className="icon-button" aria-label={`${v.title} düzenle`} onClick={onEdit}>
          <Pencil size={16} />
        </button>
        <button
          disabled={disabled}
          className={`switch ${r.enabled ? 'on' : ''}`}
          role="switch"
          aria-checked={r.enabled}
          aria-label={`${v.title} etkin`}
          onClick={onToggle}
        >
          <span />
        </button>
      </div>
    </article>
  );
}
function Editor({
  data,
  reminder,
  onClose,
  onSave,
  onDelete,
  busy,
}: {
  data: Snapshot;
  reminder?: Reminder;
  onClose: () => void;
  onSave: (v: ReminderInput) => Promise<void>;
  onDelete?: () => void;
  busy: boolean;
}) {
  const [form, setForm] = useState<ReminderInput>(
    reminder
      ? { ...reminder.content, advanceReminders: reminder.content.advanceReminders ?? [] }
      : {
          title: '',
          text: '',
          memberId: null,
          color: 'sage',
          icon: 'sun',
          voice: 'Kore',
          style: 'warm',
          enabled: true,
          advanceReminders: [],
          schedule: {
            kind: 'daily',
            time: '20:30',
            days: [1, 2, 3, 4, 5],
            timezone: data.family.timezone,
          },
        },
  );
  const [error, setError] = useState('');
  const set = <K extends keyof ReminderInput>(k: K, v: ReminderInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const memberName = data.members.find((m) => m.id === form.memberId)?.name;
  const previewItems = reminderPreview(form, memberName);
  return (
    <Modal
      title={reminder ? 'Hatırlatıcıyı düzenleyin' : 'Güne küçük bir hatırlatıcı ekleyin'}
      onClose={onClose}
      wide
    >
      <form
        className="modal-body editor"
        onSubmit={async (e) => {
          e.preventDefault();
          const result = reminderInputSchema.safeParse(form);
          if (!result.success) {
            setError(result.error.issues[0].message);
            return;
          }
          setError('');
          await onSave(result.data);
        }}
      >
        <div className="editor-intro">
          <span className={`routine-icon ${form.color}`}>
            {(() => {
              const Icon = icons[form.icon];
              return <Icon size={24} />;
            })()}
          </span>
          <p>Küçük bir hatırlatma, günün akışını güzelleştirebilir.</p>
        </div>
        <label>
          Hatırlatıcının adı
          <input
            required
            maxLength={80}
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Örn. Diş fırçalama zamanı"
          />
        </label>
        <label>
          Saatinde tablet ne söylesin?
          <textarea
            required
            maxLength={400}
            rows={3}
            value={form.text}
            onChange={(e) => set('text', e.target.value)}
            placeholder="Elif, minik dişlerimizi fırçalama zamanı!"
          />
          <span className="field-hint">
            Metin yapay zekâ ile seslendirilecek. <span>{form.text.length}/400</span>
          </span>
        </label>
        <button
          type="button"
          className="text-button suggest-text"
          disabled={!form.title.trim()}
          onClick={() => set('text', suggestedReminderText(form.title, memberName))}
        >
          <Sparkles size={14} /> Adına ve kişiye göre metin öner
        </button>
        <div className="form-grid">
          <label>
            Kimin için?
            <select
              value={form.memberId ?? ''}
              onChange={(e) => set('memberId', e.target.value || null)}
            >
              <option value="">Tüm aile</option>
              {data.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Saat
            <input
              type="time"
              required
              value={form.schedule.time}
              onChange={(e) => set('schedule', { ...form.schedule, time: e.target.value })}
            />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Tekrar
            <select
              value={form.schedule.kind}
              onChange={(e) =>
                set('schedule', {
                  ...form.schedule,
                  kind: e.target.value as ReminderInput['schedule']['kind'],
                })
              }
            >
              <option value="daily">Her gün</option>
              <option value="weekly">Seçili günler</option>
              <option value="once">Bir kez</option>
            </select>
          </label>
          <label>
            Saat dilimi
            <select
              value={form.schedule.timezone}
              onChange={(e) => set('schedule', { ...form.schedule, timezone: e.target.value })}
            >
              {Array.from(
                new Set([
                  data.family.timezone,
                  form.schedule.timezone,
                  'Europe/Istanbul',
                  'Europe/Berlin',
                  'Europe/London',
                  'America/New_York',
                ]),
              ).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>
        {form.schedule.kind === 'weekly' && (
          <div className="day-picker" role="group" aria-label="Tekrarlama günleri">
            {dayLabels.map((d, i) => (
              <button
                type="button"
                key={d}
                aria-pressed={form.schedule.days.includes(i + 1)}
                className={form.schedule.days.includes(i + 1) ? 'selected' : ''}
                onClick={() =>
                  set('schedule', {
                    ...form.schedule,
                    days: form.schedule.days.includes(i + 1)
                      ? form.schedule.days.filter((n) => n !== i + 1)
                      : [...form.schedule.days, i + 1],
                  })
                }
              >
                {d}
              </button>
            ))}
          </div>
        )}
        {form.schedule.kind === 'once' && (
          <label>
            Tarih
            <input
              required
              type="date"
              value={form.schedule.date ?? ''}
              onChange={(e) => set('schedule', { ...form.schedule, date: e.target.value })}
            />
          </label>
        )}
        <section className="advance-section" aria-label="Ön hatırlatmalar">
          <div className="advance-heading">
            <div>
              <h3>
                <Bell size={16} /> Ön hatırlatmalar
              </h3>
              <p>Hazırlanmak için biraz zaman. En fazla 2 bildirim ekleyebilirsin.</p>
            </div>
            <span>{form.advanceReminders.length}/2</span>
          </div>
          {form.advanceReminders.map((minutes, index) => (
            <div className="advance-row" key={index}>
              <label>
                {index + 1}. ön hatırlatma
                <div className="advance-input">
                  <input
                    type="number"
                    required
                    min={1}
                    max={1440}
                    step={1}
                    aria-label={`${index + 1}. ön hatırlatma kaç dakika önce`}
                    value={minutes || ''}
                    onChange={(e) =>
                      set(
                        'advanceReminders',
                        form.advanceReminders.map((v, i) =>
                          i === index ? Number(e.target.value) : v,
                        ),
                      )
                    }
                  />
                  <span>dakika önce</span>
                </div>
              </label>
              <button
                type="button"
                className="icon-button danger"
                aria-label={`${index + 1}. ön hatırlatmayı kaldır`}
                onClick={() =>
                  set(
                    'advanceReminders',
                    form.advanceReminders.filter((_, i) => i !== index),
                  )
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            disabled={form.advanceReminders.length >= 2}
            onClick={() =>
              set('advanceReminders', [
                ...form.advanceReminders,
                [60, 30, 15].find((v) => !form.advanceReminders.includes(v))!,
              ])
            }
          >
            <Plus size={15} /> Ön hatırlatma ekle
          </button>
          <p className="advance-help">
            1 dakika ile 24 saat arası seçebilirsin. En az 1 saat varsa “bugün” vurgulanır; geceyi
            aşarsa gün bilgisi değişir.
          </p>
          {!!form.advanceReminders.length && !!form.title.trim() && (
            <div className="announcement-preview" aria-label="Duyuru akışı">
              <h4>Tabletin söyleyecekleri</h4>
              {previewItems.map((o) => (
                <div className="announcement-step" key={o.id}>
                  <strong>
                    {new Intl.DateTimeFormat('tr-TR', {
                      timeZone: form.schedule.timezone,
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(o.scheduledAt))}
                  </strong>
                  <div>
                    <span>
                      {o.minutesBefore
                        ? `${durationLabel(o.minutesBefore)} önce${o.speechDay === 'dayAfterTomorrow' ? ' · iki gün önce' : o.speechDay === 'tomorrow' ? ' · önceki gün' : ''}`
                        : 'Tam saatinde'}
                    </span>
                    <p>{o.version.text || 'Saatinde okunacak metni yukarıya yaz.'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
        <div className="form-divider">
          <AudioLines size={16} />
          <span>HATIRLATICININ SESİ</span>
        </div>
        <div className="form-grid">
          <label>
            Ses
            <select
              value={form.voice}
              onChange={(e) => set('voice', e.target.value as ReminderInput['voice'])}
            >
              {voices.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            Konuşma tarzı
            <select
              value={form.style}
              onChange={(e) => set('style', e.target.value as ReminderInput['style'])}
            >
              <option value="warm">Sıcak ve samimi</option>
              <option value="calm">Sakin ve yumuşak</option>
              <option value="cheerful">Neşeli ve cesaretlendirici</option>
            </select>
          </label>
        </div>
        <div className="form-grid">
          <div>
            <span className="field-label">Renk</span>
            <div className="color-picker">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={c}
                  aria-label={c}
                  aria-pressed={form.color === c}
                  onClick={() => set('color', c)}
                >
                  {form.color === c && <Check size={17} />}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="field-label">Simge</span>
            <div className="icon-picker">
              {Object.entries(icons).map(([key, Icon]) => (
                <button
                  type="button"
                  key={key}
                  className={form.icon === key ? 'selected' : ''}
                  aria-label={key}
                  aria-pressed={form.icon === key}
                  onClick={() => set('icon', key as ReminderInput['icon'])}
                >
                  <Icon size={17} />
                </button>
              ))}
            </div>
          </div>
        </div>
        {!data.capabilities.speechConfigured && !isDemo() && (
          <div className="warning">
            <AlertCircle size={18} />
            <span>
              Ses üretimi için sunucunun Gemini bağlantısı tamamlanmalı. Hatırlatıcıyı şimdi
              kaydedebilirsiniz.
            </span>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          {onDelete && (
            <button
              type="button"
              className="icon-button danger"
              aria-label="Hatırlatıcıyı sil"
              onClick={onDelete}
            >
              <Trash2 size={19} />
            </button>
          )}
          <span />
          <button type="button" className="button secondary" onClick={onClose}>
            Vazgeç
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Kaydediliyor…' : 'Hatırlatıcıyı kaydet'}
            <Check size={17} />
          </button>
        </div>
      </form>
    </Modal>
  );
}
function SettingsForm({
  data,
  onSave,
  busy,
}: {
  data: Snapshot;
  onSave: (s: FamilySettings) => Promise<boolean>;
  busy: boolean;
}) {
  const [form, setForm] = useState(data.family);
  return (
    <form
      className="panel settings-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(form);
      }}
    >
      <div className="section-heading">
        <div>
          <h2>Ailenizin tercihleri</h2>
          <span>Bu ayarlar, bağlı tabletlerinize eşitlenir.</span>
        </div>
        <Settings size={22} />
      </div>
      <label>
        Aile adı
        <input
          required
          maxLength={60}
          value={form.familyName}
          onChange={(e) => setForm({ ...form, familyName: e.target.value })}
        />
      </label>
      <label>
        Varsayılan saat dilimi
        <select
          value={form.timezone}
          onChange={(e) => setForm({ ...form, timezone: e.target.value })}
        >
          {Array.from(
            new Set([
              form.timezone,
              'Europe/Istanbul',
              'Europe/Berlin',
              'Europe/London',
              'America/New_York',
            ]),
          ).map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <span className="field-hint">
          Yeni hatırlatıcılar için kullanılır. Mevcut rutinlerin saat dilimleri korunur.
        </span>
      </label>
      <div className="setting-toggle">
        <div>
          <strong>Sessiz saatler</strong>
          <p>Bu saatlerde rutinler ekranda görünür; ses çalmaz.</p>
        </div>
        <button
          type="button"
          className={`switch ${form.quietEnabled ? 'on' : ''}`}
          role="switch"
          aria-checked={form.quietEnabled}
          aria-label="Sessiz saatler"
          onClick={() => setForm({ ...form, quietEnabled: !form.quietEnabled })}
        >
          <span />
        </button>
      </div>
      <div className="form-grid">
        <label>
          Başlangıç
          <input
            type="time"
            required
            value={form.quietStart}
            onChange={(e) => setForm({ ...form, quietStart: e.target.value })}
          />
        </label>
        <label>
          Bitiş
          <input
            type="time"
            required
            value={form.quietEnd}
            onChange={(e) => setForm({ ...form, quietEnd: e.target.value })}
          />
        </label>
      </div>
      <div className="info-box">
        <Volume2 size={22} />
        <p>
          Metinler Gemini ile seslendirilir. İlk okuma için internet gerekir; tekrarlar tabletin
          önbelleğinden çalabilir.
        </p>
      </div>
      <div className="form-actions">
        <button className="button primary" disabled={busy}>
          Değişiklikleri kaydet <Check size={16} />
        </button>
      </div>
    </form>
  );
}
