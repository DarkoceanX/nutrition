import { join } from 'node:path';
import { browsers, output, baseURL, interceptMail } from './common.mjs';

const browser = await browsers.chromium.launch({ headless: true });
async function record(name, viewport, mobile, action) {
  const context = await browser.newContext({ viewport, locale:'ru-RU', isMobile:mobile, hasTouch:mobile, recordVideo:{dir:output,size:viewport} });
  await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(baseURL).origin});
  await interceptMail(context);
  const page = await context.newPage();
  const video = page.video();
  page.setDefaultTimeout(7000);
  const pause = (ms = 1000) => page.waitForTimeout(ms);
  const label = text => page.evaluate(text => {
    document.querySelector('#qa-demo-label')?.remove();
    const tag = document.createElement('div');
    tag.id = 'qa-demo-label'; tag.textContent = `Демонстрация: ${text}`;
    Object.assign(tag.style,{position:'fixed',left:'12px',top:'8px',maxWidth:'calc(100vw - 24px)',padding:'7px 12px',border:'1px solid var(--line)',borderRadius:'7px',background:'var(--paper)',color:'var(--ink)',font:'12px Arial',zIndex:'2147483647',pointerEvents:'none'});
    (document.querySelector('dialog[open]') || document.body).append(tag);
  },text);
  try {
    await page.goto(baseURL,{waitUntil:'networkidle'});
    await action(page,label,pause);
  } finally {
    await context.close();
    await video.saveAs(join(output,`${name}.webm`));
    await video.delete();
  }
}
try {
  await record('desktop-demo',{width:1280,height:800},false,async(page,label,pause)=>{
    await label('главная страница'); await pause(1500);
    for(const [href,title] of [['#for-you','раздел «Для кого»'],['#approach','раздел «Подход»'],['#consultation','описание консультации'],['#faq','раскрывающиеся вопросы']]){
      await page.locator(`.desktop-nav a[href="${href}"]`).click(); await label(title); await pause();
    }
    for(const item of await page.locator('details').all()){
      await item.locator('summary').click(); await pause(550); await item.locator('summary').click();
    }
    await page.locator('.header-cta').click(); await label('проверка обязательных полей');
    await page.locator('#booking-form button').click(); await pause(1300);
    await page.locator('#name').fill('Тестовая заявка');
    await page.locator('#topic').selectOption({index:2});
    await page.locator('#time').fill('Тест: вечером по Москве');
    await label('имя, тема и удобное время'); await pause(1000);
    await page.locator('#booking-form button').click(); await label('подготовленный текст письма'); await pause(1500);
    await page.locator('#email-message').fill((await page.locator('#email-message').inputValue())+'\nЭто демонстрация, отправка не выполняется.');
    await label('текст можно отредактировать'); await pause(1000);
    await page.locator('#copy-message').click(); await label('копирование в буфер'); await pause(1200);
    await page.locator('#open-email').click(); await label('ссылка на почту проверена, письмо не отправлено'); await pause(1400);
    await page.locator('#email-dialog .dialog-close').click();
    await page.locator('#privacy-button').click(); await label('окно информации о данных'); await pause(1700);
    await page.keyboard.press('Escape'); await label('закрытие клавишей Escape'); await pause(900);
    await page.locator('header .brand').click(); await label('возврат к началу страницы'); await pause(1300);
  });
  console.log('Сохранена демонстрация настольной версии');
  await record('mobile-demo',{width:375,height:812},true,async(page,label,pause)=>{
    await label('экран телефона 375 × 812'); await pause(1500);
    await page.locator('.header-cta').tap(); await label('быстрый переход к записи'); await pause(1200);
    await page.locator('#name').fill('Тест на телефоне'); await page.locator('#topic').selectOption({index:1});
    await page.locator('#booking-form button').tap(); await label('окно письма на телефоне'); await pause(1500);
    await page.locator('#copy-message').tap(); await label('копирование письма'); await pause(1300);
    await page.locator('#email-dialog .dialog-close').tap();
    await page.locator('#privacy-button').tap(); await label('информация о данных'); await pause(1500);
    await page.locator('#privacy-dialog .dialog-close').tap();
    const item=page.locator('details').first();await item.locator('summary').tap();await label('вопросы раскрываются касанием');await pause(1400);
    await item.locator('summary').tap();await page.locator('header .brand').tap();await label('главная страница');await pause(1400);
  });
  console.log('Сохранена демонстрация мобильной версии');
} finally { await browser.close(); }
