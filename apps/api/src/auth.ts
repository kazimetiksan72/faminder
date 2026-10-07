import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.js';
const derive = promisify(scrypt);
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${((await derive(password, salt, 64)) as Buffer).toString('hex')}`;
}
export async function checkPassword(password: string, stored: string) {
  const [salt, key] = stored.split(':');
  const value = (await derive(password, salt, 64)) as Buffer;
  return key.length === 128 && timingSafeEqual(value, Buffer.from(key, 'hex'));
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export type Principal = { familyId: string; id: string; kind: 'admin' | 'device' };
declare global {
  namespace Express {
    interface Request {
      principal: Principal;
    }
  }
}
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const d = await db();
  const bearer = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  if (bearer) {
    const device = await d
      .collection('devices')
      .findOne({ tokenHash: hash(bearer), revoked: false });
    if (!device) throw new HttpError(401, 'Tablet bağlantısı kaldırılmış. Yeniden eşleştirin.');
    req.principal = { kind: 'device', id: device.id, familyId: device.familyId };
  } else {
    const value = req.cookies?.faminder_session;
    if (!value) throw new HttpError(401, 'Oturum açmanız gerekiyor.');
    const session = await d
      .collection('sessions')
      .findOne({ tokenHash: hash(value), expiresAt: { $gt: new Date() } });
    if (!session) throw new HttpError(401, 'Oturumunuz sona erdi.');
    req.principal = { kind: 'admin', id: session.userId, familyId: session.familyId };
  }
  next();
}
export function admin(req: Request, _res: Response, next: NextFunction) {
  if (req.principal.kind !== 'admin')
    throw new HttpError(403, 'Bu işlem yönetici erişimi gerektirir.');
  next();
}
export function deviceOnly(req: Request, _res: Response, next: NextFunction) {
  if (req.principal.kind !== 'device') throw new HttpError(403, 'Tablet erişimi gerekiyor.');
  next();
}
export async function rateLimit(key: string, limit = 20, minutes = 15) {
  const now = Date.now();
  const window = Math.floor(now / (minutes * 60000));
  const result = await (await db())
    .collection('limits')
    .findOneAndUpdate(
      { key: hash(`${key}:${window}`) },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * minutes * 60000) } },
      { upsert: true, returnDocument: 'after' },
    );
  if (result!.count > limit)
    throw new HttpError(429, 'Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.');
}
export async function createSession(res: Response, user: { id: string; familyId: string }) {
  const value = token();
  const expiresAt = new Date(Date.now() + 30 * 86400000);
  await (await db())
    .collection('sessions')
    .insertOne({ tokenHash: hash(value), userId: user.id, familyId: user.familyId, expiresAt });
  res.cookie('faminder_session', value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 86400000,
  });
}
