// Runs backup.sh and restore.sh against a separate disposable Compose project.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const project = `todo-backup-smoke-${randomUUID().slice(0, 8)}`;
const env = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  WEB_PORT: '18080',
  APP_ORIGIN: 'http://localhost:18080',
};
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const run = (command, args) =>
  execFileSync(command, args, { env, stdio: 'inherit', timeout: 180_000 });
await mkdir(new URL('../test-results', import.meta.url), { recursive: true });
let cookie;
async function api(path, method = 'GET', body) {
  const response = await fetch(`${env.APP_ORIGIN}/api${path}`, {
    method,
    headers: {
      Origin: env.APP_ORIGIN,
      Connection: 'close',
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return response.status === 204 ? null : response.json();
}
try {
  run('docker', ['compose', 'up', '-d', '--no-build', '--wait', '--wait-timeout', '120']);
  await api('/auth/register', 'POST', {
    email: `backup-${randomUUID()}@example.com`,
    password: randomUUID(),
  });
  const { task } = await api('/tasks', 'POST', { title: 'Restored from backup' });
  run(bash, ['scripts/backup.sh', `test-results/${project}.dump`]);
  await api(`/tasks/${task.id}`, 'DELETE');
  assert.equal((await api('/tasks')).tasks.length, 0);
  run(bash, ['scripts/restore.sh', `test-results/${project}.dump`]);
  assert.equal((await api('/tasks')).tasks[0].id, task.id);
  console.log(
    'PASS: actual backup/restore scripts recover task and session in an isolated database',
  );
} finally {
  // Only the random, newly created smoke project's containers and volumes.
  run('docker', ['compose', 'down', '--volumes']);
}
