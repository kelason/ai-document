import {test,expect,enterGuest} from '../helpers/browser';

test('legacy demo link opens the dashboard', async ({ page }) => {
  await page.goto('/documents/90al206vf');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('button',{name:'Continue as guest'})).toBeVisible();
});

test('missing document offers a way back without showing an editor', async ({ page }) => {
  await enterGuest(page);
  await page.goto('/documents/11111111-1111-4111-8111-111111111111');
  await expect(page.getByRole('heading', { name: 'Document not found' })).toBeVisible();
  await expect(page.getByPlaceholder('Untitled Document')).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to my documents' }).click();
  await expect(page).toHaveURL('/');
});

test('server failure can be retried without being labeled a missing document', async ({ page }) => {
  await page.route('**/api/documents/retry-document', route => route.fulfill({
    status: 503, json: { error: 'Service unavailable' },
  }));
  await enterGuest(page);
  await page.goto('/documents/retry-document');
  await expect(page.getByRole('heading', { name: 'Could not load document' })).toBeVisible();
  await expect(page.getByPlaceholder('Untitled Document')).toHaveCount(0);
  await page.route('**/api/documents/retry-document', route => route.fulfill({
    json: { id: 'retry-document', title: 'Recovered document', content: '<p>Recovered content</p>',
      owner: 'Guest', permissions:{role:'owner',allowedOperations:['read','edit','presence']}, history: [], shares: [], attachments: [],
      createdAt: '2026-10-27T00:00:00Z', updatedAt: '2026-10-27T00:00:00Z' },
  }));
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByPlaceholder('Untitled Document')).toHaveValue('Recovered document');
  await expect(page.locator('[contenteditable="true"]')).toContainText('Recovered content');
});
