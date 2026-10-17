import { expect, test } from '@playwright/test'
import { login } from './helpers'

// Needs scripts/e2e.sh --with-sitl --with-sim (the detail panel needs a vehicle; the camera is the simulator).
test.skip(!process.env.RGCS_E2E_SITL || !process.env.RGCS_E2E_SIM, 'needs SITL and the MT11 simulator')

test('camera strip appears, zoom changes, record toggles, settings save', async ({ page }) => {
  await login(page)
  await expect(page.locator('.rg-mk')).toHaveCount(1, { timeout: 20_000 })
  await page.getByRole('option').first().click()
  await expect(page.locator('.detail')).toBeVisible()
  await expect(page.locator('.cam-strip')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('[data-testid=cam-status]')).toContainText('Follow')
  await expect(page.locator('.zoom .val')).toHaveText('1.0×')
  await page.getByRole('button', { name: 'ズームイン' }).click()
  await expect(page.locator('.zoom .val')).toHaveText('2.0×', { timeout: 5_000 })
  const rec = page.getByRole('button', { name: '録画' })
  await rec.click()
  await expect(rec).toHaveClass(/on/, { timeout: 5_000 })
  await expect(page.locator('.detail-rec')).toContainText('REC')
  await rec.click()
  await expect(rec).not.toHaveClass(/on/, { timeout: 5_000 })
  await page.getByRole('button', { name: 'IR' }).click()
  await expect(page.getByRole('button', { name: 'IR' })).toHaveClass(/on/, { timeout: 5_000 })
  await page.getByRole('button', { name: 'カメラ設定' }).click()
  await expect(page.locator('.sheet.settings')).toBeVisible()
  await page.getByRole('button', { name: '操作' }).click()
  await page.getByLabel('最大パン速度').fill('40')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.locator('[data-testid=pill]').nth(1)).toContainText('カメラ設定 成功', { timeout: 5_000 })
})
