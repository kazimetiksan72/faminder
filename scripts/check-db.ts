import { db, closeDb } from '../apps/api/src/db.js';
try {
  await (await db()).command({ ping: 1 });
  console.log('MongoDB bağlantısı başarılı.');
} catch {
  console.error('MongoDB bağlantısı başarısız. URI ve Atlas ağ erişimini kontrol edin.');
  process.exitCode = 1;
} finally {
  await closeDb();
}
