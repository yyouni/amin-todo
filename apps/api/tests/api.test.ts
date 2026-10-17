import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { connectDb } from '../src/db.js';
import { readConfig } from '../src/config.js';
import { migrateDatabase } from '../src/migrate.js';

try {
  process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const url = new URL(
  process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://todo:todo@127.0.0.1:5432/todo_test',
);
if (!url.pathname.endsWith('_test')) url.pathname += '_test';
const config = readConfig({
  NODE_ENV: 'test',
  DATABASE_URL: url.href,
  SESSION_SECRET: 'test-session-secret-at-least-32-characters',
  APP_ORIGIN: 'http://localhost:5173',
});
const database = connectDb(config.DATABASE_URL);
let runtime: ReturnType<typeof createApp>;
const prefix = `test-${randomUUID()}`;
const password = 'a-long-test-password-123!';
const origin = { Origin: config.APP_ORIGIN };
const email = (suffix: string) => `${prefix}-${suffix}@example.com`;

beforeAll(async () => {
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Pool({ connectionString: adminUrl.href });
  try {
    const dbName = decodeURIComponent(url.pathname.slice(1));
    if (!dbName.endsWith('_test')) throw new Error('Tests require a dedicated _test database');
    const result = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!result.rowCount) await admin.query(`CREATE DATABASE ${pg.escapeIdentifier(dbName)}`);
  } finally {
    await admin.end();
  }
  await migrateDatabase(config.DATABASE_URL);
  await migrateDatabase(config.DATABASE_URL); // migration replay must be safe
  runtime = createApp(config, database);
}, 30_000);
afterAll(async () => {
  runtime?.close();
  await database.pool.query(
    "DELETE FROM sessions WHERE sess->>'userId' IN (SELECT id::text FROM users WHERE email LIKE $1)",
    [`${prefix}%`],
  );
  await database.pool.query('DELETE FROM users WHERE email LIKE $1', [`${prefix}%`]);
  await database.pool.end();
});

