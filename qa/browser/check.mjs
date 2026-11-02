import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { browsers, root, output, baseURL, interceptMail } from './common.mjs';

const pages = [
  ['index.html','Главная'], ['about.html','Обо мне'], ['consultation.html','Консультация'],
  ['materials.html','Материалы'], ['contacts.html','Контакты и документы'], ['club.html','Клуб'],
];
const dir = join(output, 'site');
await mkdir(dir, { recursive:true });
const result = { date:new Date().toISOString(), url:baseURL, source:'nutrition_brand_strategy.docx, раздел 7', files:{}, engines:[], cases:[] };
const files = (await readdir(join(root,'nutrition-site/dist'), {recursive:true})).filter(f=>f.endsWith('.html'));
assert.deepEqual(files.sort(),pages.map(p=>p[0]).sort(),'Состав HTML-страниц отличается от карты стратегии.');
for(const file of [...files,'styles.css','app.js','assets/hero.png','assets/mark.svg']){
  result.files[file]=createHash('sha256').update(await readFile(join(root,'nutrition-site/dist',file))).digest('hex');
}
const name='Тест Анна & ? # % + «проверка»', time='Тест: вечером & 19:00';
const submit='#booking-form button[type="submit"]';
const address=file=>new URL(file,baseURL).href;
async function fill(page, selected=1, value=time){
  await page.locator('#name').fill(name);
  await page.locator('#topic').selectOption({index:selected});
  await page.locator('#time').fill(value);
}
async function openEmail(page){await fill(page);await page.locator(submit).click();await page.locator('#email-dialog').waitFor({state:'visible'});}

