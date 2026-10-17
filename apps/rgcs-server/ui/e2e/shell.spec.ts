import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('five navigation views, only the operations map enabled', async ({ page }) => {
  await login(page)
  const nav = page.locator('nav.seg button')
  await expect(nav).toHaveText(['運用マップ', '全機体映像', 'ミッション', 'AIチャット', 'メンテナンス・設定'])
  await expect(nav.nth(0)).toHaveAttribute('aria-current', 'page')
  for (const i of [1, 2, 3, 4]) await expect(nav.nth(i)).toHaveAttribute('aria-disabled', 'true')
})

test('user popover opens and closes; empty vehicle list hint without a link', async ({ page }) => {
  test.skip(!!process.env.RGCS_E2E_SITL, 'with SITL the list is not empty')
  await login(page)
  await page.getByRole('button', { name: 'admin' }).click()
  await expect(page.getByRole('dialog')).toContainText('操作履歴にはこの名前で記録されます')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('機体が接続されるとここに表示されます')).toBeVisible()
})
