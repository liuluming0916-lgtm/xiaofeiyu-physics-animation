/**
 * 组装免安装版（绿色版）：直接拿 electron 的 dist 当运行环境，把我们的 app 放进 resources/app。
 * 不依赖 electron-builder，也就不需要联网下载 winCodeSign / NSIS。
 *
 * 产物：release/portable/小肥鱼物理解题动画.exe
 */
import { cpSync, existsSync, mkdirSync, rmSync, renameSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ELEC = path.join(ROOT, 'node_modules', 'electron', 'dist');
const OUT = path.join(ROOT, 'release', 'portable');
const APP = path.join(OUT, 'resources', 'app');

if (!existsSync(path.join(ELEC, 'electron.exe'))) {
  console.error('找不到 node_modules/electron/dist/electron.exe，先安装 electron');
  process.exit(1);
}
if (!existsSync(path.join(ROOT, 'dist', 'app', 'server.mjs'))) {
  console.error('找不到 dist/app/server.mjs，先运行 npm run build:app');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(APP, { recursive: true });

console.log('复制 Electron 运行时…');
cpSync(ELEC, OUT, { recursive: true });

console.log('复制应用…');
cpSync(path.join(ROOT, 'electron'), path.join(APP, 'electron'), { recursive: true });
cpSync(path.join(ROOT, 'dist', 'app'), path.join(APP, 'dist', 'app'), { recursive: true });
for (const f of ['LICENSE', 'NOTICE', 'COMMERCIAL.md', 'TRADEMARK.md']) {
  if (existsSync(path.join(ROOT, f))) copyFileSync(path.join(ROOT, f), path.join(APP, f));
}

// resources/app/package.json：Electron 靠它找入口
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
writeFileSync(
  path.join(APP, 'package.json'),
  JSON.stringify(
    {
      name: 'xiaofeiyu-physics-animation',
      productName: '小肥鱼物理解题动画',
      version: pkg.version,
      description: pkg.description,
      license: pkg.license,
      author: pkg.author,
      main: 'electron/main.cjs',
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

// 把 electron.exe 改成应用名（Electron 按 exe 所在目录找 resources）
const exeOld = path.join(OUT, 'electron.exe');
const exeNew = path.join(OUT, '小肥鱼物理解题动画.exe');
if (existsSync(exeOld)) renameSync(exeOld, exeNew);

// 说明文件
writeFileSync(
  path.join(OUT, '启动说明.txt'),
  [
    '小肥鱼物理解题动画 2.0（免安装版）',
    '',
    '双击「小肥鱼物理解题动画.exe」即可运行，不需要安装 Node 或浏览器。',
    '首次运行会被 Windows 提示「未知发布者」，点「更多信息 → 仍要运行」。',
    '',
    '生成的文件保存在：%APPDATA%\\小肥鱼物理解题动画\\开源日志\\',
    '配置与密钥保存在：%APPDATA%\\小肥鱼物理解题动画\\xfy.config.json',
    '',
    '协议：AGPL-3.0（见 LICENSE）；商业授权与名称使用见 COMMERCIAL.md、TRADEMARK.md。',
    '本项目不收录第三方教辅内容。',
    '',
  ].join('\r\n'),
  'utf8',
);

console.log(`完成：${exeNew}`);
console.log('整个目录可直接压缩成 zip 分发。');
