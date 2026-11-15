import { test, expect } from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.route('**/api/account', route => route.fulfill({ json: { plan:'free', limit:10, used:0, remaining:10, resetsAt:'2027-01-01T00:00:00Z' } }));
});

for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
  test(`${name}: positioned text stays attached to the image through toggle, zoom and pan`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/?preview=photo');
    await expect(page.getByRole('button', { name: 'Readable', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.photo-text-region')).toHaveCount(7);
    await expect.poll(() => page.locator('.photo-text-region > span').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(2);
    const geometry = () => page.locator('.photo-canvas').evaluate(canvas => {
      const image = canvas.querySelector('img').getBoundingClientRect();
      const overlay = canvas.querySelector('.photo-text-region').getBoundingClientRect();
      return { ratio: image.width / image.height, left: (overlay.left - image.left) / image.width, top: (overlay.top - image.top) / image.height };
    });
    const before = await geometry();
    expect(before.ratio).toBeCloseTo(0.75, 3);
    expect(before.left).toBeCloseTo(0.18, 2);
    expect(before.top).toBeCloseTo(0.172, 2);
    const clipped = await page.locator('.photo-text-region').evaluateAll(boxes => boxes.some(box => {
      const span = box.querySelector('span');
      return span.offsetWidth > box.clientWidth || span.offsetHeight > box.clientHeight;
    }));
    expect(clipped).toBe(false);
    await page.screenshot({ path: testInfo.outputPath(`photo-${name}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Original', exact: true }).click();
    await expect(page.locator('.photo-text-overlays')).toHaveCount(0);
    await page.getByRole('button', { name: 'Readable', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Reset zoom and position' })).toHaveText('125%');
    const after = await geometry();
    expect(after.left).toBeCloseTo(before.left, 2);
    expect(after.top).toBeCloseTo(before.top, 2);
    const area = await page.locator('.photo-viewport').boundingBox();
    await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
    await page.mouse.down();
    await page.mouse.move(area.x + area.width / 2 + 25, area.y + area.height / 2 + 20);
    await page.mouse.up();
    const panned = await geometry();
    expect(panned.left).toBeCloseTo(before.left, 2);
    expect(panned.top).toBeCloseTo(before.top, 2);
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Transcribed text' })).toContainText('FREE FLU SHOTS');
    await expect(page.getByText('Simplified by AI.', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Listen/ }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('wide photos use their real image bounds without distorting overlays', async ({ page }) => {
  await page.route('**/samples/flu-flyer.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="400"><rect width="1600" height="400" fill="#FBF4E4"/></svg>' }));
  await page.goto('/?preview=photo');
  await expect.poll(() => page.locator('.photo-canvas').evaluate(el => { const rect = el.getBoundingClientRect(); return rect.width / rect.height; })).toBeCloseTo(4, 2);
  const bounds = await page.locator('.photo-canvas').evaluate(el => {
    const image = el.querySelector('img').getBoundingClientRect(), canvas = el.getBoundingClientRect();
    return { width: image.width - canvas.width, height: image.height - canvas.height };
  });
  expect(Math.abs(bounds.width)).toBeLessThan(1);
  expect(Math.abs(bounds.height)).toBeLessThan(1);
});

test('guest upload displays exact OCR and real overlay data without showing a legacy paraphrase', async ({ page }) => {
  const owner = '10000000-0000-4000-8000-000000000001';
  const source = '21. Suppose you’re asked to determine the curve.\nF is conservative.';
  let uploads = 0, processCalls = 0;
  const regions = [{ text: '21. Suppose you’re asked to determine the curve.', box_2d: [100, 10, 390, 980] }, { text: 'F is conservative.', box_2d: [430, 10, 750, 600] }];
  const jwtPayload = Buffer.from(JSON.stringify({ sub: owner, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  await page.route('https://sid-test.supabase.co/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/auth/v1/signup') {
      await route.fulfill({ json: { access_token: `eyJhbGciOiJIUzI1NiJ9.${jwtPayload}.test`, refresh_token: 'fixture-refresh', expires_in: 3600, token_type: 'bearer', user: { id: owner, aud: 'authenticated', is_anonymous: true, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } } });
    } else if (url.pathname.startsWith('/storage/v1/object/scans/')) {
      uploads++;
      await route.fulfill({ json: { Key: url.pathname } });
    } else if (url.pathname === '/rest/v1/documents' && route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      expect(input).not.toHaveProperty('status');
      expect(input.image_path).toBe(`${owner}/${input.id}.jpg`);
      await route.fulfill({ status: 201, body: '' });
    } else throw new Error(`Unexpected fixture request: ${url.pathname}`);
  });
  await page.route('**/api/process', async route => {
    processCalls++;
    const input = route.request().postDataJSON();
    expect(Object.keys(input)).toEqual(['documentId']);
    await route.fulfill({ json: { document: { id: input.documentId, status: 'ready', ocr_text: source, gemini_source_text: source, plain_text: 'A simplified answer that must never appear.', text_regions: regions, warnings: [] } } });
  });
  await page.goto('/');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 180;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FBF4E4'; ctx.fillRect(0, 0, 1200, 180);
    ctx.fillStyle = '#1F2A44'; ctx.font = '28px Georgia';
    ctx.fillText('21. Suppose you’re asked to determine the curve.', 20, 60);
    ctx.fillText('F is conservative.', 20, 120);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type=file]').setInputFiles({ name: 'public-test-page.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(page.getByRole('article', { name: 'Transcribed text' })).toBeVisible();
  expect(await page.locator('.reader-copy').textContent()).toBe(source);
  await expect(page.getByText('A simplified answer that must never appear.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Photo', exact: true }).click();
  await expect(page.locator('.photo-text-region')).toHaveCount(2);
  await page.getByRole('button', { name: 'Original', exact: true }).click();
  await expect(page.locator('.photo-text-overlays')).toHaveCount(0);
  expect(uploads).toBe(1);
  expect(processCalls).toBe(1);
});
