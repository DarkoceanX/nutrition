import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { browsers, root, output, baseURL, interceptMail } from './common.mjs';

const manifest=JSON.parse(await readFile(join(root,'review/site-preview.json'),'utf8'));
const pages=['index.html','about.html','consultation.html','materials.html','contacts.html','club.html'];
const hash=data=>createHash('sha256').update(data).digest('hex');
for(const [file,expected] of Object.entries(manifest.files)){
 assert.equal(hash(await readFile(join(root,manifest.source,file))),expected,'Нужен повторный экспорт: '+file);
}
assert.equal(hash(await readFile(join(root,manifest.archive))),manifest.archiveSha256);
const unpacked=join(root,'.cache/browser-check/offline-check');
await mkdir(unpacked,{recursive:true});
execFileSync('python3',['-c',
 'import sys,pathlib,zipfile\nfolder=pathlib.Path(sys.argv[2])\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert sorted(z.namelist())==sorted("nutrition-preview/"+n for n in sys.argv[3:])\n for n in sys.argv[3:]: (folder/n).write_bytes(z.read("nutrition-preview/"+n))',
 join(root,manifest.archive),unpacked,...pages],{cwd:root});
for(const file of pages)assert.equal(hash(await readFile(join(unpacked,file))),manifest.pages[file].sha256);
const dir=join(output,'site');
await mkdir(dir,{recursive:true});
const result={date:new Date().toISOString(),archive:manifest.archive,archiveSha256:manifest.archiveSha256,cases:[],engines:[]};
async function snapshot(page){
 await page.evaluate(()=>document.fonts.ready);
 return page.evaluate(()=>({
  title:document.title,text:document.body.innerText,
  links:[...document.querySelectorAll('a')].map(a=>a.getAttribute('href')),
  styles:['body','h1','.site-header','.site-nav'].map(selector=>{
   const e=document.querySelector(selector),s=getComputedStyle(e),r=e.getBoundingClientRect();
   return [selector,s.color,s.fontFamily,s.fontSize,r.width,r.height];
  }),
 }));
}
for(const engine of ['chromium','firefox']){
 let browser;
 try{
  browser=await browsers[engine].launch({headless:true});
  result.engines.push({engine,version:browser.version()});
  const online=await browser.newContext({viewport:{width:1440,height:900},locale:'ru-RU'});
  const source=await online.newPage(),expected={};
  for(const file of pages){
   const response=await source.goto(new URL(file,baseURL).href,{waitUntil:'networkidle'});
   assert.equal(response.status(),200);
   expected[file]=await snapshot(source);
  }
  await online.close();
  const context=await browser.newContext({offline:true,viewport:{width:1440,height:900},locale:'ru-RU'});
  await interceptMail(context);
  const page=await context.newPage();page.setDefaultTimeout(7000);
  const errors=[],network=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  context.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  async function run(id,title,action){
   const entry={engine,id,title};
   try{entry.evidence=await action();entry.status='PASS';}
   catch(error){entry.status='FAIL';entry.error=error.message;}
   result.cases.push(entry);
   console.log(engine+' '+id+': '+entry.status+' — '+title);
  }
  await page.goto(pathToFileURL(join(unpacked,'index.html')).href,{waitUntil:'load'});
  for(const file of pages){
   await run('OFF-'+file,'Переход без сети и совпадение с сайтом: '+file,async()=>{
    await page.locator('#site-nav a[href="'+file+'"]').click();
    await page.waitForURL(pathToFileURL(join(unpacked,file)).href);
    assert.ok(JSON.stringify(await snapshot(page))===JSON.stringify(expected[file]),'Тексты, ссылки или оформление отличаются от сервера.');
    assert.ok(await page.locator('img').evaluateAll(images=>images.every(i=>i.src.startsWith('data:')&&i.complete&&i.naturalWidth>0)));
    assert.equal(await page.locator('link[rel="stylesheet"],script[src]').count(),0);
    return {matchingSource:true,embeddedResources:true};
   });
  }
  await run('OFF-FORM','Мобильное меню и подготовка письма из локального файла',async()=>{
   await page.setViewportSize({width:375,height:812});
   await page.locator('#menu-toggle').click();
   await page.locator('#site-nav a[href="consultation.html"]').click();
   await page.locator('#name').fill('Тест без сети & ? #');
   await page.locator('#topic').selectOption({index:1});
   await page.locator('#booking-form button').click();
   await page.locator('#email-dialog').waitFor({state:'visible'});
   const message=await page.locator('#email-message').inputValue();
   const mail=new URL(await page.locator('#open-email').getAttribute('href'));
   assert.equal(mail.searchParams.get('body'),message);
   await page.locator('#open-email').click();
   assert.equal(await page.evaluate(()=>window.__checkedMailLinks.at(-1)),mail.href);
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Проверка отказа');}}}));
   await page.locator('#copy-message').click();
   await page.waitForFunction(()=>document.querySelector('#email-status').textContent.includes('Текст выделен'));
   assert.ok(await page.locator('#email-message').evaluate(e=>e.selectionStart===0&&e.selectionEnd===e.value.length));
   await page.locator('#email-dialog .dialog-close').click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  });
  await run('OFF-NETWORK','Нет HTTP-запросов и ошибок JavaScript',async()=>{
   assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
   assert.equal(await page.evaluate(()=>navigator.onLine),false);
   return {errors,httpRequests:network,offline:true};
  });
 }catch(error){result.cases.push({engine,id:'SETUP',status:'FAIL',error:error.message});console.error(engine+': '+error.message);}
 finally{if(browser)await browser.close();}
}
result.summary={passed:result.cases.filter(c=>c.status==='PASS').length,failed:result.cases.filter(c=>c.status==='FAIL').length};
await writeFile(join(dir,'offline-results.json'),JSON.stringify(result,null,2)+'\n');
console.log('Пройдено: '+result.summary.passed+'; ошибок: '+result.summary.failed+'.');
process.exitCode=result.summary.failed?1:0;
