import crypto from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import argon2 from 'argon2';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z, ZodError } from 'zod';
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';
import pino from 'pino';
import {
  credentialsSchema,
  loginSchema,
  createTaskSchema,
  updateTaskSchema,
} from '@todo/contracts';
import { users, tasks } from './schema.js';
import type { Config } from './config.js';
import type { Database } from './db.js';

declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function createApp(config: Config, database: Database) {
  const app = express();
  const { db, pool } = database;
  const logger = pino({ level: config.NODE_ENV === 'test' ? 'silent' : 'info' });
  pool.on('error', (error) => logger.error({ message: error.message }, 'PostgreSQL pool error'));
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'todo_' });
  const requests = new Counter({
    name: 'todo_http_requests_total',
    help: 'HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'todo_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route'],
    buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  new Gauge({
    name: 'todo_database_up',
    help: 'Database query succeeds',
    registers: [registry],
    async collect() {
      try {
        await pool.query('SELECT 1');
        this.set(1);
      } catch {
        this.set(0);
      }
    },
  });

  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.use(helmet());
  app.use((req, res, next) => {
    const requestId = crypto.randomUUID();
    res.setHeader('X-Request-ID', requestId);
    const start = performance.now();
    res.on('finish', () => {
      if (req.path === '/metrics' || req.path.startsWith('/api/health/')) return;
      const route = req.route?.path ?? 'unmatched';
      requests.inc({ method: req.method, route, status: res.statusCode });
      duration.observe({ method: req.method, route }, (performance.now() - start) / 1000);
      logger.info({ requestId, method: req.method, route, status: res.statusCode }, 'request');
    });
    next();
  });
  app.get('/api/health/live', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/health/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1 FROM users LIMIT 1');
      res.json({ status: 'ok', database: 'up' });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'down' });
    }
  });
  app.get('/metrics', async (_req, res) => {
    res.type(registry.contentType).send(await registry.metrics());
  });

  app.use((req, _res, next) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('origin') !== config.APP_ORIGIN
    ) {
      return next(new HttpError(403, 'INVALID_ORIGIN', 'Запрос с этого адреса запрещен'));
    }
    next();
  });
  app.use(express.json({ limit: '16kb' }));
  const analyticsLimit = rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Слишком много запросов' } },
  });
  app.post('/api/analytics/page-view', analyticsLimit, async (_req, res) => {
    await db.execute(sql`INSERT INTO page_view_hours (hour, views)
      VALUES (date_trunc('hour', now(), 'UTC'), 1)
      ON CONFLICT (hour) DO UPDATE SET views = page_view_hours.views + 1`);
    res.sendStatus(204);
  });

  const PgStore = connectPgSimple(session);
  const store = new PgStore({
    pool,
    tableName: 'sessions',
    createTableIfMissing: false,
    pruneSessionInterval: 900,
  });
  app.use(
    session({
      store,
      name: 'todo.sid',
      secret: config.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.COOKIE_SECURE,
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { code: 'RATE_LIMIT', message: 'Слишком много попыток. Попробуйте позже' } },
  });
  const establishSession = async (req: express.Request, userId: string) => {
    await new Promise<void>((resolve, reject) =>
      req.session.regenerate((error) => (error ? reject(error) : resolve())),
    );
    req.session.userId = userId;
    await new Promise<void>((resolve, reject) =>
      req.session.save((error) => (error ? reject(error) : resolve())),
    );
  };
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const input = credentialsSchema.parse(req.body);
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const [user] = await db
      .insert(users)
      .values({ email: input.email, passwordHash })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id, email: users.email });
    if (!user) throw new HttpError(409, 'EMAIL_EXISTS', 'Этот email уже зарегистрирован');
    await establishSession(req, user.id);
    res.status(201).json({ user });
  });
  // A valid dummy hash keeps missing-account and wrong-password verification comparable.
  const dummyHash = argon2.hash(crypto.randomBytes(32), { type: argon2.argon2id });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await db.query.users.findFirst({ where: eq(users.email, input.email) });
    const valid = await argon2.verify(user?.passwordHash ?? (await dummyHash), input.password);
    if (!user || !valid)
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Неверный email или пароль');
    await establishSession(req, user.id);
    res.json({ user: { id: user.id, email: user.email } });
  });
  app.post('/api/auth/logout', async (req, res) => {
    await new Promise<void>((resolve, reject) =>
      req.session.destroy((error) => (error ? reject(error) : resolve())),
    );
    res.clearCookie('todo.sid', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.COOKIE_SECURE,
    });
    res.sendStatus(204);
  });
  app.use((req, _res, next) => {
    if (!req.session.userId) return next(new HttpError(401, 'UNAUTHORIZED', 'Войдите в аккаунт'));
    next();
  });
  app.get('/api/auth/me', async (req, res) => {
    const user = await db.query.users.findFirst({
      columns: { id: true, email: true },
      where: eq(users.id, req.session.userId!),
    });
    if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Войдите в аккаунт');
    res.json({ user });
  });
  app.get('/api/tasks', async (req, res) => {
    const result = await db
      .select({
        id: tasks.id,
        title: tasks.title,
        completed: tasks.completed,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(eq(tasks.userId, req.session.userId!))
      .orderBy(desc(tasks.createdAt), desc(tasks.id));
    res.json({ tasks: result });
  });
  const publicTask = {
    id: tasks.id,
    title: tasks.title,
    completed: tasks.completed,
    createdAt: tasks.createdAt,
    updatedAt: tasks.updatedAt,
  };
  app.post('/api/tasks', async (req, res) => {
    const input = createTaskSchema.parse(req.body);
    const [task] = await db
      .insert(tasks)
      .values({ ...input, userId: req.session.userId! })
      .returning(publicTask);
    res.status(201).json({ task });
  });
  app.patch('/api/tasks/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = updateTaskSchema.parse(req.body);
    const [task] = await db
      .update(tasks)
      .set({ ...input, updatedAt: new Date() })
      .where(and(eq(tasks.id, id), eq(tasks.userId, req.session.userId!)))
      .returning(publicTask);
    if (!task) throw new HttpError(404, 'NOT_FOUND', 'Задача не найдена');
    res.json({ task });
  });
  app.delete('/api/tasks/:id', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const result = await db
      .delete(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, req.session.userId!)))
      .returning({ id: tasks.id });
    if (!result.length) throw new HttpError(404, 'NOT_FOUND', 'Задача не найдена');
    res.sendStatus(204);
  });
  app.use((_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Страница не найдена')));
  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) {
      res
        .status(400)
        .json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Проверьте введенные данные',
            fields: z.flattenError(error).fieldErrors,
          },
        });
    } else if (error instanceof HttpError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
    } else if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
      res
        .status(error.type === 'entity.too.large' ? 413 : 400)
        .json({ error: { code: 'INVALID_BODY', message: 'Некорректное тело запроса' } });
    } else {
      logger.error(
        { message: error instanceof Error ? error.message : 'Unknown error' },
        'request failed',
      );
      res
        .status(500)
        .json({ error: { code: 'INTERNAL_ERROR', message: 'Ошибка сервера. Попробуйте позже' } });
    }
  };
  app.use(onError);
  return {
    app,
    registry,
    close: () => {
      store.close();
      registry.clear();
    },
  };
}
