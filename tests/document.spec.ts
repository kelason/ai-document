import { test, expect } from '@playwright/test';

test.describe('Document Editor Tests', () => {
  test('should create a new blank document and type in it', async ({ page }) => {
    await page.goto('/');

    // Click Blank Document
    await page.getByText('Blank Document').click();

    // The app should redirect to /documents/[id]
    await expect(page).toHaveURL(/\/documents\/[a-zA-Z0-9_-]+/);

    // Document title should be "Untitled Document" by default
    const titleInput = page.getByPlaceholder('Untitled Document');
    await expect(titleInput).toBeVisible();

    // Type a new title
    await titleInput.fill('Playwright Test Doc');
    await expect(titleInput).toHaveValue('Playwright Test Doc');

    // Type into the editor content editable
    const editor = page.locator('div[contenteditable="true"]').first();
    await editor.click();
    await editor.type('Hello from automated test!');
    
    // Verify the text is inside
    await expect(editor).toContainText('Hello from automated test!');
  });
});