for(const engine of ['chromium','firefox']){
 let browser;
 try{
  browser=await browsers[engine].launch({headless:true});
  result.engines.push({engine,version:browser.version(),status:'STARTED'});
  const context=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'});
  await interceptMail(context);
  if(engine==='chromium') await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(baseURL).origin});
  const page=await context.newPage();
  page.setDefaultTimeout(7000);
  const errors=[], failedRequests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText}));
  async function run(id,title,action){
   const entry={engine,id,title};
   try{entry.evidence=await action();entry.status='PASS';}
   catch(e){entry.status='FAIL';entry.error=e.message;}
   result.cases.push(entry);
   console.log(engine+' '+id+': '+entry.status+' — '+title);
   await writeFile(join(dir,'results.json'),JSON.stringify(result,null,2)+'\n');
  }
  const audits=[];
  async function audit(label){
    await page.addScriptTag({path:join(root,'qa/browser/node_modules/axe-core/axe.min.js')});
    const value=await page.evaluate(async()=>{
      const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});
      return {violations:r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:r.incomplete.map(v=>({id:v.id,nodes:v.nodes.length})),passes:r.passes.length};
    });
    audits.push({page:label,...value});
    await writeFile(join(dir,engine+'-accessibility.json'),JSON.stringify(audits,null,2)+'\n');
    assert.equal(value.violations.length,0,'Нарушения доступности: '+JSON.stringify(value.violations));
    return value;
  }
  for(const [file,title] of pages){
   await run('PAGE-'+file,title+': загрузка, структура, изображения и все ссылки',async()=>{
    const response=await page.goto(address(file),{waitUntil:'networkidle'});
    assert.equal(response.status(),200);
    assert.equal(await page.locator('h1').count(),1);
    assert.equal(await page.locator('html').getAttribute('lang'),'ru');
    assert.deepEqual(await page.locator('#site-nav a').allTextContents(),pages.map(p=>p[1]));
    assert.equal(await page.locator('#site-nav a[aria-current="page"]').getAttribute('href'),file);
    assert.ok(await page.locator('img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)));
    const links=await page.locator('a[href]').evaluateAll(items=>items.map(a=>a.href));
    for(const link of new Set(links)){
     if(link.startsWith('mailto:'))continue;
     const url=new URL(link);
     assert.equal(url.origin,new URL(baseURL).origin);
     const r=await context.request.get(link);
     assert.equal(r.status(),200,link);
     if(url.hash)assert.ok((await r.text()).includes('id="'+decodeURIComponent(url.hash.slice(1))+'"'),'Не найден якорь: '+link);
    }
    return {links:links.length};
   });
   await run('AXE-'+file,title+': автоматическая проверка доступности',()=>audit(file));
  }
  await run('NAV','Все шесть переходов настольного и мобильного меню',async()=>{
   for(const width of [1440,375]){
    await page.setViewportSize({width,height:900});
    for(const [file] of pages){
     if(width===375)await page.locator('#menu-toggle').click();
     await page.locator('#site-nav a[href="'+file+'"]').click();
     await page.waitForURL(address(file));
     assert.equal(await page.locator('#site-nav a[aria-current="page"]').getAttribute('href'),file);
     if(width===375)assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'),'false');
    }
   }
   await page.goBack();
   assert.ok(pages.some(p=>page.url().endsWith(p[0])));
  });
  await run('FORM','Обязательные поля, пробелы, четыре темы, редактирование письма',async()=>{
   await page.setViewportSize({width:1440,height:900});
   await page.goto(address('consultation.html'));
   assert.equal(await page.locator('#booking-fallback').isVisible(),false);
   await page.locator(submit).click();
   assert.ok(await page.locator('#name').evaluate(e=>e.validity.valueMissing));
   await page.locator('#name').fill('   ');
   await page.locator('#topic').selectOption({index:1});
   await page.locator(submit).click();
   assert.ok(await page.locator('#name').evaluate(e=>e.validity.customError));
   const topics=await page.locator('#topic option').allTextContents();
   for(let i=1;i<topics.length;i++){
    await fill(page,i,i===2?'':time);
    await page.locator(submit).click();
    const value=await page.locator('#email-message').inputValue();
    assert.ok(value.includes(name)&&value.includes(topics[i]));
    assert.equal(value.includes(time),i!==2);
    const edited=value+'\nТест: исправление & ? # +';
    await page.locator('#email-message').fill(edited);
    const link=new URL(await page.locator('#open-email').getAttribute('href'));
    assert.equal(link.pathname,'mariiapshenychna@gmail.com');
    assert.equal(link.searchParams.get('subject'),'Заявка на консультацию по питанию');
    assert.equal(link.searchParams.get('body'),edited);
    await page.locator('#open-email').click();
    assert.equal(await page.evaluate(()=>window.__checkedMailLinks.at(-1)),link.href);
    await page.keyboard.press('Escape');
   }
   assert.equal(new URL(page.url()).search,'');
   return {topics:topics.length-1,externalMailIntercepted:true};
  });
  await run('COPY','Копирование письма и ручное выделение при отказе',async()=>{
   await openEmail(page);
   await page.locator('#copy-message').click();
   await page.waitForFunction(()=>/Текст скопирован|Автоматическое копирование недоступно/.test(document.querySelector('#email-status').textContent));
   const normalStatus=await page.locator('#email-status').innerText();
   if(engine==='chromium')assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),await page.locator('#email-message').inputValue());
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Тестовый отказ');}}}));
   await page.locator('#copy-message').click();
   await page.waitForFunction(()=>document.querySelector('#email-status').textContent.includes('Текст выделен'));
   assert.ok(await page.locator('#email-message').evaluate(e=>document.activeElement===e&&e.selectionStart===0&&e.selectionEnd===e.value.length));
   await page.keyboard.press('Escape');
   return {normalStatus,clipboardReadBack:engine==='chromium',fallbackSelected:true};
  });
  await run('DIALOG','Окно письма: крестик, Escape, фон и удержание фокуса',async()=>{
   for(const method of ['close','escape','backdrop']){
    await openEmail(page);
    for(let i=0;i<7;i++){
     await page.keyboard.press('Tab');
     assert.ok(await page.locator('#email-dialog').evaluate(e=>e.contains(document.activeElement)||(!document.hasFocus()&&document.activeElement===document.body)));
    }
    if(!await page.evaluate(()=>document.hasFocus()))await page.keyboard.press('Tab');
    if(method==='close')await page.locator('#email-dialog .dialog-close').click();
    if(method==='escape')await page.keyboard.press('Escape');
    if(method==='backdrop')await page.mouse.click(1,1);
    await page.locator('#email-dialog').waitFor({state:'hidden'});
    assert.ok(await page.locator(submit).evaluate(e=>document.activeElement===e));
   }
  });
  await run('KEYBOARD','Клавиатурная запись, ограничения полей и FAQ',async()=>{
   await page.goto(address('consultation.html'));
   await page.keyboard.press('Tab');
   assert.ok(await page.locator('.skip-link').evaluate(e=>document.activeElement===e));
   await page.keyboard.press('Enter');
   await page.locator('#name').fill(name);
   await page.locator('#name').focus();
   await page.keyboard.press('Tab');
   assert.ok(await page.locator('#topic').evaluate(e=>document.activeElement===e));
   await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');
   assert.ok(await page.locator('#time').evaluate(e=>document.activeElement===e));
   await page.keyboard.press('Enter');
   await page.locator('#email-dialog').waitFor({state:'visible'});
   await page.keyboard.press('Escape');
   for(const [selector,max] of [['#name',70],['#time',120]]){
    await page.locator(selector).fill('');await page.locator(selector).focus();
    await page.keyboard.insertText('Т'.repeat(max+10));
    assert.equal((await page.locator(selector).inputValue()).length,max);
   }
   await openEmail(page);await page.locator('#email-message').fill('');
   await page.keyboard.insertText('Т'.repeat(2600));
   assert.equal((await page.locator('#email-message').inputValue()).length,2500);
   await page.keyboard.press('Escape');
   for(const row of await page.locator('details').all()){
    await row.locator('summary').click();assert.ok(await row.locator('p').isVisible());
    await page.keyboard.press('Enter');assert.equal(await row.getAttribute('open'),null);
    await page.keyboard.press('Space');assert.equal(await row.getAttribute('open'),'');
    await row.locator('summary').click();
   }
  });
  await run('CLUB','Выражение интереса к клубу через почтовую ссылку',async()=>{
   await page.goto(address('club.html'));
   const link=new URL(await page.locator('#club-interest').getAttribute('href'));
   assert.equal(link.pathname,'mariiapshenychna@gmail.com');
   assert.equal(link.searchParams.get('subject'),'Интерес к будущему пилоту клуба');
   assert.ok(link.searchParams.get('body').includes('когда появятся подробности'));
   await page.locator('#club-interest').click();
   assert.equal(await page.evaluate(()=>window.__checkedMailLinks.at(-1)),link.href);
   return {externalMailIntercepted:true};
  });
  for(const [width,height] of [[320,780],[375,812],[768,1024],[812,375],[1100,900],[1101,900],[1440,900]]){
   await run('VIEW-'+width,'Шесть страниц и окно письма при '+width+' × '+height,async()=>{
    await page.setViewportSize({width,height});
    for(const [file] of pages){
     await page.goto(address(file));
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Переполнение: '+file);
     if(width<=1100){
      assert.equal(await page.locator('#site-nav').isVisible(),false);
      await page.locator('#menu-toggle').click();assert.ok(await page.locator('#site-nav').isVisible());
      await page.keyboard.press('Escape');assert.equal(await page.locator('#site-nav').isVisible(),false);
      assert.ok(await page.locator('#menu-toggle').evaluate(e=>document.activeElement===e));
      await page.locator('#menu-toggle').click();await page.locator('h1').click();
      assert.equal(await page.locator('#site-nav').isVisible(),false);
     }
    }
    await page.goto(address('consultation.html'));await openEmail(page);
    assert.ok(await page.locator('#email-dialog').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&e.scrollWidth<=e.clientWidth+1;}));
    await page.locator('#copy-message').click();
    await page.locator('#email-dialog .dialog-close').click();
    return {pages:6,width,height};
   });
  }
  await run('AXE-EXTRA','Доступность открытого мобильного меню и окна письма',async()=>{
   await page.setViewportSize({width:375,height:812});await page.goto(address('index.html'));
   await page.locator('#menu-toggle').click();await audit('mobile-menu');
   await page.goto(address('consultation.html'));await openEmail(page);await audit('email-dialog');
   await page.keyboard.press('Escape');
  });
  for(const fault of ['no-js','blocked-js','init-error']){
   for(const trigger of ['click','enter']){
    await run('FAULT-'+fault+'-'+trigger,'Защита данных при '+fault+', '+trigger,async()=>{
     const isolated=await browser.newContext({javaScriptEnabled:fault!=='no-js',viewport:{width:375,height:812}});
     try{
      if(fault==='blocked-js')await isolated.route('**/app.js',r=>r.abort('blockedbyclient'));
      if(fault==='init-error')await isolated.route('**/app.js',r=>r.fulfill({contentType:'text/javascript',body:'throw new Error("Тестовая ошибка инициализации");'}));
      const test=await isolated.newPage();test.setDefaultTimeout(6000);
      await test.goto(address('consultation.html'));
      assert.equal(await test.locator('#booking-form').isVisible(),false);
      assert.ok(await test.locator('#name').isDisabled());
      assert.ok(await test.locator('#booking-fallback').isVisible());
      assert.ok(await test.locator('#site-nav').isVisible());
      assert.equal(await test.locator('#booking-fallback a').getAttribute('href'),'mailto:mariiapshenychna@gmail.com');
      const outgoing=[];
      test.on('request',r=>outgoing.push({url:r.url(),body:r.postData()}));
      // Дополнительно убираем визуальную защиту: нативная отправка всё равно не должна раскрыть поля.
      await test.evaluate(()=>{document.querySelector('#booking-form').hidden=false;document.querySelector('fieldset').disabled=false;});
      await fill(test);
      if(trigger==='click')await test.locator(submit).click();else await test.locator('#time').press('Enter');
      await test.waitForTimeout(350);
      assert.equal(new URL(test.url()).search,'');
      assert.ok(outgoing.every(r=>!r.url.includes(encodeURIComponent('Тест'))&&!r.body));
      return {fallbackVisible:true,disabledByDefault:true,nativeSubmissionWithoutFields:true,outgoing};
     }finally{await isolated.close();}
    });
   }
  }
  await run('RUNTIME','Ошибки браузера, хранение и уменьшение анимаций',async()=>{
   await page.goto(address('index.html'));
   assert.deepEqual(await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length,cookie:document.cookie})),{local:0,session:0,cookie:''});
   assert.deepEqual(errors,[]);assert.deepEqual(failedRequests,[]);
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await page.locator('.button').first().evaluate(e=>getComputedStyle(e).transitionDuration),'0s');
   return {errors,failedRequests};
  });
  await run('SERVER','Неизвестные URL и защита каталога',async()=>{
   const checks=[];
   for(const path of ['missing-browser-test','..%2fREADME.md','assets/..%2f..%2fREADME.md','%E0%A4%A','.env']){
    const response=await context.request.get(address(path));
    assert.ok([403,404].includes(response.status()),path);
    checks.push({path,status:response.status()});
   }
   return checks;
  });
 }catch(error){
  result.cases.push({engine,id:'SETUP',status:'FAIL',error:error.message});
  console.error(engine+': '+error.message);
 }finally{if(browser)await browser.close();}
}
result.summary={passed:result.cases.filter(c=>c.status==='PASS').length,failed:result.cases.filter(c=>c.status==='FAIL').length};
await writeFile(join(dir,'results.json'),JSON.stringify(result,null,2)+'\n');
console.log('Пройдено: '+result.summary.passed+'; ошибок: '+result.summary.failed+'.');
process.exitCode=result.summary.failed?1:0;
