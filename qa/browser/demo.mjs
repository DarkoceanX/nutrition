import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { browsers, root, output, baseURL, interceptMail } from './common.mjs';

const dir=join(output,'site');
await mkdir(dir,{recursive:true});
const pages=[['index.html','Главная'],['about.html','Обо мне'],['consultation.html','Консультация'],['materials.html','Материалы'],['contacts.html','Контакты и документы'],['club.html','Клуб']];
const browser=await browsers.chromium.launch({headless:true});
async function record(name,viewport,mobile){
 const context=await browser.newContext({viewport,locale:'ru-RU',isMobile:mobile,hasTouch:mobile,recordVideo:{dir,size:viewport}});
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:new URL(baseURL).origin});
 await interceptMail(context);
 const page=await context.newPage(),video=page.video();
 page.setDefaultTimeout(7000);
 const label=text=>page.evaluate(text=>{
  document.querySelector('#qa-demo-label')?.remove();
  const tag=document.createElement('div');
  tag.id='qa-demo-label';tag.textContent='Демонстрация: '+text;
  Object.assign(tag.style,{position:'fixed',right:'12px',bottom:'8px',maxWidth:'calc(100vw - 24px)',padding:'7px 12px',border:'1px solid var(--line)',borderRadius:'8px',background:'var(--paper)',color:'var(--ink)',font:'12px Arial',zIndex:'2147483647',pointerEvents:'none'});
  (document.querySelector('dialog[open]')||document.body).append(tag);
 },text);
 const pause=()=>page.waitForTimeout(1100);
 async function navigate(file){
  if(mobile)await page.locator('#menu-toggle').click();
  await page.locator('#site-nav a[href="'+file+'"]').click();
  await page.waitForURL(new URL(file,baseURL).href);
 }
 try{
  await page.goto(baseURL,{waitUntil:'networkidle'});
  for(const [file,title] of pages){
   await navigate(file);await label(title);await pause();
   if(file==='materials.html'||file==='contacts.html'){
    await page.locator(file==='materials.html'?'#example-title':'#privacy').scrollIntoViewIfNeeded();await pause();
   }
  }
  await page.locator('#club-interest').click();await label('интерес к будущему пилоту, письмо не отправляется');await pause();
  await navigate('consultation.html');
  await page.locator('details summary').first().click();await label('ответ на вопрос');await pause();
  await page.locator('details summary').first().click();
  await page.locator('#name').fill('Тестовая заявка');
  await page.locator('#topic').selectOption({index:2});
  await page.locator('#time').fill('Тест: вечером');
  await label('подготовка письма');await pause();
  await page.locator('#booking-form button').click();
  await page.locator('#email-dialog').waitFor({state:'visible'});
  await label('редактируемый текст письма');await pause();
  await page.locator('#copy-message').click();await pause();
  await page.locator('#open-email').click();await label('почтовая ссылка проверена без отправки');await pause();
  await page.locator('#email-dialog .dialog-close').click();
  await navigate('index.html');await label('все шесть страниц доступны из меню');await pause();
 }finally{
  await context.close();
  await video.saveAs(join(dir,name+'.webm'));await video.delete();
 }
 console.log('Записано видео: '+name);
}
try{
 await record('desktop-demo',{width:1280,height:800},false);
 await record('mobile-demo',{width:375,height:812},true);
 const checkFile=join(root,'.cache/browser-check/site-video-check.html');
 await writeFile(checkFile,'<!doctype html><meta charset="utf-8">'+['desktop-demo','mobile-demo'].map(name=>'<video muted autoplay src="'+pathToFileURL(join(dir,name+'.webm')).href+'"></video>').join(''));
 const page=await browser.newPage();
 await page.goto(pathToFileURL(checkFile).href);
 await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>v.readyState>=2&&v.currentTime>0),{},{timeout:10000});
 const videos=await page.locator('video').evaluateAll(items=>items.map(v=>({file:v.src.split('/').at(-1),duration:v.duration,width:v.videoWidth,height:v.videoHeight,readyState:v.readyState,error:v.error?.message||null})));
 await writeFile(join(dir,'demo-metadata.json'),JSON.stringify({date:new Date().toISOString(),browser:browser.version(),videos},null,2)+'\n');
 console.log('Оба видео успешно воспроизводятся.');
}finally{await browser.close();}
