import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
dotenv.config({
  path: [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')],
  quiet: true,
});
let client: MongoClient | undefined;
let connection: Promise<MongoClient> | undefined;
let indexes: Promise<void> | undefined;
export async function db() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI yapılandırılmamış.');
  if (!client)
    client = new MongoClient(process.env.MONGODB_URI, {
      maxPoolSize: 8,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 10000,
    });
  if (!connection)
    connection = client.connect().catch((e) => {
      connection = undefined;
      throw e;
    });
  return (await connection).db(process.env.MONGODB_DB || 'faminder');
}
export async function initialize() {
  if (!indexes)
    indexes = (async () => {
      const d = await db();
      await Promise.all([
        d.collection('users').createIndex({ email: 1 }, { unique: true }),
        d.collection('sessions').createIndex({ tokenHash: 1 }, { unique: true }),
        d.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        d.collection('pairings').createIndex({ code: 1 }, { unique: true }),
        d.collection('pairings').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        d.collection('devices').createIndex({ tokenHash: 1 }, { unique: true }),
        d.collection('reminders').createIndex({ familyId: 1, deleted: 1 }),
        d.collection('events').createIndex({ familyId: 1, deviceId: 1, id: 1 }, { unique: true }),
        d.collection('events').createIndex({ familyId: 1, at: -1 }),
        d.collection('limits').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        d.collection('limits').createIndex({ key: 1 }, { unique: true }),
      ]);
    })().catch((e) => {
      indexes = undefined;
      throw e;
    });
  return indexes;
}
export async function closeDb() {
  await client?.close();
  client = undefined;
  connection = undefined;
  indexes = undefined;
}
