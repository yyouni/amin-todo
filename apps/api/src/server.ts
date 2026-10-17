import { createApp } from './app.js';
import { readConfig } from './config.js';
import { connectDb } from './db.js';

const config = readConfig();
const database = connectDb(config.DATABASE_URL);
const runtime = createApp(config, database);
const server = runtime.app.listen(config.PORT, '0.0.0.0', () =>
  console.info(`API listening on ${config.PORT}`),
);
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10_000).unref();
    server.close(() => {
      runtime.close();
      void database.pool.end().finally(() => {
        clearTimeout(timeout);
        process.exit(0);
      });
    });
  });
