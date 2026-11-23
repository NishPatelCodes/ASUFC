import { test, expect } from '@playwright/test';

// Fictional records only. Runs against the disposable stack used by finance.spec.ts.
test('refund, bank balance check, shared names and staff accounts', async ({ page }) => {
  const run = Date.now().toString(36);
  const grant = 'Browser refund grant ' + run, shop = 'Browser fictional delivery ' + run;
  await page.goto('/');
  await page.getByLabel('Username').fill(process.env.STAFF_USER!);
  await page.getByLabel('Password', { exact: true }).fill(process.env.STAFF_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Signed in as')).toContainText(process.env.STAFF_USER!);

  const headers = { 'X-ASUFC-Request': '1' };
  const created = await page.request.post('/api/funding', {
    headers,
    data: {
      name: grant,
      academic_year: '2026-2027',
      kind: 'cash',
      expected_cents: 50000,
      received_cents: 50000,
      eligible_programs: ['ASUFCE&W'],
      auto_budget: true,
    },
  });
  expect(created.status()).toBe(201);
  await page.reload();

  await page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await page.getByLabel('Purchase date').fill('2026-10-27');
  await page.getByLabel('Supplier', { exact: true }).fill(shop);
  await page.getByLabel('Purchase type', { exact: true }).fill('Event food');
  await page.getByLabel('Purchase total (CAD)').fill('72.58');
  const option = page.getByLabel('Program / funding').locator('option').filter({ hasText: grant });
  await page.getByLabel('Program / funding').selectOption((await option.getAttribute('value')) || '');
  await page.getByLabel('Amount (CAD)').fill('72.58');
  await page.getByRole('button', { name: 'Confirm and save purchase' }).click();
  await expect(page.getByText('Record saved successfully.')).toBeVisible();

  await page.getByRole('button', { name: 'History', exact: true }).click();
  const refund = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Record a refund' }) });
  const choose = refund.locator('select').first();
  const purchase = choose.locator('option').filter({ hasText: shop });
  await choose.selectOption((await purchase.getAttribute('value')) || '');
  await refund.getByLabel(/Refunded to/).fill('20.04');
  await refund.getByLabel('Refund date').fill('2026-10-28');
  await refund.getByLabel(/Reason/).fill('Fictional missing item refunded');
  await refund.getByRole('button', { name: 'Save refund' }).click();
  await expect(page.getByRole('row').filter({ hasText: shop })).toContainText('net $52.54');

  await page.getByRole('button', { name: 'Programs & budgets', exact: true }).click();
  await expect(page.locator('.catalog-list').first()).toContainText(shop);

  await page.getByRole('button', { name: 'Reconciliation', exact: true }).click();
  const bank = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Bank balance check' }) });
  await bank.getByLabel('Statement date').fill('2026-10-31');
  await bank.getByLabel('Bank balance (CAD)').fill('400');
  await bank.getByRole('button', { name: 'Record bank balance' }).click();
  await expect(bank.getByRole('row').filter({ hasText: '2026-10-31' })).toBeVisible();

  await page.getByRole('button', { name: 'Account', exact: true }).click();
  const add = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Add a staff account' }) });
  await add.getByLabel('Username').fill('browser.volunteer.' + run);
  await add.getByLabel(/Temporary password/).fill('fictional-browser-password');
  await add.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'browser.volunteer.' + run })).toContainText('Active');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
