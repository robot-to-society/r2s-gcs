import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('five navigation views; operations map and mission enabled, the rest disabled', async ({ page }) => {
  await login(page)
  const nav = page.locator('nav.seg button')
  await expect(nav).toHaveCount(5)
  const labels = ['運用マップ', '全機体映像', 'ミッション', 'AIチャット', 'メンテナンス・設定']
  for (const [i, label] of labels.entries()) await expect(nav.nth(i)).toHaveAttribute('aria-label', label)
  await expect(nav.nth(0)).toHaveAttribute('aria-current', 'page')
  for (const i of [1, 3, 4]) await expect(nav.nth(i)).toHaveAttribute('aria-disabled', 'true')
  await expect(nav.nth(2)).not.toHaveAttribute('aria-disabled')
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
