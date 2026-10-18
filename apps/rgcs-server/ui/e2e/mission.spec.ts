import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { login } from './helpers'

const FIXTURE_PATH = fileURLToPath(new URL('../../../../crates/rgcs-mission/tests/fixtures/demo20.waypoints', import.meta.url))
const FIXTURE = readFileSync(FIXTURE_PATH, 'utf8')

async function openMission(page: Page) {
  await login(page)
  await page.getByRole('button', { name: 'ミッション' }).click()
  await expect(page.getByTestId('mission-view')).toBeVisible()
}

test('a Mission Planner file imports with 20 rows and exports byte-identical', async ({ page }) => {
  await openMission(page)
  await page.getByTestId('mission-file').setInputFiles(FIXTURE_PATH)
  await expect(page.locator('.wrow')).toHaveCount(20)
  await expect(page.locator('.wrow .cmd-label').first()).toHaveText('離陸')
  await expect(page.locator('.wrow .cmd-label').last()).toHaveText('帰還 (RTL)')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'ファイルに保存' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('demo20.waypoints')
  const text = readFileSync((await file.path()) ?? '', 'utf8')
  expect(text).toBe(FIXTURE)
})

test('plan three points, edit, undo, save, write to the vehicle and see the progress row', async ({ page }) => {
  test.skip(!process.env.RGCS_E2E_SITL, 'needs SITL')
  await openMission(page)
  const canvas = page.locator('.mission-map canvas')
  await canvas.click({ position: { x: 400, y: 300 } })
  await canvas.click({ position: { x: 480, y: 300 } })
  await canvas.click({ position: { x: 560, y: 340 } })
  await expect(page.locator('.wrow .cmd-label')).toHaveText(['離陸', 'ウェイポイント', 'ウェイポイント'])
  await page.locator('.wrow').nth(1).click()
  await page.getByLabel('高度', { exact: true }).fill('60')
  await expect(page.getByTestId('mission-summary')).toContainText('60 m')
  await page.getByTestId('mission-view').focus()
  await page.keyboard.press('Meta+z')
  await expect(page.getByTestId('mission-summary')).toContainText('50 m')
  await page.getByLabel('ミッション名').fill('e2e')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.mission-dirty')).toHaveCount(0, { timeout: 5_000 })
  await page.getByRole('button', { name: '機体に書き込む' }).click()
  const pill = page.locator('[data-testid=pill]').nth(1)
  await expect(pill).toContainText('ミッション書込 成功', { timeout: 20_000 })
  await expect(pill).toHaveAttribute('title', /読込一致/)
  await page.getByRole('button', { name: '運用マップ' }).click()
  await expect(page.locator('.rg-mk')).toHaveCount(1, { timeout: 20_000 })
  await page.getByRole('option').first().click()
  await expect(page.getByTestId('mission-progress')).toContainText(/WP \d+ \/ 3|3 項目/, { timeout: 10_000 })
  await expect(page.locator('.wp-mk.small')).toHaveCount(3)
})
