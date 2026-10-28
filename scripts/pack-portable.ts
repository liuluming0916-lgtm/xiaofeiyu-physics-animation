/**
 * 组装免安装版（绿色版）：直接拿 electron 的 dist 当运行环境，把我们的 app 放进 resources/app。
 * 不依赖 electron-builder，也就不需要联网下载 winCodeSign / NSIS。
 *
 * 产物：release/portable/小肥鱼物理动画.exe
 */
import { cpSync, existsSync, mkdirSync, rmSync, renameSync, copyFileSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

// 离线演示：11 个网页（总览 + Q01–Q10）放成根目录下一个文件夹，老师双击 index.html 就能看。
// 注意：Windows 上 fs.cpSync 复制到中文目标目录会把名字写成乱码（实测 Node 22），
// 所以这里先建目录、再逐个文件复制。
const DEMO_SRC = path.join(ROOT, 'dist', 'app', 'demos');
const DEMOS = path.join(OUT, '演示案例');
if (existsSync(DEMO_SRC)) {
  mkdirSync(DEMOS, { recursive: true });
  for (const f of readdirSync(DEMO_SRC)) {
    copyFileSync(path.join(DEMO_SRC, f), path.join(DEMOS, f));
  }
  console.log('演示案例 →', DEMOS);
}

// 许可文件统一收进 docs/，根目录只留 exe、resources 和启动说明
const DOCS = path.join(APP, 'docs');
mkdirSync(DOCS, { recursive: true });
for (const f of ['LICENSE', 'NOTICE', 'COMMERCIAL.md', 'TRADEMARK.md']) {
  if (existsSync(path.join(ROOT, f))) copyFileSync(path.join(ROOT, f), path.join(DOCS, f));
}

// resources/app/package.json：Electron 靠它找入口
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
writeFileSync(
  path.join(APP, 'package.json'),
  JSON.stringify(
    {
      name: 'xiaofeiyu-physics-animation',
      productName: '小肥鱼物理动画',
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

// 图标与版本信息：在改名前写入（rcedit 对中文路径不友好，先用 electron.exe 这个名字）
cpSync(path.join(ROOT, 'build-resources'), path.join(APP, 'build-resources'), { recursive: true });
const RCEDIT = path.join(ROOT, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe');
const ICO = path.join(ROOT, 'build-resources', 'icon.ico');
const exeOld = path.join(OUT, 'electron.exe');
if (existsSync(RCEDIT) && existsSync(ICO) && existsSync(exeOld)) {
  console.log('写入图标与版本信息…');
  const r = spawnSync(
    RCEDIT,
    [
      exeOld,
      '--set-icon', ICO,
      '--set-file-version', pkg.version,
      '--set-product-version', pkg.version,
      '--set-version-string', 'ProductName', '小肥鱼物理动画',
      '--set-version-string', 'FileDescription', `小肥鱼物理动画 ${pkg.version}`,
      '--set-version-string', 'CompanyName', '小肥鱼物理动画项目组',
      '--set-version-string', 'LegalCopyright', 'AGPL-3.0-only',
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) console.warn('rcedit 返回非零，图标可能没写进去');
} else {
  console.warn('找不到 rcedit / icon.ico / electron.exe，跳过图标写入');
}

// 把 electron.exe 改成应用名（Electron 按 exe 所在目录找 resources）
const exeNew = path.join(OUT, '小肥鱼物理动画.exe');
if (existsSync(exeOld)) renameSync(exeOld, exeNew);

// 说明文件
writeFileSync(
  path.join(OUT, '启动说明.txt'),
  [
    `小肥鱼物理动画 ${pkg.version}（免安装版）`,
    '',
    '双击「小肥鱼物理动画.exe」即可运行，不需要安装 Node 或浏览器。',
    '首次运行会被 Windows 提示「未知发布者」，点「更多信息 → 仍要运行」。',
    '',
    '想先看看成品：双击「演示案例\\index.html」，里面是 10 个已经做好的动画，',
    '不需要联网，也不用填 API Key。',
    '',
    '导出的动画保存在：文档\\小肥鱼物理动画\\导出\\',
    '配置与密钥保存在：%APPDATA%\\小肥鱼物理动画\\xfy.config.json',
    '',
    '协议：AGPL-3.0（见 LICENSE）；商业授权与名称使用见 COMMERCIAL.md、TRADEMARK.md。',
    '本项目不收录第三方教辅内容。',
    '',
  ].join('\r\n'),
  'utf8',
);

console.log(`完成：${exeNew}`);
console.log('整个目录可直接压缩成 zip 分发。');
