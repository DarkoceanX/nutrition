import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { browsers, root, output, baseURL, interceptMail } from './common.mjs';

const require = createRequire(import.meta.url);
const result = { date: new Date().toISOString(), url: baseURL, files: {}, engines: [], cases: [] };
for (const file of ['nutrition-site/dist/index.html', 'nutrition-site/dist/styles.css', 'nutrition-site/dist/app.js', 'nutrition-site/serve.mjs']) {
  result.files[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
}
const recipient = 'mariiapshenychna@gmail.com';
const syntheticName = 'Тест Анна & ? # % + «проверка»';
const syntheticTime = 'Тест: 19:00 & 21:00 ? # %';
const submit = '#booking-form button[type="submit"]';

function check(value, message, evidence) {
  if (!value) {
    const error = new Error(message);
    error.evidence = evidence;
    throw error;
  }
}
async function fill(page, time = syntheticTime) {
  await page.locator('#name').fill(syntheticName);
  await page.locator('#topic').selectOption({ index: 1 });
  await page.locator('#time').fill(time);
}
async function openEmail(page) {
  await fill(page);
  await page.locator(submit).click();
  await page.locator('#email-dialog').waitFor({ state: 'visible' });
}
async function closed(page, selector) {
  await page.locator(selector).waitFor({ state: 'hidden' });
}

for (const engine of ['chromium', 'firefox']) {
  let browser;
  try {
    browser = await browsers[engine].launch({ headless: true });
  } catch (error) {
    result.engines.push({ engine, status: 'BLOCKED', error: error.message });
    console.log(`${engine}: запуск недоступен`);
    continue;
  }
  result.engines.push({ engine, status: 'STARTED', version: browser.version() });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
  await interceptMail(context);
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  const consoleErrors = [], pageErrors = [], failedRequests = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  async function run(id, title, action, capturePage = page) {
    const entry = { engine, id, title };
    try {
      entry.evidence = await action();
      entry.status = 'PASS';
    } catch (error) {
      entry.status = 'FAIL';
      entry.error = error.message;
      if (error.evidence) entry.evidence = error.evidence;
      if (!capturePage.isClosed()) {
        const screenshot = `${engine}-${id}-failure.png`;
        try { await capturePage.screenshot({ path: join(output, screenshot), timeout: 5000 }); entry.screenshot = screenshot; } catch { /* Результат ошибки сохраняется и без снимка. */ }
      }
    }
    result.cases.push(entry);
    console.log(`${engine} ${id}: ${entry.status} — ${title}`);
    await writeFile(join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  }
  try {
    await run('B01', 'Загрузка страницы, скрипта, стилей и изображений', async () => {
      const response = await page.goto(baseURL, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      assert.match(await page.title(), /В своём ритме/);
      await page.evaluate(() => document.fonts.ready);
      const images = await page.locator('img').evaluateAll(elements => elements.map(e => ({ src: e.getAttribute('src'), loaded: e.complete && e.naturalWidth > 0, width: e.naturalWidth, height: e.naturalHeight })));
      check(images.every(x => x.loaded), 'Есть незагруженные изображения', images);
      if (engine === 'chromium') {
        await page.screenshot({ path: join(output, 'desktop-start.png') });
        await page.screenshot({ path: join(output, 'desktop-page.png'), fullPage: true });
      }
      return { images, resources: await page.evaluate(() => performance.getEntriesByType('resource').map(e => ({ url: e.name, bytes: e.transferSize, duration: Math.round(e.duration) }))) };
    });
    await run('B02', 'Все внутренние ссылки, пункты меню и кнопки записи', async () => {
      const links = page.locator('a[href^="#"]');
      const checked = [];
      for (let i = 0; i < await links.count(); i++) {
        const link = links.nth(i), href = await link.getAttribute('href');
        if (await link.getAttribute('class') === 'skip-link') await link.focus();
        await link.click();
        const state = await page.evaluate(href => {
          const target = href === '#' ? document.body : document.querySelector(href);
          const box = target?.getBoundingClientRect();
          return { hash: location.hash, scrollY, targetExists: Boolean(target), visible: box && box.bottom > 0 && box.top < innerHeight };
        }, href);
        check(state.targetExists && (href === '#' ? state.scrollY < 2 : state.visible), `Не сработала ссылка ${href}`, state);
        checked.push({ text: (await link.innerText()).trim(), href });
      }
      return checked;
    });
    await run('B03', 'Каждый вопрос FAQ: открытие и закрытие мышью и клавиатурой', async () => {
      const rows = page.locator('details'), checked = [];
      for (let i = 0; i < await rows.count(); i++) {
        const row = rows.nth(i), toggle = row.locator('summary');
        await toggle.click(); assert.equal(await row.getAttribute('open'), '');
        assert.ok(await row.locator('p').isVisible());
        await toggle.click(); assert.equal(await row.getAttribute('open'), null);
        await toggle.focus(); await page.keyboard.press('Enter'); assert.equal(await row.getAttribute('open'), '');
        await page.keyboard.press('Space'); assert.equal(await row.getAttribute('open'), null);
        checked.push((await toggle.innerText()).trim());
      }
      return checked;
    });
    await run('B04', 'Обязательные поля и имя из пробелов', async () => {
      await page.goto(baseURL);
      await page.locator(submit).click();
      assert.equal(await page.locator('#email-dialog').isVisible(), false);
      assert.equal(await page.locator('#name').evaluate(e => e.validity.valueMissing), true);
      await page.locator('#name').fill('Тест'); await page.locator(submit).click();
      assert.equal(await page.locator('#topic').evaluate(e => e.validity.valueMissing), true);
      await page.locator('#name').fill('   '); await page.locator('#topic').selectOption({ index: 1 });
      await page.locator(submit).click();
      assert.equal(await page.locator('#email-dialog').isVisible(), false);
      assert.equal(await page.locator('#name').evaluate(e => e.validity.customError), true);
      await page.locator('#name').fill('Тест');
      assert.equal(await page.locator('#name').evaluate(e => e.validity.customError), false);
      assert.equal(new URL(page.url()).search, '');
    });
    await run('B05', 'Все темы, кириллица, спецсимволы и необязательное время', async () => {
      const topics = await page.locator('#topic option').allTextContents(), checked = [];
      for (let i = 1; i < topics.length; i++) {
        await fill(page, i === 2 ? '' : syntheticTime);
        await page.locator('#topic').selectOption({ index: i });
        await page.locator(submit).click();
        const text = await page.locator('#email-message').inputValue();
        const target = new URL(await page.locator('#open-email').getAttribute('href'));
        assert.equal(target.protocol, 'mailto:'); assert.equal(target.pathname, recipient);
        assert.equal(target.searchParams.get('subject'), 'Заявка на консультацию по питанию');
        assert.equal(target.searchParams.get('body'), text);
        assert.ok(text.includes(syntheticName) && text.includes(topics[i]));
        assert.equal(text.includes('Удобное время для связи:'), i !== 2);
        checked.push({ topic: topics[i], optionalTime: i === 2, body: text });
        await page.locator('#email-dialog .dialog-close').click();
      }
      return checked;
    });
    await run('B06', 'Редактирование письма и обе почтовые ссылки', async () => {
      await openEmail(page);
      const text = 'Тест: изменённое письмо. Кириллица & ? # % + = /\nВторая строка.';
      await page.locator('#email-message').fill(text);
      const href = await page.locator('#open-email').getAttribute('href');
      assert.equal(new URL(href).searchParams.get('body'), text);
      await page.locator('#open-email').click();
      assert.equal(await page.locator('#email-dialog').isVisible(), true);
      assert.match(await page.locator('#email-status').innerText(), /ещё не отправлено/);
      await page.locator('#email-dialog .dialog-close').click();
      await page.locator('.email-link').click();
      const targets = await page.evaluate(() => window.__checkedMailLinks);
      assert.equal(targets.length, 2); assert.equal(targets[0], href); assert.equal(targets[1], `mailto:${recipient}`);
      return { targets, boundary: 'Переход перехвачен перед запуском внешней почты; письма не отправлялись.' };
    });
    await run('B07', 'Копирование письма и сброс статуса при повторном открытии', async () => {
      await openEmail(page);
      if (engine === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseURL).origin });
      await page.locator('#copy-message').click();
      await page.waitForFunction(() => !document.querySelector('#email-status').textContent.includes('ещё не отправлено'));
      const status = await page.locator('#email-status').innerText();
      if (engine === 'chromium') {
        assert.match(status, /Текст скопирован/);
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.locator('#email-message').inputValue());
      } else assert.match(status, /Текст скопирован|Текст выделен/);
      await page.locator('#email-dialog .dialog-close').click(); await page.locator(submit).click();
      assert.match(await page.locator('#email-status').innerText(), /ещё не отправлено/);
      await page.locator('#email-dialog .dialog-close').click();
      return { status, readBackVerified: engine === 'chromium' };
    });
    await run('B08', 'Отказ API буфера: выделение текста для ручного копирования', async () => {
      await page.goto(baseURL); await openEmail(page);
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Тестовый отказ', 'NotAllowedError'); } } }));
      await page.locator('#copy-message').click();
      await page.waitForFunction(() => document.querySelector('#email-status').textContent.includes('Текст выделен'));
      const state = await page.locator('#email-message').evaluate(e => ({ focused: document.activeElement === e, start: e.selectionStart, end: e.selectionEnd, length: e.value.length }));
      assert.ok(state.focused && state.start === 0 && state.end === state.length);
      if (engine === 'chromium') await page.screenshot({ path: join(output, 'clipboard-fallback.png') });
      await page.goto(baseURL);
      return { ...state, fault: 'Отказ API смоделирован тестом; выполняется настоящий обработчик приложения.' };
    });
    await run('B09', 'Оба диалога: крестик, Escape, фон, фокус и Tab', async () => {
      for (const selector of ['#email-dialog', '#privacy-dialog']) {
        const opener = selector === '#email-dialog' ? submit : '#privacy-button';
        if (selector === '#email-dialog') await fill(page);
        for (const method of ['close', 'escape', 'backdrop']) {
          await page.locator(opener).click();
          assert.ok(await page.locator(selector).isVisible());
          assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
          await page.locator(`${selector} h2`).click();
          assert.ok(await page.locator(selector).isVisible());
          for (let i = 0; i < 7; i++) {
            await page.keyboard.press('Tab');
            assert.equal(await page.locator(selector).evaluate(e => e.contains(document.activeElement) || (!document.hasFocus() && document.activeElement === document.body)), true);
          }
          await page.keyboard.press('Shift+Tab');
          assert.equal(await page.locator(selector).evaluate(e => e.contains(document.activeElement) || (!document.hasFocus() && document.activeElement === document.body)), true);
          // Tab может перейти в панель самого браузера. Возвращаемся в документ;
          // фон страницы при этом не должен получать фокус.
          if (!await page.evaluate(() => document.hasFocus())) await page.keyboard.press('Tab');
          if (method === 'close') await page.locator(`${selector} .dialog-close`).click();
          if (method === 'escape') await page.keyboard.press('Escape');
          if (method === 'backdrop') await page.mouse.click(2, 2);
          await closed(page, selector);
          assert.equal(await page.locator(opener).evaluate(e => document.activeElement === e), true);
          assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
        }
      }
    });
    await run('B10', 'Форма целиком с клавиатуры и видимый фокус', async () => {
      await page.goto(baseURL);
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('.skip-link').evaluate(e => document.activeElement === e), true);
      await page.keyboard.press('Enter');
      await page.locator('#name').focus(); await page.keyboard.type('Тест клавиатуры');
      await page.keyboard.press('Tab'); assert.equal(await page.locator('#topic').evaluate(e => document.activeElement === e), true);
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('Tab');
      assert.equal(await page.locator('#time').evaluate(e => document.activeElement === e), true);
      await page.keyboard.type('19:00'); await page.keyboard.press('Tab');
      const focus = await page.locator(submit).evaluate(e => ({ active: document.activeElement === e, outline: getComputedStyle(e).outlineStyle }));
      assert.ok(focus.active && focus.outline !== 'none');
      await page.keyboard.press('Enter'); assert.ok(await page.locator('#email-dialog').isVisible());
      await page.keyboard.press('Escape');
      return focus;
    });
    await run('B11', 'Ограничения длины полей и текста письма', async () => {
      await page.goto(baseURL);
      for (const [selector, max] of [['#name', 70], ['#time', 120]]) {
        await page.locator(selector).fill(''); await page.locator(selector).focus();
        await page.keyboard.insertText('А'.repeat(max + 30));
        assert.equal((await page.locator(selector).inputValue()).length, max);
      }
      await page.locator('#topic').selectOption({ index: 1 }); await page.locator(submit).click();
      await page.locator('#email-message').fill(''); await page.locator('#email-message').focus();
      await page.keyboard.insertText('Б'.repeat(2600));
      assert.equal((await page.locator('#email-message').inputValue()).length, 2500);
      await page.keyboard.press('Escape');
    });
    for (const [width, height] of [[320,780],[375,812],[768,1024],[1440,900],[812,375]]) {
      await run(`V${width}`, `Страница и оба окна при ${width} × ${height}`, async () => {
        await page.setViewportSize({ width, height }); await page.goto(baseURL);
        const measure = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, menuVisible: getComputedStyle(document.querySelector('nav')).display !== 'none' }));
        check(measure.scrollWidth <= width + 1, 'Горизонтальное переполнение страницы', measure);
        if (engine === 'chromium' && [320,375,768].includes(width)) {
          await page.screenshot({ path: join(output, `viewport-${width}.png`) });
          if (width === 375) await page.screenshot({ path: join(output, 'mobile-page.png'), fullPage: true });
        }
        const dialogs = [];
        for (const selector of ['#email-dialog', '#privacy-dialog']) {
          if (selector === '#email-dialog') await openEmail(page); else await page.locator('#privacy-button').click();
          const bounds = await page.locator(selector).evaluate(e => { const r=e.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, clientWidth:e.clientWidth, scrollWidth:e.scrollWidth }; });
          check(bounds.left >= -1 && bounds.right <= width + 1 && bounds.top >= -1 && bounds.bottom <= height + 1 && bounds.scrollWidth <= bounds.clientWidth + 1, `Окно не помещается: ${selector}`, bounds);
          if (selector === '#email-dialog') {
            await page.locator('#open-email').click();
            await page.locator('#copy-message').click();
          }
          if (engine === 'chromium' && width === 375) await page.screenshot({ path: join(output, `mobile-${selector.slice(1)}.png`) });
          await page.locator(`${selector} .dialog-close`).click();
          dialogs.push({ selector, bounds });
        }
        return { ...measure, dialogs };
      });
    }
    await run('V200', 'Эмуляция рабочей области 720 × 450 для масштаба 200%', async () => {
      await page.setViewportSize({ width: 720, height: 450 }); await page.goto(baseURL);
      const state = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      check(state.scrollWidth <= state.width + 1, 'При увеличении появляется горизонтальное переполнение', state);
      await openEmail(page); await page.locator('#open-email').click(); await page.locator('#email-dialog .dialog-close').click();
      if (engine === 'chromium') await page.screenshot({ path: join(output, 'zoom-200.png') });
      await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(baseURL);
      return { ...state, method: 'Рабочая область в CSS-пикселях уменьшена вдвое от 1440 × 900. Настоящий Ctrl+Plus и системный масштаб не проверены.' };
    });
    await run('A01', 'Автоматическая проверка доступности страницы и диалогов', async () => {
      await page.goto(baseURL); await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
      const audits = [];
      for (const state of ['page', 'email', 'privacy']) {
        if (state === 'email') await openEmail(page);
        if (state === 'privacy') await page.locator('#privacy-button').click();
        const audit = await page.evaluate(async () => {
          const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa'] } });
          return { violations: r.violations.map(v => ({ id:v.id, impact:v.impact, description:v.description, helpUrl:v.helpUrl, nodes:v.nodes.map(n => ({ target:n.target, summary:n.failureSummary })) })), incomplete: r.incomplete.map(v=>({id:v.id,nodes:v.nodes.length})), passes:r.passes.length };
        });
        audits.push({ state, ...audit });
        if (state !== 'page') await page.keyboard.press('Escape');
      }
      await writeFile(join(output, `${engine}-accessibility.json`), JSON.stringify(audits,null,2)+'\n');
      check(audits.every(a => a.violations.length === 0), 'Обнаружены нарушения доступности; см. отдельный JSON', audits);
      return audits;
    });
    await run('B12', 'Ошибки браузера и отсутствие сохранённых полей', async () => {
      const storage = await page.evaluate(() => ({ local:localStorage.length, session:sessionStorage.length, cookie:document.cookie }));
      check(!consoleErrors.length && !pageErrors.length && !failedRequests.length, 'Ошибки при штатной работе', { consoleErrors,pageErrors,failedRequests });
      assert.deepEqual(storage, { local:0, session:0, cookie:'' });
      return { storage, consoleErrors, pageErrors, failedRequests };
    });
    for (const fault of ['no-js', 'blocked-js', 'init-error']) {
      for (const trigger of ['click', 'enter']) {
        const isolated = await browser.newContext({ javaScriptEnabled: fault !== 'no-js', viewport: { width:1280,height:800 } });
        if (fault === 'blocked-js') await isolated.route('**/app.js', route => route.abort('blockedbyclient'));
        if (fault === 'init-error') await isolated.route('**/app.js', route => route.fulfill({ contentType:'text/javascript', body:'throw new Error("Тест: остановка инициализации приложения");' }));
        const testPage = await isolated.newPage(); testPage.setDefaultTimeout(5000);
        await run(`F-${fault}-${trigger}`, `Форма без рабочего JavaScript: ${fault}, ${trigger}`, async () => {
          await testPage.goto(baseURL, { waitUntil:'networkidle' });
          const outgoing=[];
          testPage.on('request', request => { if (request.isNavigationRequest()) outgoing.push({ method:request.method(),url:request.url() }); });
          await fill(testPage, 'Тестовое время');
          if (trigger === 'click') await testPage.locator(submit).click(); else await testPage.locator('#time').press('Enter');
          // Ждём возможный запрос; задержка нужна именно для отрицательной проверки.
          await testPage.waitForTimeout(350);
          const exposed=outgoing.filter(r=>new URL(r.url).searchParams.has('name'));
          check(exposed.length === 0, 'Имя, тема и время отправлены GET-запросом в URL сайта', { outgoing, finalURL:testPage.url(), syntheticData:true });
          return { outgoing };
        }, testPage);
        await isolated.close();
      }
    }
    await run('S01', 'Ошибочные URL и запрет выхода из каталога сайта', async () => {
      const responses=[];
      for (const path of ['missing-browser-test', '..%2fREADME.md', 'assets/..%2f..%2fREADME.md', '%E0%A4%A', '.env']) {
        const response=await context.request.get(new URL(path,baseURL).href);
        const body=await response.text();
        check([403,404].includes(response.status()), `Неожиданный ответ для ${path}`, {status:response.status(),body});
        responses.push({path,status:response.status()});
      }
      return responses;
    });
  } finally {
    await context.close(); await browser.close();
  }
}
result.summary = Object.fromEntries(['PASS','FAIL','BLOCKED'].map(status => [status, result.cases.filter(c=>c.status===status).length + (status === 'BLOCKED' ? result.engines.filter(e=>e.status==='BLOCKED').length : 0)]));
await writeFile(join(output,'results.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.summary));
process.exitCode = result.summary.FAIL || result.summary.BLOCKED ? 1 : 0;
