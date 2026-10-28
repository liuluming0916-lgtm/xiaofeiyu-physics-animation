/**
 * 构建桌面版运行时：把服务端打成一个 .mjs，并带上需要的静态资源。
 *
 * 产物结构：
 *   dist/app/server.mjs      服务端（含全部依赖）
 *   dist/app/assets/*.js     探针 / 文本清洗 / 播放器（运行时读文件注入页面）
 *   dist/app/web/**          教师界面
 *   dist/app/demos/**        离线演示案例（开源日志/batch 里的成品动画）
 */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ABOUT_HTML, ABOUT_CSS } from '../packages/shared/about.ts';
import { ABOUT_VERSION } from '../packages/shared/about.ts';

const OUT = path.resolve('dist/app');
const ASSETS = path.join(OUT, 'assets');

// 「关于」卡片里的版本号是手写的，和 package.json 对不上就会悄悄过期
const pkgVersion = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')).version;
if (pkgVersion !== ABOUT_VERSION) {
  throw new Error(`「关于」卡片版本号 ${ABOUT_VERSION} 与 package.json 的 ${pkgVersion} 不一致，先改成一样`);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(ASSETS, { recursive: true });

await build({
  entryPoints: [path.resolve('apps/server/src/server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: path.join(OUT, 'server.mjs'),
  external: ['electron'],
  logLevel: 'info',
  banner: {
    js: "import { createRequire as __xfyRequire } from 'node:module';\nconst require = __xfyRequire(import.meta.url);",
  },
});

const ASSET_FILES = [
  ['packages/sandbox/src/page-runtime.js', 'page-runtime.js'],
  ['packages/shared/text-clean.js', 'text-clean.js'],
  ['packages/shared/frame-runtime.js', 'frame-runtime.js'],
  ['packages/player/src/player.js', 'player.js'],
  ['packages/agent/prompts/system.md', 'system.md'],
];
for (const [src, name] of ASSET_FILES) {
  copyFileSync(path.resolve(src), path.join(ASSETS, name));
  console.log(`asset: ${name}`);
}

// 兜底：server.mjs 里 readAsset('x') 要的每个文件都必须真的在 assets/ 里，
// 否则打出来的版本会在启动时抛「找不到内置资源」（2.1.0 就漏过 frame-runtime.js）。
const serverCode = readFileSync(path.join(OUT, 'server.mjs'), 'utf8');
const wanted = [...serverCode.matchAll(/readAsset\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
const missing = [...new Set(wanted)].filter((name) => !existsSync(path.join(ASSETS, name)));
if (missing.length > 0) {
  throw new Error(`构建产物缺少静态资源：${missing.join('、')}，请补进 ASSET_FILES`);
}
console.log(`asset: 校验通过（${ASSET_FILES.length} 个资源都在）`);

cpSync(path.resolve('apps/web'), path.join(OUT, 'web'), { recursive: true });
console.log('asset: web/');

// 离线演示：把 开源日志/batch 里已经生成好的案例收进包里，老师双击 index.html 就能看（不用联网）。
// 摊平成 demos/index.html + demos/Q01.html … Q10.html，只收成品动画（约 0.5 MB）；
// shots/、messages.json、run.json 是调试产物，不进包。
const DEMO_SRC = path.resolve('开源日志', 'batch');
const DEMO_OUT = path.join(OUT, 'demos');
const demoIds = existsSync(DEMO_SRC)
  ? readdirSync(DEMO_SRC, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^Q\d+$/.test(d.name))
      .map((d) => d.name)
      .sort()
      .filter((id) => existsSync(path.join(DEMO_SRC, id, 'animation.html')))
  : [];
if (demoIds.length > 0) {
  mkdirSync(DEMO_OUT, { recursive: true });
  for (const id of demoIds) {
    copyFileSync(path.join(DEMO_SRC, id, 'animation.html'), path.join(DEMO_OUT, `${id}.html`));
  }
  const index = path.join(DEMO_SRC, 'index.html');
  if (existsSync(index)) {
    // 总览页的卡片原本链到 ./Q01/animation.html，摊平后改成 ./Q01.html
    let html = readFileSync(index, 'utf8').replace(/\.\/(Q\d+)\/animation\.html/g, './$1.html');
    // 页面底部加一张「关于作者」卡片：内容与软件里、导出页水印共用同一份
    const list = ABOUT_HTML.replace(/<div class="xfy-about-foot">[\s\S]*?<\/div>/, '');
    const block = `
<section id="xfy-author">
  <h2>关于作者</h2>
  <p class="sub">上面这些动画，都是软件用大模型自动生成、并在沙盒里自检过的，没有人工画关键帧。</p>
  ${list}
</section>
<style>
#xfy-author{box-sizing:border-box;max-width:960px;margin:30px auto 48px;padding:24px 28px;background:#fff;
  border:1px solid #dbe3ee;border-radius:14px;box-shadow:0 8px 24px rgba(36,48,68,.08);
  font-family:"Microsoft YaHei","PingFang SC",sans-serif;}
#xfy-author h2{margin:0 0 6px;font-size:16px;color:#1f2a3a;}
#xfy-author h3{margin:2px 0 8px;font-size:15px;color:#1f2a3a;}
#xfy-author h3 span{margin-left:8px;font-size:11.5px;color:#8b98a8;font-weight:400;}
#xfy-author .sub{margin:0 0 14px;font-size:12.5px;color:#8b98a8;line-height:1.7;}
#xfy-author .xfy-about-list{font-size:13px;}
${ABOUT_CSS}
</style>`;
    html = html.replace(/<\/body>/i, block + '</body>');
    writeFileSync(path.join(DEMO_OUT, 'index.html'), html, 'utf8');
  }
  console.log(`asset: demos/（${demoIds.length} 个案例 ${demoIds[0]}–${demoIds.at(-1)} + index.html）`);
} else {
  console.warn('提示：开源日志/batch 里没有成品动画，本次构建不带离线演示');
}

// 把许可文件也带上（打包产物要随身携带）
for (const f of ['LICENSE', 'NOTICE', 'LICENSE-DOCS', 'COMMERCIAL.md', 'TRADEMARK.md']) {
  if (existsSync(path.resolve(f))) {
    copyFileSync(path.resolve(f), path.join(OUT, f));
    console.log(`asset: ${f}`);
  }
}

console.log(`\n构建完成：${OUT}`);
