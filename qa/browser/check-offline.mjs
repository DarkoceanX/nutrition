import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browsers, root, output, baseURL, interceptMail } from './common.mjs';

const previewPath = join(root, 'review/interactive-preview.html');
const previewURL = pathToFileURL(previewPath).href;
const manifest = JSON.parse(await readFile(join(root, 'review/interactive-preview.json'), 'utf8'));
const digest = data => createHash('sha256').update(data).digest('hex');
assert.equal(digest(await readFile(previewPath)), manifest.outputSha256, 'HTML изменён после экспорта.');
for (const [file, hash] of Object.entries(manifest.files)) {
  assert.equal(digest(await readFile(join(root, manifest.source, file))), hash, `Нужен повторный экспорт: ${file}`);
}
const result = { date: new Date().toISOString(), sourceURL: baseURL, preview: 'review/interactive-preview.html', sha256: manifest.outputSha256, engines: [], cases: [] };
const submit = '#booking-form button[type="submit"]';
const name = 'Тест автономного просмотра & ? # +';
const time = 'Тест: вечером';

async function snapshot(page) {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText,
    controls: [...document.querySelectorAll('a, button, input, select, textarea, summary')].map(e => [e.tagName, e.id, e.getAttribute('href'), e.textContent, e.getAttribute('maxlength')]),
    styles: ['body', 'h1', '.hero', '.hero-photo', '.button-primary', '.booking-form'].map(selector => {
      const element = document.querySelector(selector), css = getComputedStyle(element), box = element.getBoundingClientRect();
      return [selector, css.fontFamily, css.fontSize, css.color, css.backgroundColor, box.width, box.height];
    }),
  }));
}

