import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { randomUUID, randomInt } from 'node:crypto';
import { MongoServerError } from 'mongodb';
import { z, ZodError } from 'zod';
import {
  reminderInputSchema,
  memberSchema,
  settingsSchema,
  defaultSettings,
  type Version,
} from '@faminder/shared';
import { db, initialize } from './db.js';
import {
  authenticate,
  admin,
  deviceOnly,
  HttpError,
  token,
  hash,
  passwordHash,
  checkPassword,
  createSession,
  rateLimit,
} from './auth.js';
import { model, speechKey, synthesize, textReminder } from './speech.js';
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '128kb' }));
app.use(cookieParser());
const origins = () =>
  new Set((process.env.ADMIN_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()));
app.use((req, _res, next) => {
  const origin = req.headers.origin;
  if (origin && !origins().has(origin))
    throw new HttpError(403, 'Bu adresten erişime izin verilmiyor.');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers['x-faminder-client'] !== '1')
    throw new HttpError(403, 'İstek doğrulanamadı.');
  next();
});
app.use(
  cors({ origin: (origin, cb) => cb(null, !origin || origins().has(origin)), credentials: true }),
);
app.get('/api/health', async (_req, res) => {
  await (await db()).command({ ping: 1 });
  res.json({ ok: true, speechConfigured: !!process.env.GEMINI_API_KEY });
});
app.use('/api', async (_req, _res, next) => {
  await initialize();
  next();
});
const credentials = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((v) => v.toLowerCase().trim()),
  password: z.string().min(10, 'Parola en az 10 karakter olmalı.').max(128),
});
app.post('/api/auth/register', async (req, res) => {
  await rateLimit(`register:${req.ip}`, 5, 60);
  const input = credentials
    .extend({
      name: z.string().trim().min(1).max(60),
      familyName: z.string().trim().min(1).max(60),
    })
    .parse(req.body);
  const d = await db();
  const id = randomUUID();
  const familyId = randomUUID();
  const user = {
    id,
    familyId,
    name: input.name,
    email: input.email,
    passwordHash: await passwordHash(input.password),
  };
  await d.collection('users').insertOne(user);
  try {
    await d
      .collection('families')
      .insertOne({ id: familyId, ...defaultSettings, familyName: input.familyName });
  } catch (e) {
    await d.collection('users').deleteOne({ id });
    throw e;
  }
  await createSession(res, user);
  res.status(201).json({ name: user.name });
});
app.post('/api/auth/login', async (req, res) => {
  await rateLimit(`login:${req.ip}`);
  const input = credentials.parse(req.body);
  await rateLimit(`email:${input.email}`);
  const user = await (await db()).collection('users').findOne({ email: input.email });
  if (!user || !(await checkPassword(input.password, user.passwordHash)))
    throw new HttpError(401, 'E-posta veya parola hatalı.');
  await createSession(res, user as unknown as { id: string; familyId: string });
  res.json({ name: user.name });
});
app.post('/api/auth/logout', async (req, res) => {
  if (req.cookies?.faminder_session)
    await (await db())
      .collection('sessions')
      .deleteOne({ tokenHash: hash(req.cookies.faminder_session) });
  res.clearCookie('faminder_session', { path: '/' });
  res.json({ ok: true });
});
app.post('/api/pairing/start', async (req, res) => {
  await rateLimit(`pair:${req.ip}`, 10);
  const d = await db();
  const secret = token();
  for (let i = 0; i < 5; i++) {
    const code = String(randomInt(100000, 1000000));
    try {
      await d.collection('pairings').insertOne({
        code,
        secretHash: hash(secret),
        expiresAt: new Date(Date.now() + 600000),
        status: 'waiting',
      });
      res.json({ code, secret, expiresAt: new Date(Date.now() + 600000).toISOString() });
      return;
    } catch (e) {
      if (!(e instanceof MongoServerError && e.code === 11000)) throw e;
    }
  }
  throw new HttpError(503, 'Eşleştirme kodu oluşturulamadı.');
});
app.post('/api/pairing/poll', async (req, res) => {
  const input = z
    .object({ code: z.string().regex(/^\d{6}$/), secret: z.string().min(20).max(100) })
    .parse(req.body);
  const d = await db();
  const pairing = await d
    .collection('pairings')
    .findOne({ code: input.code, secretHash: hash(input.secret), expiresAt: { $gt: new Date() } });
  if (!pairing) throw new HttpError(410, 'Eşleştirme kodunun süresi doldu.');
  if (pairing.status !== 'paired') {
    res.json({ status: 'waiting' });
    return;
  }
  // Derived credential makes a lost poll response safely retryable without storing plaintext tokens.
  const deviceToken = hash(`device:${hash(input.secret)}:${pairing.deviceId}`);
  res.json({ status: 'paired', token: deviceToken, deviceId: pairing.deviceId });
});
app.use('/api', authenticate);
app.get('/api/snapshot', async (req, res) => {
  const d = await db();
  const familyId = req.principal.familyId;
  const [family, members, reminders, devices, events] = await Promise.all([
    d.collection('families').findOne({ id: familyId }, { projection: { _id: 0 } }),
    d
      .collection('members')
      .find({ familyId }, { projection: { _id: 0, familyId: 0 } })
      .toArray(),
    d
      .collection('reminders')
      .find(
        { familyId, deleted: { $ne: true } },
        { projection: { _id: 0, audioKey: 0, deleted: 0 } },
      )
      .sort({ 'content.schedule.time': 1 })
      .toArray(),
    d
      .collection('devices')
      .find({ familyId, revoked: false }, { projection: { _id: 0, tokenHash: 0, familyId: 0 } })
      .toArray(),
    d
      .collection('events')
      .find({ familyId }, { projection: { _id: 0, familyId: 0 } })
      .sort({ at: -1 })
      .limit(100)
      .toArray(),
  ]);
  res.set('Cache-Control', 'no-store').json({
    family,
    members,
    reminders: reminders.map(textReminder),
    devices,
    events,
    serverTime: new Date().toISOString(),
    capabilities: { speechConfigured: !!process.env.GEMINI_API_KEY, model: model() },
  });
});
app.post('/api/members', admin, async (req, res) => {
  const member = {
    id: randomUUID(),
    familyId: req.principal.familyId,
    ...memberSchema.parse(req.body),
  };
  await (await db()).collection('members').insertOne(member);
  res.status(201).json(member);
});
app.delete('/api/members/:id', admin, async (req, res) => {
  const d = await db();
  const familyId = req.principal.familyId;
  if (
    await d.collection('reminders').countDocuments({
      familyId,
      deleted: { $ne: true },
      $or: [
        { 'content.memberId': req.params.id },
        { content: { $exists: false }, 'desired.memberId': req.params.id },
      ],
    })
  )
    throw new HttpError(409, 'Önce bu kişiye ait rutinleri başka bir kişiye atayın.');
  await d.collection('members').deleteOne({ id: req.params.id, familyId });
  res.json({ ok: true });
});
app.put('/api/settings', admin, async (req, res) => {
  const settings = settingsSchema.parse(req.body);
  await (await db())
    .collection('families')
    .updateOne({ id: req.principal.familyId }, { $set: settings });
  res.json({ ok: true });
});
async function validateMember(familyId: string, memberId: string | null) {
  if (memberId && !(await (await db()).collection('members').findOne({ id: memberId, familyId })))
    throw new HttpError(400, 'Aile üyesi bulunamadı.');
}
app.post('/api/reminders', admin, async (req, res) => {
  const input = reminderInputSchema.parse(req.body);
  const familyId = req.principal.familyId;
  await validateMember(familyId, input.memberId);
  await rateLimit(`create:${familyId}`, 60, 60);
  const now = new Date().toISOString();
  const content: Version = {
    ...input,
    revision: randomUUID(),
    audioKey: speechKey(familyId, input),
    createdAt: now,
  };
  const r = {
    id: randomUUID(),
    familyId,
    content,
    enabled: input.enabled,
    updatedAt: now,
    deleted: false,
  };
  await (await db()).collection('reminders').insertOne(r);
  res.status(201).json({ id: r.id });
});
app.put('/api/reminders/:id', admin, async (req, res) => {
  const input = reminderInputSchema.parse(req.body);
  const familyId = req.principal.familyId;
  await validateMember(familyId, input.memberId);
  const d = await db();
  const r = await d
    .collection('reminders')
    .findOne({ id: req.params.id, familyId, deleted: false });
  if (!r) throw new HttpError(404, 'Hatırlatıcı bulunamadı.');
  await rateLimit(`edit:${familyId}`, 100, 60);
  const content: Version = {
    ...input,
    revision: randomUUID(),
    audioKey: speechKey(familyId, input),
    createdAt: new Date().toISOString(),
  };
  await d.collection('reminders').updateOne(
    { id: r.id, familyId },
    {
      $set: {
        content,
        enabled: input.enabled,
        updatedAt: new Date().toISOString(),
      },
      $unset: { desired: '', active: '', audioKey: '', audioStatus: '', audioError: '' },
    },
  );
  res.json({ ok: true });
});
app.patch('/api/reminders/:id/enabled', admin, async (req, res) => {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  const result = await (await db())
    .collection('reminders')
    .updateOne(
      { id: req.params.id, familyId: req.principal.familyId, deleted: false },
      { $set: { enabled, updatedAt: new Date().toISOString() } },
    );
  if (!result.matchedCount) throw new HttpError(404, 'Hatırlatıcı bulunamadı.');
  res.json({ ok: true });
});
app.delete('/api/reminders/:id', admin, async (req, res) => {
  await (await db())
    .collection('reminders')
    .updateOne(
      { id: req.params.id, familyId: req.principal.familyId },
      { $set: { deleted: true, enabled: false, updatedAt: new Date().toISOString() } },
    );
  res.json({ ok: true });
});
app.post('/api/devices/pair', admin, async (req, res) => {
  const { code, name } = z
    .object({ code: z.string().regex(/^\d{6}$/), name: z.string().trim().min(1).max(50) })
    .parse(req.body);
  await rateLimit(`confirm:${req.principal.familyId}`, 10);
  const d = await db();
  const deviceId = randomUUID();
  const pair = await d
    .collection('pairings')
    .findOneAndUpdate(
      { code, status: 'waiting', expiresAt: { $gt: new Date() } },
      { $set: { status: 'provisioning', deviceId, familyId: req.principal.familyId } },
      { returnDocument: 'after' },
    );
  if (!pair) throw new HttpError(400, 'Kod geçersiz, süresi dolmuş veya kullanılmış.');
  // The tablet proves possession of its high-entropy pairing secret before receiving a credential.
  const deviceToken = hash(`device:${pair.secretHash}:${deviceId}`);
  try {
    await d.collection('devices').insertOne({
      id: deviceId,
      familyId: req.principal.familyId,
      name,
      tokenHash: hash(deviceToken),
      revoked: false,
      lastSeenAt: null,
      lastSyncAt: null,
      installed: {},
    });
    await d
      .collection('pairings')
      .updateOne({ code, deviceId, status: 'provisioning' }, { $set: { status: 'paired' } });
  } catch (e) {
    await d.collection('devices').deleteOne({ id: deviceId });
    await d
      .collection('pairings')
      .updateOne(
        { code, deviceId },
        { $set: { status: 'waiting' }, $unset: { deviceId: '', familyId: '' } },
      );
    throw e;
  }
  res.json({ ok: true });
});
app.delete('/api/devices/:id', admin, async (req, res) => {
  await (await db())
    .collection('devices')
    .updateOne(
      { id: req.params.id, familyId: req.principal.familyId },
      { $set: { revoked: true } },
    );
  res.json({ ok: true });
});
app.post('/api/device/heartbeat', deviceOnly, async (req, res) => {
  const { installed } = z
    .object({
      installed: z
        .record(z.string().max(100), z.string().max(100))
        .refine((v) => Object.keys(v).length <= 500),
    })
    .parse(req.body);
  await (await db()).collection('devices').updateOne(
    { id: req.principal.id, revoked: false },
    {
      $set: {
        installed,
        lastSeenAt: new Date().toISOString(),
        lastSyncAt: new Date().toISOString(),
      },
    },
  );
  res.json({ ok: true });
});
app.post('/api/device/events', deviceOnly, async (req, res) => {
  const rows = z
    .array(
      z.object({
        id: z.string().max(150),
        reminderId: z.string().uuid(),
        occurrenceId: z.string().max(150),
        kind: z.enum([
          'played',
          'completed',
          'snoozed',
          'missed',
          'failed',
          'quiet',
          'interrupted',
        ]),
        at: z.string().datetime(),
        title: z.string().max(80),
      }),
    )
    .max(100)
    .parse(req.body);
  const d = await db();
  const familyId = req.principal.familyId;
  const valid = await d
    .collection('reminders')
    .find({ id: { $in: rows.map((r) => r.reminderId) }, familyId })
    .project({ id: 1 })
    .toArray();
  const ids = new Set(valid.map((r) => r.id));
  for (const row of rows) {
    if (!ids.has(row.reminderId)) throw new HttpError(403, 'Hatırlatıcı bu aileye ait değil.');
  }
  if (rows.length)
    await d.collection('events').bulkWrite(
      rows.map((row) => ({
        updateOne: {
          filter: { familyId, deviceId: req.principal.id, id: row.id },
          update: { $setOnInsert: { ...row, familyId, deviceId: req.principal.id } },
          upsert: true,
        },
      })),
    );
  res.json({ accepted: rows.map((r) => r.id) });
});
app.post('/api/reminders/:id/speech', async (req, res) => {
  const { revision, audioKey } = z
    .object({ revision: z.string().uuid(), audioKey: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(req.body);
  const d = await db();
  const query = { id: req.params.id, familyId: req.principal.familyId, deleted: { $ne: true } };
  const row = await d.collection('reminders').findOne(query);
  if (!row) throw new HttpError(404, 'Hatırlatıcı bulunamadı.');
  const reminder = textReminder(row);
  if (reminder.content.revision !== revision || reminder.content.audioKey !== audioKey)
    throw new HttpError(409, 'Hatırlatıcı değişti. Programı eşitleyip tekrar deneyin.');
  if (req.principal.kind === 'device' && !reminder.enabled)
    throw new HttpError(409, 'Hatırlatıcı duraklatılmış.');
  await rateLimit(`speech:${req.principal.familyId}`, 120, 60);
  const controller = new AbortController();
  const disconnect = () => {
    if (!res.writableEnded) controller.abort();
  };
  res.on('close', disconnect);
  try {
    const wav = await synthesize(reminder.content, controller.signal);
    // Do not return obsolete text after a slow provider response.
    const latest = await d.collection('reminders').findOne(query);
    if (
      !latest ||
      textReminder(latest).content.revision !== revision ||
      (req.principal.kind === 'device' && !latest.enabled)
    )
      throw new HttpError(409, 'Hatırlatıcı değişti. Programı eşitleyip tekrar deneyin.');
    if (
      req.principal.kind === 'device' &&
      !(await d.collection('devices').findOne({ id: req.principal.id, revoked: false }))
    )
      throw new HttpError(401, 'Tablet bağlantısı kaldırılmış.');
    if (!controller.signal.aborted)
      res
        .set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Audio-Key': audioKey })
        .send(wav);
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
      throw new HttpError(504, 'Ses üretimi zaman aşımına uğradı. Tekrar deneyin.');
    throw error;
  } finally {
    res.off('close', disconnect);
  }
});
app.use((_req, _res, next) => next(new HttpError(404, 'Adres bulunamadı.')));
app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({ error: error.issues[0]?.message || 'Alanları kontrol edin.' });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof MongoServerError && error.code === 11000) {
      res.status(409).json({ error: 'Bu kayıt zaten mevcut.' });
      return;
    }
    console.error('Request failed:', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: 'İşlem tamamlanamadı. Sunucu yapılandırmasını kontrol edin.' });
  },
);
export default app;
