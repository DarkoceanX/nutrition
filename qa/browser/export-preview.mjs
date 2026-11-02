import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root=fileURLToPath(new URL('../../',import.meta.url));
const dist=join(root,'nutrition-site/dist');
const pages=['index.html','about.html','consultation.html','materials.html','contacts.html','club.html'];
const sourceFiles=[...pages,'styles.css','app.js','assets/mark.svg','assets/hero.png'];
const files=Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,await readFile(join(dist,name))])));
const css=files['styles.css'].toString('utf8'),js=files['app.js'].toString('utf8');
assert.ok(!/<\/style/i.test(css)&&!/<\/script/i.test(js),'Нужно обработать закрывающие HTML-теги.');
assert.ok(!/@import\b|url\(/i.test(css),'В стилях появились отдельные ресурсы.');
const output=join(root,'.cache/browser-check/site-preview');
await mkdir(output,{recursive:true});
const hash=data=>createHash('sha256').update(data).digest('hex');
const exported={};
for(const name of pages){
 let html=files[name].toString('utf8');
 assert.equal((html.match(/<link rel="stylesheet" href="styles\.css">/g)||[]).length,1);
 assert.equal((html.match(/<script src="app\.js" defer><\/script>/g)||[]).length,1);
 html=html.replace('<link rel="stylesheet" href="styles.css">',()=>'<style>\n'+css+'\n</style>');
 html=html.replace('<script src="app.js" defer></script>','');
 html=html.replace('</body>',()=>'<script>\n'+js+'\n</script>\n</body>');
 for(const [file,mime] of [['assets/mark.svg','image/svg+xml'],['assets/hero.png','image/png']]){
  html=html.replaceAll('="'+file+'"','="data:'+mime+';base64,'+files[file].toString('base64')+'"');
 }
 for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
  const link=match[1];
  assert.ok(/^(#|mailto:|data:)/.test(link)||pages.includes(link.split('#')[0]),'Ресурс не включён в экспорт: '+link);
 }
 await writeFile(join(output,name),html);
 exported[name]={sha256:hash(html),bytes:Buffer.byteLength(html)};
}
const archive=join(root,'review/site-preview.zip');
// В архиве ровно шесть автономных страниц; архиватор не обращается к сети.
execFileSync('python3',['-c',
 'import sys, pathlib, zipfile\nfolder=pathlib.Path(sys.argv[1])\nwith zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED) as z:\n for name in sys.argv[3:]: z.write(folder/name,"nutrition-preview/"+name)',
 output,archive,...pages],{cwd:root});
await writeFile(join(root,'review/site-preview.json'),JSON.stringify({
 createdAt:new Date().toISOString(),source:'nutrition-site/dist',
 files:Object.fromEntries(sourceFiles.map(name=>[name,hash(files[name])])),pages:exported,
 directory:'.cache/browser-check/site-preview',archive:'review/site-preview.zip',archiveSha256:hash(await readFile(archive))
},null,2)+'\n');
console.log('Создан review/site-preview.zip: шесть страниц для просмотра без сети.');
