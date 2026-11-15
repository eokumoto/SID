import { test, expect } from '@playwright/test';
test.setTimeout(120000);

// Fake device speech engine: speaks one word every 120ms and records what it was asked to say.
const fakeSpeech = () => {
  class TestUtterance { constructor(text) { this.text = text; } }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: TestUtterance, configurable: true });
  let timer = null, cursor = 0, paused = false; window.__spoken = [];
  const engine = { speaking: false, getVoices: () => [{ lang: 'en-US', name: 'Test' }], addEventListener() {}, removeEventListener() {},
    cancel() { clearInterval(timer); engine.speaking = false; }, pause() { paused = true; }, resume() { paused = false; },
    speak(u) {
      window.__spoken.push(u.text); clearInterval(timer); cursor = 0; paused = false; engine.speaking = true;
      queueMicrotask(() => u.onstart?.({}));
      const words = [...u.text.matchAll(/\S+/g)];
      timer = setInterval(() => {
        if (paused) return;
        const word = words[cursor++];
        if (!word) { clearInterval(timer); engine.speaking = false; u.onend?.({}); }
        else u.onboundary?.({ name: 'word', charIndex: word.index, charLength: word[0].length });
      }, 120);
    } };
  Object.defineProperty(window, 'speechSynthesis', { value: engine, configurable: true });
};

async function open(browser, testInfo, options) {
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL, ...options });
  await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  await context.addInitScript(fakeSpeech);
  const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?preview=pro');
  await page.getByRole('article', { name: 'Transcribed text' }).waitFor();
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await page.getByRole('button', { name: 'Pause reading', exact: true }).waitFor();
  const text = await page.getByRole('article', { name: 'Transcribed text' }).innerText();
  return { page, errors, text, slider: page.getByRole('slider', { name: 'Reading position' }) };
}
const point = async (slider, fraction) => { const box = await slider.boundingBox(); return { x: box.x + box.width * fraction, y: box.y + box.height / 2 }; };
const value = slider => slider.getAttribute('aria-valuenow').then(Number);
const lastSpoken = page => page.evaluate(() => window.__spoken.at(-1));

test('desktop: click and drag the Listen bar to seek', async ({ browser }, testInfo) => {
  const { page, errors, slider } = await open(browser, testInfo, { viewport: { width: 1440, height: 950 } });
  const first = await lastSpoken(page);

  // Click ahead.
  const ahead = await point(slider, 0.7);
  await page.mouse.click(ahead.x, ahead.y);
  await expect.poll(() => value(slider)).toBeGreaterThanOrEqual(65);
  const jumped = await lastSpoken(page);
  expect(jumped.length).toBeLessThan(first.length * 0.45);
  await page.getByRole('button', { name: 'Pause reading', exact: true }).waitFor();

  // Drag back: speech only restarts on release.
  const count = await page.evaluate(() => window.__spoken.length);
  const from = await point(slider, 0.6), to = await point(slider, 0.2);
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  expect(await page.evaluate(() => window.__spoken.length)).toBe(count);
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBe(count + 1);
  expect(await value(slider)).toBeGreaterThanOrEqual(17);
  expect(await value(slider)).toBeLessThan(30);

  // Keyboard.
  await slider.focus(); await page.keyboard.press('End');
  await expect.poll(() => value(slider)).toBeGreaterThan(90);

  // Seeking while paused stays paused and resumes from the new spot.
  await page.getByRole('button', { name: /Pause reading|Replay reading/ }).click();
  const mid = await point(slider, 0.5);
  await page.mouse.click(mid.x, mid.y);
  await page.waitForTimeout(400);
  expect(await page.getByRole('button', { name: 'Resume reading', exact: true }).isVisible()).toBe(true);
  expect(await page.locator('.reader-copy mark').count()).toBe(1);
  const spoken = await page.evaluate(() => window.__spoken.length);
  await page.getByRole('button', { name: 'Resume reading', exact: true }).click();
  await page.getByRole('button', { name: 'Pause reading', exact: true }).waitFor();
  expect(await page.evaluate(() => window.__spoken.length)).toBe(spoken + 1);
  const resumed = await lastSpoken(page);
  expect(resumed.length).toBeLessThan(first.length * 0.6);
  expect(resumed.length).toBeGreaterThan(first.length * 0.4);

  // Speed control still works.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  expect(await page.getByLabel('Reading speed', { exact: true }).isEnabled()).toBe(true);
  expect(errors).toEqual([]);
});

test('phone: tap and drag the Listen bar to seek', async ({ browser }, testInfo) => {
  const { page, errors, slider } = await open(browser, testInfo, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const first = await lastSpoken(page);
  const ahead = await point(slider, 0.8);
  await page.touchscreen.tap(ahead.x, ahead.y);
  await expect.poll(() => value(slider)).toBeGreaterThanOrEqual(75);
  expect((await lastSpoken(page)).length).toBeLessThan(first.length * 0.3);

  // Touch drag via CDP so pointer events come from a real touch sequence.
  const client = await page.context().newCDPSession(page);
  const from = await point(slider, 0.8), to = await point(slider, 0.3);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 8; i++) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y }] });
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => value(slider)).toBeLessThan(40);
  expect(await value(slider)).toBeGreaterThanOrEqual(25);
  await expect(page.getByRole('button', { name: 'Pause reading', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
