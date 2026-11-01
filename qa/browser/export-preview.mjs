import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = join(root, 'nutrition-site/dist');
const sourceFiles = ['index.html', 'styles.css', 'app.js', 'assets/mark.svg', 'assets/hero.png'];
const files = Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, await readFile(join(dist, name))])));
const css = files['styles.css'].toString('utf8');
const js = files['app.js'].toString('utf8');
assert.ok(!/<\/style/i.test(css) && !/<\/script/i.test(js), 'Нужно отдельно обработать закрывающие HTML-теги в исходниках.');
let html = files['index.html'].toString('utf8');
assert.equal((html.match(/<link rel="stylesheet" href="styles\.css">/g) || []).length, 1);
assert.equal((html.match(/<script src="app\.js" defer><\/script>/g) || []).length, 1);
html = html.replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`);
html = html.replace('<script src="app.js" defer></script>', '');
// Обычный inline script не поддерживает defer: запускаем исходный код после DOM.
html = html.replace('</body>', () => `<script>\n${js}\n</script>\n</body>`);
for (const [name, mime] of [['assets/mark.svg', 'image/svg+xml'], ['assets/hero.png', 'image/png']]) {
  html = html.replaceAll(`="${name}"`, `="data:${mime};base64,${files[name].toString('base64')}"`);
}
assert.ok(!/(?:src|href)="(?!#|mailto:|data:)[^"]+"/.test(html), 'Остался внешний или отдельный ресурс: экспорт требует проверки.');
assert.ok(!/@import\b|url\(/i.test(css), 'В стилях появились дополнительные ресурсы: сначала включите их в экспорт.');
const output = join(root, 'review');
await mkdir(output, { recursive: true });
await writeFile(join(output, 'interactive-preview.html'), html);
await writeFile(join(output, 'interactive-preview.json'), JSON.stringify({
  createdAt: new Date().toISOString(),
  source: 'nutrition-site/dist',
  files: Object.fromEntries(sourceFiles.map(name => [name, createHash('sha256').update(files[name]).digest('hex')])),
  output: 'interactive-preview.html',
  outputSha256: createHash('sha256').update(html).digest('hex'),
  bytes: Buffer.byteLength(html),
}, null, 2) + '\n');
console.log(`Создан review/interactive-preview.html: ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} МБ. Сеть для просмотра не требуется.`);
