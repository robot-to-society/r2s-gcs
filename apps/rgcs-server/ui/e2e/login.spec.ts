import { expect, test } from '@playwright/test'
import { DEV_USER, login } from './helpers'

test('wrong password shows the error line', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('ユーザー名').fill(DEV_USER.username)
  await page.getByLabel('パスワード').fill('wrong')
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page.getByRole('alert')).toHaveText('ユーザー名またはパスワードが違います')
})

test('admin/admin signs in, the session survives a reload, logout returns to login', async ({ page, request }) => {
  await login(page)
  await page.reload()
  await expect(page.locator('header .brand')).toHaveText('RGCS')
  await page.getByRole('button', { name: DEV_USER.username }).click()
  await page.getByRole('button', { name: 'ログアウト' }).click()
  await expect(page.getByRole('button', { name: 'ログイン' })).toBeVisible()
  const me = await request.get('/api/auth/me', { headers: { 'X-Requested-With': 'rgcs' } })
  expect(me.status()).toBe(401)
})
