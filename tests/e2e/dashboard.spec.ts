import {test,expect,enterDemo} from '../helpers/browser';

test.describe('Dashboard Tests', () => {
  test('should load the dashboard and display templates', async ({ page }) => {
    await enterDemo(page);

    // Verify title and main heading
    await expect(page).toHaveTitle(/AI Docs/);
    await expect(page.getByText('Start a new document')).toBeVisible();

    // Verify templates are visible
    await expect(page.getByText('Blank Document')).toBeVisible();
    await expect(page.getByText('Meeting Notes',{exact:true})).toBeVisible();
    await expect(page.getByText('Project Proposal')).toBeVisible();
  });

  test('should allow switching the active user', async ({ page }) => {
    await enterDemo(page);

    await expect(page.getByLabel('Demo persona')).toHaveValue('alice');
    await page.getByLabel('Demo persona').selectOption('bob');
    await expect(page.getByLabel('Demo persona')).toHaveValue('bob');
    await expect(page.getByText('Start a new document')).toBeVisible();
  });
});
