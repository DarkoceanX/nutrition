import { mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const cache = join(root, '.cache/browser-check');
process.env.PLAYWRIGHT_BROWSERS_PATH = join(cache, 'browsers');
process.env.TMPDIR = join(cache, 'tmp');
await mkdir(process.env.TMPDIR, { recursive: true });
// Все кэши тестовых процессов остаются в рабочей копии.
process.env.XDG_CACHE_HOME = join(cache, 'xdg-cache');
process.env.XDG_CONFIG_HOME = join(cache, 'xdg-config');
try {
  await access(join(cache, 'linux-libs'));
  process.env.LD_LIBRARY_PATH = [join(cache, 'linux-libs/usr/lib/x86_64-linux-gnu'), process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  process.env.FONTCONFIG_FILE = join(cache, 'fonts.conf');
} catch { /* В обычной среде используются установленные системные библиотеки. */ }

export const browsers = await import('playwright');
export const output = join(root, 'review/browser');
await mkdir(output, { recursive: true });
const index = process.argv.indexOf('--url');
const port = process.env.VIBEFORGE_SESSION_PORT ?? process.env.PORT;
const supplied = index >= 0 ? process.argv[index + 1] : port ? `http://127.0.0.1:${port}/` : '';
if (!supplied) throw new Error('Нужен --url адреса превью или назначенный порт сессии.');
export const baseURL = new URL(supplied).href;
if (!['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname) || !new URL(baseURL).port) {
  throw new Error('Эта проверка предназначена для локального превью на назначенном порту.');
}

export async function interceptMail(context) {
  await context.addInitScript(() => {
    window.__checkedMailLinks = [];
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href^="mailto:"]');
      if (link) {
        window.__checkedMailLinks.push(link.href);
        event.preventDefault(); // Проверяем переход, но не открываем внешнюю почту.
      }
    }, true);
  });
}