for (const engine of ['chromium', 'firefox']) {
  let browser;
  try {
    browser = await browsers[engine].launch({ headless: true });
    result.engines.push({ engine, version: browser.version(), status: 'STARTED' });
    const online = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
    const source = await online.newPage();
    const response = await source.goto(baseURL, { waitUntil: 'networkidle' });
    assert.equal(response.status(), 200, 'Исходный сайт недоступен для сравнения.');
    const expected = await snapshot(source);
    await online.close();

    const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
    await interceptMail(context);
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [], network = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    context.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    async function run(id, title, action) {
      const entry = { engine, id, title };
      try {
        entry.evidence = await action();
        entry.status = 'PASS';
      } catch (error) {
        entry.status = 'FAIL';
        entry.error = error.message;
      }
      result.cases.push(entry);
      console.log(`${engine} ${id}: ${entry.status} — ${title}`);
    }
    async function openEmail() {
      await page.locator('#name').fill(name);
      await page.locator('#topic').selectOption({ index: 1 });
      await page.locator('#time').fill(time);
      await page.locator(submit).click();
      await page.locator('#email-dialog').waitFor({ state: 'visible' });
    }

    await run('OFF01', 'Загрузка файла без сети и совпадение с исходным сайтом', async () => {
      await page.goto(previewURL, { waitUntil: 'load' });
      const actual = await snapshot(page);
      assert.ok(JSON.stringify(actual) === JSON.stringify(expected), 'Текст, элементы управления или стили отличаются от HTTP-версии.');
      const images = await page.locator('img').evaluateAll(elements => elements.map(e => ({ embedded: e.src.startsWith('data:'), loaded: e.complete && e.naturalWidth > 0 })));
      assert.ok(images.length > 0 && images.every(e => e.embedded && e.loaded), 'Не все изображения встроены и загружены.');
      assert.equal(await page.locator('link[rel="stylesheet"], script[src]').count(), 0);
      return { matchingSource: true, images };
    });
    await run('OFF02', 'Внутренние ссылки и все вопросы FAQ', async () => {
      const links = page.locator('a[href^="#"]');
      for (let i = 0; i < await links.count(); i++) {
        const link = links.nth(i), href = await link.getAttribute('href');
        if (await link.getAttribute('class') === 'skip-link') await link.focus();
        await link.click();
        assert.ok(await page.evaluate(href => {
          if (href === '#') return scrollY < 2;
          const box = document.querySelector(href)?.getBoundingClientRect();
          return box && box.bottom > 0 && box.top < innerHeight;
        }, href), `Переход не сработал: ${href}`);
      }
      const rows = page.locator('details');
      for (let i = 0; i < await rows.count(); i++) {
        const row = rows.nth(i);
        await row.locator('summary').click();
        assert.ok(await row.locator('p').isVisible());
        await page.keyboard.press('Enter');
        assert.equal(await row.getAttribute('open'), null);
      }
      return { links: await links.count(), faq: await rows.count() };
    });
    await run('OFF03', 'Валидация формы, четыре темы и редактирование письма', async () => {
      await page.locator(submit).click();
      assert.equal(await page.locator('#email-dialog').isVisible(), false);
      assert.ok(await page.locator('#name').evaluate(e => e.validity.valueMissing));
      await page.locator('#name').fill(name);
      const topics = await page.locator('#topic option').allTextContents();
      for (let i = 1; i < topics.length; i++) {
        await page.locator('#topic').selectOption({ index: i });
        await page.locator('#time').fill(i === 2 ? '' : time);
        await page.locator(submit).click();
        const message = await page.locator('#email-message').inputValue();
        assert.ok(message.includes(name) && message.includes(topics[i]));
        assert.equal(message.includes(time), i !== 2);
        const edited = message + '\nТест: исправленный текст & ? # +';
        await page.locator('#email-message').fill(edited);
        const mail = new URL(await page.locator('#open-email').getAttribute('href'));
        assert.equal(mail.pathname, 'mariiapshenychna@gmail.com');
        assert.equal(mail.searchParams.get('body'), edited);
        await page.locator('#open-email').click();
        assert.equal(await page.evaluate(() => window.__checkedMailLinks.at(-1)), mail.href);
        await page.keyboard.press('Escape');
      }
      await page.locator('.email-link').click();
      assert.equal(await page.evaluate(() => window.__checkedMailLinks.length), topics.length);
      assert.equal(new URL(page.url()).search, '');
      return { topics: topics.length - 1, externalMailIntercepted: true };
    });
    await run('OFF04', 'Копирование и выделение текста при отказе буфера', async () => {
      await openEmail();
      await page.locator('#copy-message').click();
      await page.waitForFunction(() => /Текст скопирован|Автоматическое копирование недоступно/.test(document.querySelector('#email-status').textContent));
      const normalStatus = await page.locator('#email-status').innerText();
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Проверка отказа буфера'); } } }));
      await page.locator('#copy-message').click();
      await page.waitForFunction(() => document.querySelector('#email-status').textContent.startsWith('Автоматическое копирование недоступно'));
      assert.ok(await page.locator('#email-message').evaluate(e => document.activeElement === e && e.selectionStart === 0 && e.selectionEnd === e.value.length));
      await page.keyboard.press('Escape');
      return { normalStatus, fallbackSelection: true };
    });
    await run('OFF05', 'Оба окна: крестик, Escape и нажатие на фон', async () => {
      for (const selector of ['#email-dialog', '#privacy-dialog']) {
        for (const method of ['close', 'escape', 'backdrop']) {
          if (selector === '#email-dialog') await openEmail();
          else await page.locator('#privacy-button').click();
          await page.locator(selector).waitFor({ state: 'visible' });
          if (method === 'close') await page.locator(`${selector} .dialog-close`).click();
          else if (method === 'escape') await page.keyboard.press('Escape');
          else await page.mouse.click(1, 1);
          await page.locator(selector).waitFor({ state: 'hidden' });
        }
      }
      return { dialogs: 2, closingMethods: 3 };
    });
    await run('OFF06', 'Просмотр на ширине 320, 375 и 1440 пикселей', async () => {
      for (const width of [320, 375, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Горизонтальное переполнение.');
        await openEmail();
        assert.ok((await page.locator('#email-dialog').boundingBox()).width <= width);
        await page.locator('#email-dialog .dialog-close').click();
        await page.locator('#privacy-button').click();
        assert.ok((await page.locator('#privacy-dialog').boundingBox()).width <= width);
        await page.locator('#privacy-dialog .dialog-close').click();
      }
      if (engine === 'chromium') {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: join(output, 'offline-desktop.png') });
      }
      return { widths: [320, 375, 1440] };
    });
    await run('OFF07', 'Нет ошибок JavaScript и обращений к HTTP-серверам', async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(network, []);
      assert.equal(await page.evaluate(() => navigator.onLine), false);
      return { errors, httpRequests: network, offline: true };
    });
  } catch (error) {
    result.cases.push({ engine, id: 'SETUP', title: 'Подготовка сравнения', status: 'FAIL', error: error.message });
    console.error(`${engine}: ${error.message}`);
  } finally {
    if (browser) await browser.close();
    await writeFile(join(output, 'offline-results.json'), JSON.stringify(result, null, 2) + '\n');
  }
}
result.summary = { passed: result.cases.filter(c => c.status === 'PASS').length, failed: result.cases.filter(c => c.status === 'FAIL').length };
await writeFile(join(output, 'offline-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`Пройдено: ${result.summary.passed}; ошибок: ${result.summary.failed}.`);
process.exitCode = result.summary.failed ? 1 : 0;
