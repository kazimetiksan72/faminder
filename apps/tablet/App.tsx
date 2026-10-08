import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  nextOccurrence,
  isQuiet,
  durationLabel,
  type Snapshot,
  type Occurrence,
} from '@faminder/shared';
import * as storage from './src/storage';
import {
  api,
  apiBase,
  ApiError,
  Scheduler,
  stopAudio,
  synchronize,
  readReminder,
  disconnectDevice,
} from './src/engine';
const colorMap = {
  sage: '#dfead8',
  peach: '#f3e0d1',
  lavender: '#e9e2f4',
  sky: '#dfebf3',
  sun: '#f2e8c9',
};
const iconMap = { sun: '☀', book: '▤', brush: '✧', moon: '☾', meal: '◉', heart: '♡' };
const labels = {
  played: 'Seslendirildi',
  completed: 'Tamamlandı',
  snoozed: '5 dakika ertelendi',
  missed: 'Kaçırıldı',
  failed: 'Ses oynatılamadı',
  quiet: 'Sessiz saat',
  interrupted: 'Yarıda kesildi',
};
export default function App() {
  return (
    <SafeAreaProvider>
      <Wall />
    </SafeAreaProvider>
  );
}
function Wall() {
  useKeepAwake();
  const [token, setToken] = useState<string | null>(null),
    [ready, setReady] = useState(false),
    [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [now, setNow] = useState(Date.now());
  const [pair, setPair] = useState<{ code: string; secret: string; expiresAt: string } | null>(
      null,
    ),
    [message, setMessage] = useState(''),
    [online, setOnline] = useState(false),
    [lastSync, setLastSync] = useState<string | null>(null);
  const [current, setCurrent] = useState<Occurrence | null>(null),
    [recent, setRecent] = useState<Awaited<ReturnType<typeof storage.recent>>>([]),
    [night, setNight] = useState(false),
    [busy, setBusy] = useState(false);
  const resetting = useRef(false);
  const mounted = useRef(true),
    syncBusy = useRef(false),
    engine = useRef<Scheduler | null>(null);
  const updateRecent = () =>
    void storage.recent().then((v) => {
      if (mounted.current) setRecent(v);
    });
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        setToken(await storage.credentials.get());
        setSnapshot(await storage.get('snapshot'));
        setLastSync(await storage.get('lastSync'));
        updateRecent();
      } catch {
        setMessage('Yerel veriler okunamadı. Uygulamayı yeniden açın.');
      } finally {
        setReady(true);
      }
    })();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  async function newCode() {
    setBusy(true);
    setMessage('');
    try {
      setPair(await api('/pairing/start', undefined, {}));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (ready && !token && !pair) void newCode();
  }, [ready, token]);
  useEffect(() => {
    if (token || !pair) return;
    let pending = false;
    let canceled = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        const result = await api<{ status: string; token?: string }>('/pairing/poll', undefined, {
          code: pair.code,
          secret: pair.secret,
        });
        if (result.token && !canceled) {
          await storage.credentials.set(result.token);
          setToken(result.token);
          setPair(null);
          setMessage('');
        }
      } catch (e) {
        if (!canceled) setMessage((e as Error).message);
      } finally {
        pending = false;
      }
    };
    const timer = setInterval(() => void poll(), 4000);
    void poll();
    return () => {
      canceled = true;
      clearInterval(timer);
    };
  }, [pair, token]);
  async function sync(value: string) {
    if (resetting.current || syncBusy.current || AppState.currentState !== 'active') return;
    syncBusy.current = true;
    try {
      const result = await synchronize(value);
      if (mounted.current && !resetting.current) {
        setSnapshot(result.snapshot);
        setOnline(true);
        setLastSync(new Date().toISOString());
        setMessage(
          Math.abs(result.clockSkewMs) > 60000
            ? 'Tablet saati farklı görünüyor. Cihaz ayarlarında otomatik tarih ve saati açın.'
            : '',
        );
      }
    } catch (e) {
      if (mounted.current && !resetting.current) {
        setOnline(false);
        setMessage('Bağlantı yok. Daha önce seslendirilmiş metinler önbellekten okunabilir.');
        const local = await storage.get<Snapshot>('snapshot');
        if (local) setSnapshot(local);
        if (e instanceof ApiError && e.status === 401) {
          await engine.current?.stop();
          await disconnectDevice();
          setToken(null);
          setSnapshot(null);
          setCurrent(null);
          setRecent([]);
          setLastSync(null);
          setMessage('Tablet bağlantısı kaldırılmış. Yeniden eşleştirin.');
        }
      }
    } finally {
      syncBusy.current = false;
    }
  }
  useEffect(() => {
    if (!token) return;
    const scheduler = new Scheduler(setCurrent, updateRecent, setMessage, token);
    engine.current = scheduler;
    void scheduler.start();
    void sync(token);
    const timer = setInterval(() => void sync(token), 30000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync(token);
      else stopAudio();
    });
    return () => {
      clearInterval(timer);
      listener.remove();
      scheduler.stop();
      engine.current = null;
    };
  }, [token]);
  async function act(o: Occurrence, kind: 'complete' | 'snooze') {
    setBusy(true);
    try {
      if (kind === 'complete') await storage.record(o, 'completed');
      else await storage.snooze(o);
      setCurrent(null);
      updateRecent();
    } catch {
      setMessage('İşlem kaydedilemedi. Tekrar deneyin.');
    } finally {
      setBusy(false);
    }
  }
  if (!ready)
    return (
      <View style={s.center}>
        <ActivityIndicator color="#537c4a" />
        <Text style={s.hint}>Evinizin ritmi hazırlanıyor…</Text>
      </View>
    );
  if (!token)
    return (
      <SafeAreaView style={s.pairScreen}>
        <StatusBar hidden />
        <View style={s.pairBrand}>
          <Text style={s.brand}>♧ faminder.</Text>
          <Text style={s.kicker}>EVİNİZİN KÜÇÜK HATIRLATICISI</Text>
        </View>
        <View style={s.pairContent}>
          <View style={s.pairInstructions}>
            <Text style={s.pairHeading}>Bu eve bir ses{`\n`}ekleyelim.</Text>
            <Text style={s.pairText}>
              1. Web yönetim paneline giriş yapın.{`\n`}2. Tabletler → Tablet bağla seçeneğini açın.
              {`\n`}3. Ekrandaki kodu girin.
            </Text>
            <Text style={s.hint}>
              Tableti prize takın ve medya sesini açın.{`\n`}Uygulama bu ekranda açık kalmalıdır.
            </Text>
          </View>
          <View style={s.codeCard}>
            <Text style={s.kicker}>EŞLEŞTİRME KODUNUZ</Text>
            {busy ? (
              <ActivityIndicator color="#527e47" />
            ) : (
              <Text style={s.code}>{pair?.code ?? '— — —'}</Text>
            )}
            <Text style={s.hint}>
              {pair
                ? Date.parse(pair.expiresAt) > now
                  ? 'Kod 10 dakika geçerlidir.'
                  : 'Kodun süresi doldu. Yeni kod alın.'
                : 'Bağlantı bekleniyor.'}
            </Text>
            <TouchableOpacity style={s.lightButton} onPress={() => void newCode()} disabled={busy}>
              <Text style={s.buttonLabel}>Yeni kod al</Text>
            </TouchableOpacity>
          </View>
        </View>
        {message ? <Text style={s.error}>{message}</Text> : null}
        {!apiBase() && (
          <Text style={s.error}>Kurulum: EXPO_PUBLIC_API_URL ortam değişkenini tanımlayın.</Text>
        )}
      </SafeAreaView>
    );
  if (!snapshot)
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator color="#537c4a" />
        <Text style={s.hint}>Ailenizin programı indiriliyor…</Text>
        {message ? <Text style={s.error}>{message}</Text> : null}
        <TouchableOpacity onPress={() => void sync(token)} style={s.lightButton}>
          <Text style={s.buttonLabel}>Tekrar dene</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  const time = new Intl.DateTimeFormat('tr-TR', {
    timeZone: snapshot.family.timezone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
  const date = new Intl.DateTimeFormat('tr-TR', {
    timeZone: snapshot.family.timezone,
    day: 'numeric',
    month: 'long',
    weekday: 'long',
  }).format(now);
  const upcoming = snapshot.reminders
    .filter((r) => r.enabled)
    .map((r) => ({ r, o: nextOccurrence(r, now) }))
    .filter((x) => x.o)
    .sort((a, b) => a.o!.scheduledAt.localeCompare(b.o!.scheduledAt));
  const next = upcoming[0];
  const clockTime = (iso: string) =>
    new Intl.DateTimeFormat('tr-TR', {
      timeZone: snapshot.family.timezone,
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  const displayed = current ?? next?.o;
  const quiet = isQuiet(now, snapshot.family);
  const active = recent.find((r) => r.occurrence.id === current?.id);
  const actionable = !!current && !!active && active.status === 'played';
  return (
    <SafeAreaView style={[s.wall, night && s.dim]}>
      <StatusBar hidden />
      <View style={s.header}>
        <Text style={s.brand}>♧ faminder.</Text>
        <View style={s.headerRight}>
          <Text style={s.connection}>
            {online ? '● Bağlı' : '○ Çevrimdışı'}
            {quiet ? '  ·  Sessiz saatler' : ''}
          </Text>
          <TouchableOpacity
            onPress={() => setNight(!night)}
            accessibilityLabel="Ekran parlaklığını azalt"
          >
            <Text style={s.night}>{night ? '☀' : '☾'}</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={s.wallMain}>
        <View style={s.clockColumn}>
          <Text style={s.kicker}>{snapshot.family.familyName.toLocaleUpperCase('tr')}</Text>
          <Text style={s.clock}>{time}</Text>
          <Text style={s.date}>{date}</Text>
          <View style={s.family}>
            <Text style={s.familyText}>Birlikte, her gün.</Text>
            <View style={s.avatars}>
              {snapshot.members.map((m) => (
                <View key={m.id} style={[s.avatar, { backgroundColor: colorMap[m.color] }]}>
                  <Text style={s.avatarText}>{m.name[0]}</Text>
                </View>
              ))}
            </View>
          </View>
          <View style={s.statusNote}>
            <Text style={s.smallText}>
              {message || 'Küçük rutinler, güzel alışkanlıklara dönüşür.'}
            </Text>
            <Text style={s.syncText}>
              {lastSync
                ? `Son eşitleme: ${new Date(lastSync).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}`
                : 'İlk eşitleme bekleniyor'}
            </Text>
          </View>
        </View>
        <View style={s.contentColumn}>
          <View
            style={[
              s.currentCard,
              { backgroundColor: colorMap[(current?.version ?? next?.r.content)?.color ?? 'sage'] },
            ]}
          >
            <View style={s.cardTop}>
              <Text style={s.kicker}>
                {displayed?.minutesBefore
                  ? `ÖN HATIRLATMA · ${durationLabel(displayed.minutesBefore).toLocaleUpperCase('tr')} ÖNCE`
                  : current
                    ? 'BİR KÜÇÜK HATIRLATMA'
                    : 'SIRADAKİ KÜÇÜK ADIM'}
              </Text>
              <Text style={s.cardIcon}>
                {iconMap[(current?.version ?? next?.r.content)?.icon ?? 'heart']}
              </Text>
            </View>
            <Text style={s.currentTitle}>
              {current?.version.title ?? next?.r.content?.title ?? 'Bugün için her şey tamam.'}
            </Text>
            <Text style={s.currentText}>
              {current?.version.text ??
                next?.o?.version.text ??
                'Ailenizle geçireceğiniz güzel anların tadını çıkarın.'}
            </Text>
            {current ? (
              <View style={s.actions}>
                {actionable ? (
                  <>
                    <TouchableOpacity
                      disabled={busy}
                      style={s.primaryButton}
                      onPress={() => void act(current, 'complete')}
                    >
                      <Text style={s.primaryLabel}>
                        ✓ {current.minutesBefore ? 'Anladım' : 'Tamamlandı'}
                      </Text>
                    </TouchableOpacity>
                    {!current.minutesBefore && (
                      <TouchableOpacity
                        disabled={busy}
                        style={s.lightButton}
                        onPress={() => void act(current, 'snooze')}
                      >
                        <Text style={s.buttonLabel}>5 dakika sonra</Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <Text style={s.hint}>
                    {active ? labels[active.status] : 'Ses hazırlanıyor ve okunuyor…'}
                  </Text>
                )}
                <TouchableOpacity
                  onPress={() => {
                    stopAudio();
                    setCurrent(null);
                  }}
                >
                  <Text style={s.dismiss}>Kapat</Text>
                </TouchableOpacity>
              </View>
            ) : next ? (
              <Text style={s.nextTime}>{clockTime(next.o!.scheduledAt)}</Text>
            ) : null}
          </View>
          <View style={s.listHeader}>
            <Text style={s.listTitle}>Günün devamı</Text>
            <Text style={s.smallText}>{upcoming.length} yaklaşan rutin</Text>
          </View>
          <ScrollView style={s.upcoming} contentContainerStyle={{ gap: 10 }}>
            {upcoming.slice(0, 8).map(({ r, o }) => (
              <View style={s.upcomingRow} key={r.id}>
                <Text style={s.rowTime}>{clockTime(o!.scheduledAt)}</Text>
                <View style={[s.rowIcon, { backgroundColor: colorMap[r.content!.color] }]}>
                  <Text style={s.rowIconText}>{iconMap[r.content!.icon]}</Text>
                </View>
                <View style={s.rowText}>
                  <Text style={s.rowTitle}>{r.content!.title}</Text>
                  <Text style={s.smallText}>
                    {o!.minutesBefore ? `${durationLabel(o!.minutesBefore)} önce · ` : ''}
                    {new Intl.DateTimeFormat('tr-TR', {
                      timeZone: snapshot.family.timezone,
                      weekday: 'long',
                    }).format(new Date(o!.scheduledAt))}{' '}
                    ·{' '}
                    {snapshot.members.find((m) => m.id === r.content!.memberId)?.name ?? 'Tüm aile'}
                  </Text>
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
      <View style={s.footer}>
        <Text style={s.footerText}>Hatırlamak bize, birlikte olmak size.</Text>
        <View style={s.footerActions}>
          <TouchableOpacity
            disabled={busy}
            onPress={async () => {
              const occurrence = upcoming[0]?.o;
              if (!occurrence) {
                setMessage('Ses denemesi için önce bir hatırlatıcı ekleyin.');
                return;
              }
              if (current) {
                setMessage('Ses denemesini mevcut duyuru bittikten sonra yapın.');
                return;
              }
              setBusy(true);
              try {
                await readReminder(occurrence, token);
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Text style={s.footerLink}>Ses denemesi</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onLongPress={() =>
              Alert.alert('Tableti ayır', 'Bu tabletteki aile verileri silinecek.', [
                { text: 'Vazgeç', style: 'cancel' },
                {
                  text: 'Ayır',
                  style: 'destructive',
                  onPress: () =>
                    void (async () => {
                      resetting.current = true;
                      setBusy(true);
                      try {
                        await engine.current?.stop();
                        await disconnectDevice();
                        setToken(null);
                        setSnapshot(null);
                        setCurrent(null);
                        setRecent([]);
                        setLastSync(null);
                      } catch {
                        setMessage('Tablet ayrılamadı. Tekrar deneyin.');
                      } finally {
                        resetting.current = false;
                        setBusy(false);
                      }
                    })(),
                },
              ])
            }
            delayLongPress={2000}
            onPress={() => setMessage('Tableti ayırmak için bu düğmeye 2 saniye basılı tutun.')}
          >
            <Text style={s.footerLink}>Cihaz</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f6f7f0',
    gap: 20,
  },
  wall: { flex: 1, backgroundColor: '#f7f8f1', paddingHorizontal: 36, paddingTop: 18 },
  dim: { backgroundColor: '#dce2d2' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 20,
  },
  brand: { fontSize: 27, fontWeight: '800', color: '#315d40', letterSpacing: -1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 25 },
  connection: { fontSize: 12, color: '#8b9c7a' },
  night: { fontSize: 27, color: '#7f9470', padding: 5 },
  wallMain: { flex: 1, flexDirection: 'row', gap: 36 },
  clockColumn: { flex: 0.9, justifyContent: 'center', paddingRight: 10 },
  kicker: { fontSize: 10, letterSpacing: 2, color: '#7b916b', fontWeight: '600' },
  clock: { fontSize: 100, fontWeight: '200', letterSpacing: -6, color: '#39583b', marginTop: 16 },
  date: { fontSize: 18, color: '#93a080', marginTop: 5 },
  family: { marginTop: 45 },
  familyText: { fontSize: 16, color: '#7a9069', marginBottom: 16 },
  avatars: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  avatar: {
    height: 39,
    width: 39,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#738365', fontWeight: '600', fontSize: 14 },
  statusNote: { marginTop: 30, maxWidth: 300 },
  smallText: { fontSize: 11, color: '#99a68b', lineHeight: 19 },
  syncText: { fontSize: 9, color: '#b1bba5', marginTop: 8 },
  contentColumn: { flex: 1.4 },
  currentCard: { padding: 25, borderRadius: 20, minHeight: 220 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardIcon: { fontSize: 28, color: '#91a878' },
  currentTitle: {
    fontSize: 26,
    color: '#4b6642',
    fontWeight: '600',
    marginTop: 12,
    letterSpacing: -0.6,
  },
  currentText: { fontSize: 16, lineHeight: 26, color: '#81916d', marginTop: 12 },
  nextTime: { fontSize: 33, fontWeight: '300', color: '#5f7b51', marginTop: 15 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20, flexWrap: 'wrap' },
  primaryButton: {
    paddingHorizontal: 18,
    paddingVertical: 13,
    backgroundColor: '#436c42',
    borderRadius: 10,
  },
  primaryLabel: { color: '#fff', fontSize: 13, fontWeight: '600' },
  lightButton: {
    paddingHorizontal: 17,
    paddingVertical: 12,
    backgroundColor: '#ffffff99',
    borderWidth: 1,
    borderColor: '#dbe5cf',
    borderRadius: 10,
    marginTop: 0,
  },
  buttonLabel: { color: '#7a9165', fontSize: 13, fontWeight: '500' },
  dismiss: { color: '#8d9e7b', fontSize: 12, padding: 10 },
  hint: { color: '#96a384', fontSize: 12, lineHeight: 22, marginTop: 12 },
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 20,
  },
  listTitle: { color: '#788c66', fontSize: 16, fontWeight: '600' },
  upcoming: { flex: 1 },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#fff',
    padding: 13,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#edf0e5',
  },
  rowTime: { fontSize: 16, color: '#7b8d6b', fontWeight: '500', width: 51 },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconText: { fontSize: 23, color: '#8e9d7b' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 13, fontWeight: '600', color: '#728264', marginBottom: 3 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 18,
  },
  footerText: { fontSize: 10, color: '#a5b097' },
  footerActions: { flexDirection: 'row', gap: 25 },
  footerLink: { fontSize: 11, color: '#91a17f', padding: 8 },
  pairScreen: { flex: 1, backgroundColor: '#f0f4e8', padding: 45 },
  pairBrand: { gap: 15 },
  pairContent: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 50 },
  pairInstructions: { flex: 1 },
  pairHeading: {
    fontSize: 42,
    fontWeight: '600',
    color: '#547448',
    lineHeight: 53,
    letterSpacing: -1,
  },
  pairText: { fontSize: 15, lineHeight: 30, color: '#8a9e78', marginVertical: 20 },
  codeCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 22,
    padding: 30,
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#e4eadc',
  },
  code: {
    fontSize: 48,
    letterSpacing: 8,
    color: '#5c824b',
    fontWeight: '500',
    paddingVertical: 17,
  },
  error: { fontSize: 12, color: '#ac7960', marginTop: 10, lineHeight: 21 },
});
