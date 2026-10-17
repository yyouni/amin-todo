import { chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:8080';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const output = new URL('../docs/preview/', import.meta.url);
await mkdir(output, { recursive: true });
let userId;
try {
  await page.goto(baseURL);
  await page.getByLabel('Email', { exact: true }).waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL('login.png', output)),
    animations: 'disabled',
    fullPage: true,
  });
  const result = await context.request.post(`${baseURL}/api/auth/register`, {
    headers: { Origin: baseURL },
    data: { email: `preview-${randomUUID()}@example.com`, password: randomUUID() },
  });
  if (result.status() !== 201) throw new Error(`Registration failed: ${result.status()}`);
  userId = (await result.json()).user.id;
  for (const [index, title] of [
    'Составить план на неделю',
    'Разобрать заметки',
    'Прочитать новую главу',
    'Оставить время для прогулки',
  ].entries()) {
    const created = await context.request.post(`${baseURL}/api/tasks`, {
      headers: { Origin: baseURL },
      data: { title },
    });
    if (created.status() !== 201) throw new Error('Task creation failed');
    if (index === 0)
      await context.request.patch(`${baseURL}/api/tasks/${(await created.json()).task.id}`, {
        headers: { Origin: baseURL },
        data: { completed: true },
      });
  }
  await page.reload();
  await page.getByRole('heading', { name: 'Готово 1' }).waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL('desktop.png', output)),
    animations: 'disabled',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: fileURLToPath(new URL('mobile.png', output)),
    animations: 'disabled',
    fullPage: true,
  });
  console.log('Saved login, desktop and mobile previews to docs/preview');
} finally {
  await context.request
    .post(`${baseURL}/api/auth/logout`, { headers: { Origin: baseURL } })
    .catch(() => {});
  if (userId) {
    const code = `import pg from 'pg';const p=new pg.Pool({connectionString:process.env.DATABASE_URL});await p.query('DELETE FROM users WHERE id=$1',[${JSON.stringify(userId)}]);await p.end();`;
    execFileSync(
      'docker',
      ['compose', 'exec', '-T', 'api', 'node', '--input-type=module', '-e', code],
      { stdio: 'inherit' },
    );
  }
  await browser.close();
}
