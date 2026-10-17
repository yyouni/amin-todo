import { test, expect, type Page } from '@playwright/test';
const password = 'a-long-browser-password-123!';
async function register(page: Page) {
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  const email = `browser-${crypto.randomUUID()}@example.com`;
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Дела — по порядку.' })).toBeVisible();
  return email;
}
test('account, persistent tasks, editing, completion, deletion and isolation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const email = await register(page);
  await expect(page.getByText('Начните с одной задачи')).toBeVisible();
  await page.getByLabel('Новая задача').fill('Подготовить план на неделю');
  await page.getByLabel('Новая задача').press('Enter');
  await expect(page.getByText('Подготовить план на неделю', { exact: true })).toBeVisible();
  const checkbox = page.getByRole('checkbox', { name: 'Подготовить план на неделю' });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Подготовить план на неделю' })).toBeChecked();
  await page
    .getByRole('button', { name: 'Изменить задачу: Подготовить план на неделю', exact: true })
    .click();
  await page.getByLabel('Название задачи').fill('План готов');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('checkbox', { name: 'План готов' }).click();
  await expect(page.getByRole('checkbox', { name: 'План готов' })).not.toBeChecked();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Войти', exact: true })).toBeVisible();
  await register(page);
  await expect(page.getByText('Начните с одной задачи')).toBeVisible();
  const longTitle = 'А'.repeat(200);
  await page.getByLabel('Новая задача').fill(longTitle);
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(page.getByText(longTitle, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: `Удалить задачу: ${longTitle}`, exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByText('Начните с одной задачи')).toBeVisible();
  await expect(page.getByText('План готов', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'План готов' })).toBeVisible();
  await page.getByRole('button', { name: 'Удалить задачу: План готов', exact: true }).click();
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'План готов' })).toBeVisible();
  await page.getByRole('button', { name: 'Удалить задачу: План готов', exact: true }).click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByText('Начните с одной задачи')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(errors).toEqual([]);
});
test('validates inputs and counts exactly one visit per document load', async ({ page }) => {
  let visits = 0;
  page.on('request', (req) => {
    if (req.url().endsWith('/api/analytics/page-view') && req.method() === 'POST') visits++;
  });
  await page.goto('/');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await expect.poll(() => visits).toBe(1);
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill('invalid');
  await page.getByLabel('Пароль', { exact: true }).fill('short');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await expect(page.getByText('Введите корректный email')).toBeVisible();
  await expect(page.getByText('Минимум 12 символов')).toBeVisible();
  expect(visits).toBe(1);
  await page.reload();
  await expect.poll(() => visits).toBe(2);
});
test('analytics outage does not block sign-in; server errors can be retried', async ({ page }) => {
  await page.route('**/api/analytics/page-view', (route) => route.abort());
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'UNAVAILABLE', message: 'Временная ошибка' } }),
    }),
  );
  await page.goto('/');
  await expect(page.getByText('Временная ошибка')).toBeVisible();
  await page.unroute('**/api/auth/me');
  await page.getByRole('button', { name: 'Попробовать снова', exact: true }).click();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  await register(page);
});
