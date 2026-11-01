"""Подготовка библиотек Chromium/Firefox внутри проекта для Ubuntu 26.04 x64.

Системные пакеты не устанавливаются: APT только рассчитывает зависимости
и скачивает архивы, dpkg-deb распаковывает их в локальный каталог.
"""
import os
from pathlib import Path
import re
import subprocess
import shutil

root = Path(__file__).resolve().parents[2]
cache = root / '.cache/browser-check'
archives = cache / 'debs'
libraries = cache / 'linux-libs'
archives.mkdir(parents=True, exist_ok=True)
libraries.mkdir(parents=True, exist_ok=True)
(cache / 'tmp').mkdir(exist_ok=True)
env = dict(os.environ, LC_ALL='C', TMPDIR=str(cache / 'tmp'))
packages = [
    'libatk1.0-0t64', 'libatk-bridge2.0-0t64', 'libxcomposite1',
    'libxdamage1', 'libxfixes3', 'libxrandr2', 'libgbm1', 'libasound2t64',
    'libatspi2.0-0t64', 'fonts-liberation', 'fonts-dejavu-core', 'fontconfig', 'libgtk-3-0t64',
    'libpangocairo-1.0-0', 'libx11-xcb1', 'libxcb-shm0', 'libxcursor1', 'libxi6',
]
plan = subprocess.check_output(
    ['apt-get', '--simulate', '--no-install-recommends', 'install', *packages],
    env=env, text=True,
)
(cache / 'linux-libs-plan.txt').write_text(plan)
selected = re.findall(r'^Inst (\S+) (?:\[[^\]]+\] )?\((\S+)', plan, re.M)
if selected:
    subprocess.run(['apt-get', 'download', *[f'{name}={version}' for name, version in selected]],
                   cwd=archives, env=env, check=True)
for archive in sorted(archives.glob('*.deb')):
    subprocess.run(['dpkg-deb', '-x', str(archive), str(libraries)], check=True)
(cache / 'fonts.conf').write_text(
    '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'
    f'<dir>{libraries}/usr/share/fonts</dir>'
    f'<cachedir>{cache}/font-cache</cachedir>'
    '<alias><family>Arial</family><prefer><family>Liberation Sans</family></prefer></alias>'
    '<alias><family>Times New Roman</family><prefer><family>Liberation Serif</family></prefer></alias>'
    '<alias><family>serif</family><prefer><family>Liberation Serif</family></prefer></alias>'
    '<alias><family>sans-serif</family><prefer><family>Liberation Sans</family></prefer></alias>'
    '</fontconfig>'
)
font_env = dict(env, FONTCONFIG_FILE=str(cache / 'fonts.conf'),
                LD_LIBRARY_PATH=str(libraries / 'usr/lib/x86_64-linux-gnu'))
if (cache / 'font-cache').exists():
    shutil.rmtree(cache / 'font-cache')
subprocess.run([str(libraries / 'usr/bin/fc-cache'), '-f'], env=font_env, check=True)
print(f'Библиотеки распакованы внутри проекта: {len(list(archives.glob("*.deb")))} пакетов')
