import { test, expect, type Page } from '@playwright/test';
const password = 'a-long-browser-password-123!';
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
