// Destructive only to the disposable smoke account. Recreates this project's API/DB containers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const base = process.env.APP_ORIGIN ?? 'http://localhost:8080';
let cookie = '';
async function api(path, method = 'GET', body) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
  return response.status === 204 ? null : response.json();
}
const run = (args) =>
  execFileSync('docker', ['compose', ...args], { stdio: 'inherit', timeout: 120_000 });
async function ready() {
  for (let i = 0; i < 45; i++) {
    try {
      await api('/health/ready');
      return;
    } catch {
      await setTimeout(2000);
    }
  }
  throw new Error('API did not become ready');
}
const email = `smoke-${randomUUID()}@example.com`;
const { user } = await api('/auth/register', 'POST', { email, password: randomUUID() });
const { task } = await api('/tasks', 'POST', { title: 'Persistence smoke test' });
console.log('Created disposable account and task');
run(['up', '-d', '--no-build', '--no-deps', '--force-recreate', '--wait', 'api']);
await ready();
assert.equal((await api('/auth/me')).user.id, user.id);
assert.ok((await api('/tasks')).tasks.some((item) => item.id === task.id));
console.log('PASS: account, session and task survive API container recreation');
try {
  run(['stop', 'db']);
  assert.equal((await fetch(`${base}/api/health/ready`)).status, 503);
  assert.equal((await fetch(`${base}/api/health/live`)).status, 200);
  console.log('PASS: database outage fails readiness while liveness stays healthy');
} finally {
  run(['up', '-d', '--no-build', '--wait', 'db']);
}
run(['up', '-d', '--no-build', '--no-deps', '--force-recreate', '--wait', 'db']);
await ready();
assert.equal((await api('/auth/me')).user.id, user.id);
assert.ok((await api('/tasks')).tasks.some((item) => item.id === task.id));
console.log('PASS: account, session and task survive PostgreSQL container recreation');
await api(`/tasks/${task.id}`, 'DELETE');
await api('/auth/logout', 'POST');
const code = `import pg from 'pg';const p=new pg.Pool({connectionString:process.env.DATABASE_URL});await p.query('DELETE FROM users WHERE id=$1',[${JSON.stringify(user.id)}]);await p.end();`;
execFileSync(
  'docker',
  ['compose', 'exec', '-T', 'api', 'node', '--input-type=module', '-e', code],
  { stdio: 'inherit', timeout: 15_000 },
);
assert.equal((await fetch(`${base}/metrics`)).status, 404);
console.log('PASS: disposable data removed; public /metrics is blocked');
