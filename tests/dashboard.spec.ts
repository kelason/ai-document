import { test, expect } from '@playwright/test';

test.describe('Dashboard Tests', () => {
  test('should load the dashboard and display templates', async ({ page }) => {
    await page.goto('/');

    // Verify title and main heading
    await expect(page).toHaveTitle(/Antigravity Docs/);
    await expect(page.getByText('Start a new document')).toBeVisible();

    // Verify templates are visible
    await expect(page.getByText('Blank Document')).toBeVisible();
    await expect(page.getByText('Meeting Notes')).toBeVisible();
    await expect(page.getByText('Project Proposal')).toBeVisible();
  });

  test('should allow switching the active user', async ({ page }) => {
    await page.goto('/');

    // By default Alice should be selected
    const activeUserBtn = page.getByRole('button', { name: /Alice/ });
    await expect(activeUserBtn).toBeVisible();

    // Click to open dropdown
    await activeUserBtn.click();

    // Select Bob
    await page.getByRole('button', { name: /Bob/ }).click();

    // Verify Bob is now the active user
    const newActiveBtn = page.getByRole('button', { name: /Bob/ });
    await expect(newActiveBtn).toBeVisible();
  });
});
