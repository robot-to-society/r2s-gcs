import { expect, type Page } from '@playwright/test'

export const DEV_USER = { username: 'admin', password: 'admin' }

export async function login(page: Page): Promise<void> {
  await page.goto('/')
  await page.getByLabel('ユーザー名').fill(DEV_USER.username)
  await page.getByLabel('パスワード').fill(DEV_USER.password)
  await page.getByRole('button', { name: 'ログイン' }).click()
  await expect(page.locator('header .brand')).toHaveText('RGCS')
}

const sheet = (page: Page) => page.locator('.logsheet')
const rows = (page: Page, text: RegExp) => sheet(page).locator('.logrow').filter({ has: page.locator('.txt', { hasText: text }) })

async function setLogOpen(page: Page, open: boolean): Promise<void> {
  if ((await sheet(page).isVisible()) !== open) await page.locator('button.logpill').click()
  await expect(sheet(page)).toBeVisible({ visible: open })
}

/** How many rows of メッセージ履歴 have a text matching `text` (the log persists across runs). */
export async function countLogRows(page: Page, text: RegExp): Promise<number> {
  await setLogOpen(page, true)
  const n = await rows(page, text).count()
  await setLogOpen(page, false)
  return n
}

/** Waits for a new matching row (more than `before`) and returns the newest one's text. */
export async function waitForLogRow(page: Page, text: RegExp, before: number, timeout = 10_000): Promise<string> {
  await setLogOpen(page, true)
  await expect.poll(() => rows(page, text).count(), { timeout }).toBeGreaterThan(before)
  const newest = (await rows(page, text).first().locator('.txt').textContent()) ?? ''
  await setLogOpen(page, false)
  return newest
}
