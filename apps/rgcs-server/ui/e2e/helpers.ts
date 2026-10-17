import { expect, type Page } from '@playwright/test'

export const DEV_USER = { username: 'admin', password: 'admin' }

export async function login(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('ユーザー名').fill(DEV_USER.username)
  await page.getByLabel('パスワード').fill(DEV_USER.password)
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page.locator('header .brand')).toHaveText('RGCS')
}
