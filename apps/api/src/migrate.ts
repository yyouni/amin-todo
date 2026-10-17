import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { connectDb } from './db.js';
import { provisionMonitor } from './provision-monitor.js';

export async function migrateDatabase(url: string) {
  const { pool, db } = connectDb(url);
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    if (process.env.GRAFANA_DB_PASSWORD)
      await provisionMonitor(pool, process.env.GRAFANA_DB_PASSWORD);
  } finally {
    await pool.end();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  await migrateDatabase(process.env.DATABASE_URL);
}