describe('authentication and task ownership (real PostgreSQL)', () => {
  it('registers, normalizes email, hashes password and persists a session', async () => {
    const agent = request.agent(runtime.app);
    const response = await agent
      .post('/api/auth/register')
      .set(origin)
      .send({ email: email('A'), password })
      .expect(201);
    expect(response.body.user.email).toBe(email('a'));
    expect(response.body.user.passwordHash).toBeUndefined();
    expect(response.headers['set-cookie']![0]).toContain('HttpOnly');
    const result = await database.pool.query('SELECT password_hash FROM users WHERE email=$1', [
      email('a'),
    ]);
    expect(result.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    await agent.get('/api/auth/me').expect(200);
    await agent
      .post('/api/auth/register')
      .set(origin)
      .send({ email: email('a'), password })
      .expect(409);
  });
  it('rejects weak passwords, malformed bodies and missing Origin', async () => {
    await request(runtime.app)
      .post('/api/auth/register')
      .set(origin)
      .send({ email: 'invalid', password: 'short' })
      .expect(400);
    await request(runtime.app)
      .post('/api/auth/register')
      .send({ email: email('bad'), password })
      .expect(403);
    await request(runtime.app)
      .post('/api/auth/login')
      .set('Origin', 'https://other.example')
      .send({})
      .expect(403);
    await request(runtime.app)
      .post('/api/auth/login')
      .set(origin)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    await request(runtime.app)
      .post('/api/auth/login')
      .set(origin)
      .send({ email: email('x'), password: 'x'.repeat(20000) })
      .expect(413);
  });
  it('uses the same error for missing accounts and wrong passwords; logout revokes access', async () => {
    const agent = request.agent(runtime.app);
    const wrong = await agent
      .post('/api/auth/login')
      .set(origin)
      .send({ email: email('a'), password: 'wrong' })
      .expect(401);
    const missing = await agent
      .post('/api/auth/login')
      .set(origin)
      .send({ email: email('missing'), password: 'wrong' })
      .expect(401);
    expect(wrong.body).toEqual(missing.body);
    await agent
      .post('/api/auth/login')
      .set(origin)
      .send({ email: email('a'), password })
      .expect(200);
    await agent.post('/api/auth/logout').set(origin).expect(204);
    await agent.get('/api/tasks').expect(401);
  });
  it('creates, edits, completes, reopens and deletes tasks, and isolates accounts', async () => {
    const owner = request.agent(runtime.app);
    const other = request.agent(runtime.app);
    await owner
      .post('/api/auth/register')
      .set(origin)
      .send({ email: email('owner'), password })
      .expect(201);
    await other
      .post('/api/auth/register')
      .set(origin)
      .send({ email: email('other'), password })
      .expect(201);
    const created = await owner
      .post('/api/tasks')
      .set(origin)
      .send({ title: '  Первая задача  ' })
      .expect(201);
    const id = created.body.task.id;
    expect(created.body.task.title).toBe('Первая задача');
    expect(created.body.task.userId).toBeUndefined();
    expect((await other.get('/api/tasks').expect(200)).body.tasks).toEqual([]);
    await other.patch(`/api/tasks/${id}`).set(origin).send({ completed: true }).expect(404);
    await other.delete(`/api/tasks/${id}`).set(origin).expect(404);
    await owner
      .patch(`/api/tasks/${id}`)
      .set(origin)
      .send({ title: 'Измененная', completed: true })
      .expect(200);
    expect((await owner.get('/api/tasks')).body.tasks[0]).toMatchObject({
      title: 'Измененная',
      completed: true,
    });
    await owner.patch(`/api/tasks/${id}`).set(origin).send({ completed: false }).expect(200);
    await owner.post('/api/tasks').set(origin).send({ title: '' }).expect(400);
    await owner
      .post('/api/tasks')
      .set(origin)
      .send({ title: 'x'.repeat(201) })
      .expect(400);
    await owner.patch(`/api/tasks/${id}`).set(origin).send({ userId: randomUUID() }).expect(400);
    await owner.patch('/api/tasks/invalid').set(origin).send({ completed: true }).expect(400);
    await owner.delete(`/api/tasks/${id}`).set(origin).expect(204);
    expect((await owner.get('/api/tasks')).body.tasks).toEqual([]);
  });
  it('keeps data and sessions after rebuilding the app instance', async () => {
    const agent = request.agent(runtime.app);
    const registered = await agent
      .post('/api/auth/register')
      .set(origin)
      .send({ email: email('restart'), password })
      .expect(201);
    await agent.post('/api/tasks').set(origin).send({ title: 'Пережить перезапуск' }).expect(201);
    const cookie = registered.headers['set-cookie']![0]!.split(';')[0]!;
    runtime.close();
    runtime = createApp(config, database);
    await request(runtime.app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    const tasks = await request(runtime.app).get('/api/tasks').set('Cookie', cookie).expect(200);
    expect(tasks.body.tasks[0].title).toBe('Пережить перезапуск');
    await database.pool.query(
      "UPDATE sessions SET expire = now() - interval '1 day' WHERE sess->>'userId' = $1",
      [registered.body.user.id],
    );
    await request(runtime.app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });
  it('records concurrent page views atomically and does not count health probes', async () => {
    const previous = await database.pool.query(
      'SELECT coalesce(sum(views), 0)::int AS n FROM page_view_hours',
    );
    await Promise.all(
      Array.from({ length: 12 }, () =>
        request(runtime.app).post('/api/analytics/page-view').set(origin).expect(204),
      ),
    );
    await request(runtime.app).get('/api/health/live').expect(200);
    await request(runtime.app).get('/api/health/ready').expect(200);
    const current = await database.pool.query(
      'SELECT coalesce(sum(views), 0)::int AS n FROM page_view_hours',
    );
    expect(current.rows[0].n - previous.rows[0].n).toBe(12);
    const metrics = await request(runtime.app).get('/metrics').expect(200);
    expect(metrics.text).toContain('todo_database_up 1');
    expect(metrics.text).not.toContain(email('a'));
    expect(metrics.text).not.toContain('route="/api/health');
  });
  it('keeps previous-hour history separate from the current UTC hour across app restarts', async () => {
    const history = await database.pool.query(
      "INSERT INTO page_view_hours(hour, views) VALUES (date_trunc('hour', now(), 'UTC') - interval '1 hour', 5) ON CONFLICT (hour) DO UPDATE SET views = page_view_hours.views + 5 RETURNING hour, views",
    );
    runtime.close();
    runtime = createApp(config, database);
    await request(runtime.app).post('/api/analytics/page-view').set(origin).expect(204);
    const previous = await database.pool.query('SELECT views FROM page_view_hours WHERE hour=$1', [
      history.rows[0].hour,
    ]);
    expect(previous.rows[0].views).toBe(history.rows[0].views);
    const current = await database.pool.query(
      "SELECT views FROM page_view_hours WHERE hour = date_trunc('hour', now(), 'UTC')",
    );
    expect(Number(current.rows[0].views)).toBeGreaterThan(0);
  });
  it('shows readiness failure without killing liveness when PostgreSQL is unavailable', async () => {
    const offline = connectDb('postgres://todo:invalid@127.0.0.1:1/no_database');
    const instance = createApp(config, offline);
    try {
      await request(instance.app).get('/api/health/ready').expect(503);
      await request(instance.app).get('/api/health/live').expect(200);
      expect((await request(instance.app).get('/metrics')).text).toContain('todo_database_up 0');
    } finally {
      instance.close();
      await offline.pool.end();
    }
  });
  it('gives the monitoring role access only to aggregates', async () => {
    const { provisionMonitor } = await import('../src/provision-monitor.js');
    const metricsPassword = process.env.GRAFANA_DB_PASSWORD ?? 'metrics-test-password';
    await provisionMonitor(database.pool, metricsPassword);
    const metricsUrl = new URL(url);
    metricsUrl.username = 'todo_metrics';
    metricsUrl.password = metricsPassword;
    const reader = new pg.Pool({ connectionString: metricsUrl.href });
    try {
      await reader.query('SELECT * FROM page_view_hours LIMIT 1');
      await expect(reader.query('SELECT * FROM users')).rejects.toMatchObject({ code: '42501' });
      await expect(reader.query('DELETE FROM page_view_hours')).rejects.toBeDefined();
    } finally {
      await reader.end();
    }
  });
});
