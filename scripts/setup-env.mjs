import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const password = randomBytes(24).toString('hex');
let output = template.replaceAll('replace-with-random-hex', password);
output = output.replace(
  'SESSION_SECRET=replace-with-at-least-32-random-characters',
  `SESSION_SECRET=${randomBytes(32).toString('hex')}`,
);
output = output.replace(
  `GRAFANA_DB_PASSWORD=${password}`,
  `GRAFANA_DB_PASSWORD=${randomBytes(24).toString('hex')}`,
);
output = output.replace(
  `GRAFANA_ADMIN_PASSWORD=${password}`,
  `GRAFANA_ADMIN_PASSWORD=${randomBytes(24).toString('hex')}`,
);
await writeFile(new URL('../.env', import.meta.url), output, { flag: 'wx', mode: 0o600 });
console.log('.env created with random secrets. Existing files are never overwritten.');
