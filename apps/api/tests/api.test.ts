import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import supertest from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import app from '../src/app.js';
import { db, closeDb } from '../src/db.js';
import { speechKey } from '../src/speech.js';
let mongo: MongoMemoryServer;
const alice = supertest.agent(app),
  bob = supertest.agent(app);
const header = { 'X-Faminder-Client': '1' };
let id = '',
  deviceToken = '',
  familyId = '';
const input = {
  title: 'Dişlerimizi fırçalayalım',
  text: 'Elif, dişlerimizi fırçalama zamanı.',
  voice: 'Kore',
  style: 'warm',
  schedule: { kind: 'daily', time: '20:30', timezone: 'Europe/Istanbul' },
};
const wav = Buffer.alloc(48044);
wav.write('RIFF');
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(24000, 24);
wav.writeUInt32LE(48000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(48000, 40);
const generated = () =>
  new Response(
    JSON.stringify({
      steps: [
        {
          type: 'model_output',
          content: [{ type: 'audio', data: wav.toString('base64'), mime_type: 'audio/wav' }],
        },
      ],
    }),
  );
const snapshot = async () => (await alice.get('/api/snapshot').expect(200)).body;
const speechBody = (r: any) => ({ revision: r.content.revision, audioKey: r.content.audioKey });
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri();
  process.env.MONGODB_DB = 'faminder_integration_test';
  process.env.GEMINI_API_KEY = 'test-only-key';
  process.env.NODE_ENV = 'test';
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => generated()),
  );
  await alice
    .post('/api/auth/register')
    .set(header)
    .send({
      email: 'alice@example.test',
      password: 'LongPassword123!',
      name: 'Alice',
      familyName: 'Alice Ailesi',
    })
    .expect(201);
  await bob
    .post('/api/auth/register')
    .set(header)
    .send({
      email: 'bob@example.test',
      password: 'LongPassword123!',
      name: 'Bob',
      familyName: 'Bob Ailesi',
    })
    .expect(201);
  familyId = (await snapshot()).family.id;
}, 120000);
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
  await mongo?.stop();
});
describe('family API with on-demand speech', () => {
  it('requires authentication and validates CSRF origin/header', async () => {
    await supertest(app).get('/api/snapshot').expect(401);
    await alice.post('/api/members').send({ name: 'Elif' }).expect(403);
    await alice
      .post('/api/members')
      .set(header)
      .set('Origin', 'https://evil.example')
      .send({ name: 'Elif' })
      .expect(403);
  });
  it('saves immediately as text without a Gemini call or audio storage', async () => {
    delete process.env.GEMINI_API_KEY;
    id = (await alice.post('/api/reminders').set(header).send(input).expect(201)).body.id;
    const r = (await snapshot()).reminders[0];
    expect(r.content.text).toBe(input.text);
    expect(r.content.audioKey).toMatch(/^[a-f0-9]{64}$/);
    expect(r).not.toHaveProperty('active');
    expect(r).not.toHaveProperty('audioStatus');
    expect(fetch).not.toHaveBeenCalled();
    await alice.post(`/api/reminders/${id}/speech`).set(header).send(speechBody(r)).expect(503);
    process.env.GEMINI_API_KEY = 'test-only-key';
  });
  it('generates a private WAV only when requested and stores no server audio', async () => {
    const r = (await snapshot()).reminders[0];
    await bob.post(`/api/reminders/${id}/speech`).set(header).send(speechBody(r)).expect(404);
    await alice
      .post(`/api/reminders/${id}/speech`)
      .set(header)
      .send(speechBody(r))
      .expect(200)
      .expect('Content-Type', /audio\/wav/)
      .expect('Cache-Control', 'no-store');
    expect(fetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    expect(payload.model).toBe('gemini-3.8-flash-lite-tts');
    expect(payload.input[0].content[0].text).toBe(input.text);
    const collections = (await (await db()).listCollections().toArray()).map((c) => c.name);
    expect(collections.filter((c) => c.startsWith('audio'))).toEqual([]);
    expect((await bob.get('/api/snapshot')).body.reminders).toHaveLength(0);
  });
  it('keeps the same local cache key for schedule edits but rejects stale revisions', async () => {
    vi.mocked(fetch).mockClear();
    const before = (await snapshot()).reminders[0];
    await alice
      .put(`/api/reminders/${id}`)
      .set(header)
      .send({ ...input, schedule: { ...input.schedule, time: '21:00' } })
      .expect(200);
    const after = (await snapshot()).reminders[0];
    expect(after.content.audioKey).toBe(before.content.audioKey);
    expect(after.content.revision).not.toBe(before.content.revision);
    await alice
      .post(`/api/reminders/${id}/speech`)
      .set(header)
      .send(speechBody(before))
      .expect(409);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('issues a new audio key for text edits and prevents client-supplied text injection', async () => {
    const before = (await snapshot()).reminders[0];
    await alice
      .put(`/api/reminders/${id}`)
      .set(header)
      .send({ ...input, text: 'Yeni hatırlatma metni.' })
      .expect(200);
    const after = (await snapshot()).reminders[0];
    expect(after.content.audioKey).not.toBe(before.content.audioKey);
    await alice
      .post(`/api/reminders/${id}/speech`)
      .set(header)
      .send({ ...speechBody(after), text: 'Bunu okumamalı' })
      .expect(200);
    const last = vi.mocked(fetch).mock.calls.at(-1)!;
    expect(JSON.parse(last[1]!.body as string).input[0].content[0].text).toBe(
      'Yeni hatırlatma metni.',
    );
  });
  it('surfaces provider quota and malformed-audio errors without altering the text', async () => {
    const r = (await snapshot()).reminders[0];
    vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 429 }));
    await alice.post(`/api/reminders/${id}/speech`).set(header).send(speechBody(r)).expect(429);
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ output_audio: { data: 'invalid' } })),
    );
    await alice.post(`/api/reminders/${id}/speech`).set(header).send(speechBody(r)).expect(502);
    expect((await snapshot()).reminders[0].content).toEqual(r.content);
  });
  it('does not return obsolete speech if the routine changes while Gemini responds', async () => {
    const r = (await snapshot()).reminders[0];
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await (await db())
        .collection('reminders')
        .updateOne(
          { id },
          { $set: { 'content.revision': 'bfcf0c50-6f86-4dbb-86f6-4fb567e6c01c' } },
        );
      return generated();
    });
    await alice.post(`/api/reminders/${id}/speech`).set(header).send(speechBody(r)).expect(409);
  });
  it('reads older desired/active records as text without running old jobs', async () => {
    const r = (await snapshot()).reminders[0];
    const { audioKey, ...version } = r.content;
    await (await db()).collection('reminders').updateOne(
      { id },
      {
        $set: {
          desired: { ...version, audioId: 'old-file' },
          active: null,
          audioStatus: 'error',
        },
        $unset: { content: '' },
      },
    );
    const converted = (await snapshot()).reminders[0];
    expect(converted.content.text).toBe(version.text);
    expect(converted.content.audioKey).toBe(audioKey);
    expect(converted).not.toHaveProperty('desired');
    expect(converted.content).not.toHaveProperty('audioId');
  });
  it('pairs a tablet with proof of possession and permits reading its family text', async () => {
    const start = (await supertest(app).post('/api/pairing/start').set(header).send({}).expect(200))
      .body;
    await alice
      .post('/api/devices/pair')
      .set(header)
      .send({ code: start.code, name: 'Test tableti' })
      .expect(200);
    deviceToken = (
      await supertest(app).post('/api/pairing/poll').set(header).send(start).expect(200)
    ).body.token;
    await bob
      .post('/api/devices/pair')
      .set(header)
      .send({ code: start.code, name: 'Başka tablet' })
      .expect(400);
    await supertest(app)
      .post('/api/pairing/poll')
      .set(header)
      .send({ code: start.code, secret: 'wrong-secret-long-enough' })
      .expect(410);
    await supertest(app)
      .post('/api/members')
      .set(header)
      .auth(deviceToken, { type: 'bearer' })
      .send({ name: 'No' })
      .expect(403);
    const r = (await snapshot()).reminders[0];
    await supertest(app)
      .post(`/api/reminders/${id}/speech`)
      .set(header)
      .auth(deviceToken, { type: 'bearer' })
      .send(speechBody(r))
      .expect(200);
    await alice
      .patch(`/api/reminders/${id}/enabled`)
      .set(header)
      .send({ enabled: false })
      .expect(200);
    await supertest(app)
      .post(`/api/reminders/${id}/speech`)
      .set(header)
      .auth(deviceToken, { type: 'bearer' })
      .send(speechBody(r))
      .expect(409);
  });
  it('acknowledges text delivery and deduplicates event retries', async () => {
    const r = (await snapshot()).reminders[0];
    await supertest(app)
      .post('/api/device/heartbeat')
      .set(header)
      .auth(deviceToken, { type: 'bearer' })
      .send({ installed: { [id]: r.content.revision } })
      .expect(200);
    const event = {
      id: 'event-one',
      reminderId: id,
      occurrenceId: `${id}:now`,
      title: r.content.title,
      kind: 'played',
      at: new Date().toISOString(),
    };
    for (let n = 0; n < 2; n++)
      await supertest(app)
        .post('/api/device/events')
        .set(header)
        .auth(deviceToken, { type: 'bearer' })
        .send([event])
        .expect(200);
    const state = await snapshot();
    expect(state.events).toHaveLength(1);
    expect(state.devices[0].installed[id]).toBe(r.content.revision);
  });
  it('isolates cache keys between families', () => {
    const v = { text: input.text, voice: 'Kore' as const, style: 'warm' as const };
    expect(speechKey(familyId, v)).not.toBe(speechKey('another-family', v));
  });
  it('revokes devices and removes deleted reminders', async () => {
    const deviceId = (await snapshot()).devices[0].id;
    await alice.delete(`/api/devices/${deviceId}`).set(header).expect(200);
    await supertest(app).get('/api/snapshot').auth(deviceToken, { type: 'bearer' }).expect(401);
    await alice.delete(`/api/reminders/${id}`).set(header).expect(200);
    expect((await snapshot()).reminders).toHaveLength(0);
  });
  it('validates the two-reminder limit on both create and update', async () => {
    await alice
      .post('/api/reminders')
      .set(header)
      .send({ ...input, advanceReminders: [60, 30, 15] })
      .expect(400);
    const created = (await alice.post('/api/reminders').set(header).send(input).expect(201)).body
      .id;
    await alice
      .put(`/api/reminders/${created}`)
      .set(header)
      .send({ ...input, advanceReminders: [30, 30] })
      .expect(400);
    await alice.delete(`/api/reminders/${created}`).set(header).expect(200);
  });
  it('serves only configured, family-owned advance speech and rejects removed or renamed variants', async () => {
    const member = (await alice.post('/api/members').set(header).send({ name: 'Ateş' }).expect(201))
      .body;
    const advanced = {
      ...input,
      title: 'satranç dersi',
      memberId: member.id,
      advanceReminders: [60, 30],
    };
    vi.mocked(fetch).mockClear();
    const created = (await alice.post('/api/reminders').set(header).send(advanced).expect(201)).body
      .id;
    const r = (await snapshot()).reminders.find((r: any) => r.id === created);
    expect(fetch).not.toHaveBeenCalled();
    const lead = r.content.advanceSpeech.find(
      (s: any) => s.minutesBefore === 60 && s.day === 'today',
    );
    const request = {
      revision: r.content.revision,
      audioKey: lead.audioKey,
      minutesBefore: 60,
      day: 'today',
    };
    expect(lead.text).toBe('Ateş, bugün satranç dersin var. Derse 1 saat kaldı.');
    expect(lead.audioKey).not.toBe(r.content.audioKey);
    await bob.post(`/api/reminders/${created}/speech`).set(header).send(request).expect(404);
    await alice
      .post(`/api/reminders/${created}/speech`)
      .set(header)
      .send({ ...request, minutesBefore: 15 })
      .expect(409);
    await alice
      .post(`/api/reminders/${created}/speech`)
      .set(header)
      .send({ ...request, day: 'tomorrow' })
      .expect(409);
    await alice
      .post(`/api/reminders/${created}/speech`)
      .set(header)
      .send({ ...request, text: 'Untrusted text' })
      .expect(200)
      .expect('X-Audio-Key', lead.audioKey);
    expect(
      JSON.parse(vi.mocked(fetch).mock.calls.at(-1)![1]!.body as string).input[0].content[0].text,
    ).toBe(lead.text);
    vi.mocked(fetch).mockImplementationOnce(async () => {
      await (await db())
        .collection('members')
        .updateOne({ id: member.id }, { $set: { name: 'Deniz' } });
      return generated();
    });
    await alice.post(`/api/reminders/${created}/speech`).set(header).send(request).expect(409);
    await alice
      .put(`/api/reminders/${created}`)
      .set(header)
      .send({ ...advanced, advanceReminders: [] })
      .expect(200);
    await alice.post(`/api/reminders/${created}/speech`).set(header).send(request).expect(409);
    const latest = (await snapshot()).reminders.find((r: any) => r.id === created);
    expect(latest.content.advanceSpeech).toEqual([]);
    await alice.delete(`/api/reminders/${created}`).set(header).expect(200);
  });
});
