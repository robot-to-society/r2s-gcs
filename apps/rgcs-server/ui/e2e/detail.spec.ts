import { expect, test } from '@playwright/test'
import { login } from './helpers'

// Needs scripts/e2e.sh --with-sitl (ArduCopter SITL on tcp:5760).
test.skip(!process.env.RGCS_E2E_SITL, 'needs SITL')

test('vehicle marker, detail panel and a confirmed ARM / DISARM', async ({ page }) => {
  await login(page)
  await expect(page.locator('.rg-mk')).toHaveCount(1, { timeout: 20_000 })
  await page.getByRole('option').first().click()
  await expect(page.locator('.detail')).toBeVisible()
  await page.getByRole('button', { name: '全コマンド' }).click()
  await page.getByRole('button', { name: 'アーム', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('アーム')
  await page.getByRole('button', { name: '実行' }).click()
  const pill = page.locator('[data-testid=pill]').nth(1)
  await expect(pill).toContainText(/アーム (成功|失敗)/, { timeout: 10_000 })
  const armed = (await pill.textContent())?.includes('成功')
  if (armed) {
    await expect(page.locator('.msg-text').first()).toBeVisible()
    await page.getByRole('button', { name: '全コマンド' }).click()
    await page.getByRole('button', { name: 'ディスアーム', exact: true }).click()
    await page.getByRole('button', { name: '実行' }).click()
    await expect(page.locator('[data-testid=pill]').nth(1)).toContainText('ディスアーム', { timeout: 10_000 })
  } else {
    // PreArm failures arrive as STATUSTEXT and must show in the panel.
    await expect(page.locator('.msg-text').first()).toContainText(/PreArm|Arm/i)
  }
})
