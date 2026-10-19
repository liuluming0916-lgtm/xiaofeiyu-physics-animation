/**
 * ㉛ 导出取证（第 7 期 §14 / M17）
 *
 * 用户 2026-10-17 改方案：**不做 WebM**，只产出 ① 单文件网页 ② GIF。
 * 本文件把三类判据钉死：
 *
 *   A. 导出网页 —— 必须仍是"模板页另存"：自包含、无外链、无 Key、Provenance 烧录齐全，
 *      并且**真的能在 vm 里跑起来**（window.ODRuntime 就位 = 双击就能播的机器证明）；
 *   B. GIF —— 帧数 = round(duration×fps)+1、末帧落在 duration、帧间隔 = round(1000/fps) ms、
 *      尺寸精确、GIF89a 结构合法（自写解析器逐块走，含帧数/延时）；
 *   C. 服务接口 —— 落盘只走本机同一端口：写得出、取得回、非 GIF 当场拒、跨源当场拒。
 *
 * ⚠ 关于"默认不录曲线图"：曲线图是**另一块画布**，抓帧只抓 stage-canvas，
 *   所以"不录"是默认行为；这里用尺寸断言把它钉住。
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(HERE, '..');

const failures = [];
let passed = 0;
function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? `（${detail}）` : ''}`);
  }
}

/* ══════════════════════════════════════════════════════════════
   最小 GIF 解析器（只走结构，不解 LZW —— 要验的是"我们怎么用"，
   不是 gifenc 的解码正确性；结构对 + 帧数/延时对，才说明用法没错）
   ══════════════════════════════════════════════════════════════ */
function parseGif(input) {
  const b = Buffer.from(input);
  const magic = b.subarray(0, 6).toString('latin1');
  let i = 6;
  const width = b.readUInt16LE(i);
  i += 2;
  const height = b.readUInt16LE(i);
  i += 2;
  const packed = b[i];
  i += 3; // packed + bgIndex + aspect
  const hasGct = Boolean(packed & 0x80);
  if (hasGct) i += 3 * (1 << ((packed & 7) + 1));

  const frames = [];
  let pendingDelayMs = null;
  let sawTrailer = false;
  while (i < b.length) {
    const block = b[i];
    i += 1;
    if (block === 0x3b) {
      sawTrailer = true;
      break;
    }
    if (block === 0x21) {
      const label = b[i];
      i += 1;
      if (label === 0xf9) {
        i += 1; // block size (4)
        i += 1; // flags
        pendingDelayMs = b.readUInt16LE(i) * 10; // 单位 1/100 秒 → ms
        i += 2;
        i += 2; // transparent index + terminator
      } else {
        while (b[i] !== 0) i += 1 + b[i];
        i += 1;
      }
      continue;
    }
    if (block === 0x2c) {
      const left = b.readUInt16LE(i);
      i += 2;
      const top = b.readUInt16LE(i);
      i += 2;
      const w = b.readUInt16LE(i);
      i += 2;
      const h = b.readUInt16LE(i);
      i += 2;
      const pk = b[i];
      i += 1;
      if (pk & 0x80) i += 3 * (1 << ((pk & 7) + 1));
      i += 1; // LZW min code size
      let dataLen = 0;
      while (b[i] !== 0) {
        dataLen += b[i];
        i += 1 + b[i];
      }
      i += 1;
      frames.push({ left, top, width: w, height: h, delayMs: pendingDelayMs ?? 0, dataLen });
      pendingDelayMs = null;
      continue;
    }
    throw new Error(`未知块 0x${block.toString(16)} @ ${i - 1}`);
  }
  return { magic, width, height, hasGct, frames, sawTrailer };
}

/** 造一帧纯色 RGBA（够用：验的是编码口径，不是画质） */
function solidFrame(width, height, [r, g, b]) {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 255;
  }
  return out;
}

export async function main() {
  /* ⚠ 临时目录放**系统临时区**而不是项目根：Windows 上刚落盘的文件句柄有时释放慢，
     rmSync 会失败并留下 `.tmp-export-*` 垃圾（本项目真在根目录留下过 12 个）。
     放 TMP 里即使清不掉也不脏工作区。 */
  const tmp = mkdtempSync(join(tmpdir(), 'od-export-'));
  // ⚠ 必须在 import 之前设：core/export/page.mjs 在模块加载时就把 EXPORT_DIR 定下来了
  process.env.OD_EXPORT_DIR = join(tmp, 'exports');

  const created = [tmp];
  try {
    const exportMod = await import(pathToFileURL(join(PROJECT_ROOT, 'core', 'export', 'page.mjs')).href);
    const q01 = (
      await import(pathToFileURL(join(PROJECT_ROOT, 'tests', 'regression-15', 'q01-conveyor-heat.mjs')).href)
    ).default;

    /* ── A 导出网页 ── */
    console.log('\n『A』导出网页 = 模板页另存（自包含 / 无 Key / Provenance 烧录）');

    const missing = await exportMod.buildExportPage({ slots: { ...q01.slots, drawFrame: '' } });
    check(
      '★ 槽位为空 ⇒ 拒绝（未登记即拒的近亲：空槽不导出）',
      missing.ok === false && missing.code === 'export.bad-slots',
      missing.code,
    );

    const extra = await exportMod.buildExportPage({ slots: { ...q01.slots, EXTRA: 'x' } });
    check('★ 多出未登记槽位 ⇒ 拒绝', extra.ok === false && /未登记的槽位/.test(extra.message));

    const built = await exportMod.buildExportPage({
      slots: q01.slots,
      id: q01.id,
      index: q01.index,
      title: q01.title,
      mode: q01.mode,
      model: 'handwritten',
      promptHash: 'handwritten',
      knowledgecardHash: 'handwritten',
    });
    check('★ 正常导出成功', built.ok === true, built.message);
    if (!built.ok) throw new Error('导出页构建失败，后续断言无法进行');

    const html = built.html;
    check('产物是单文件页（>100 KB 且含 PROGRAM_DATA）', built.bytes > 100 * 1024 && html.includes('PROGRAM_DATA'));
    check(
      '★ 完全自包含：没有任何 http(s) 外链',
      !/(?:src|href)\s*=\s*["']https?:\/\//i.test(html.replace(/xmlns(:\w+)?="[^"]*"/g, '')),
    );
    check('★ 没有 <script src> 外链脚本', !/<script[^>]+src=/i.test(html));
    check('★ 不含任何 Key 字样', !/apiKey|"keys"\s*:/.test(html));

    check('★ Provenance：模板版本', /模板 v\d/.test(built.provenance), built.provenance);
    check('★ Provenance：SDK 版本', /SDK v\d/.test(built.provenance));
    check('★ Provenance：模型', /model: handwritten/.test(built.provenance));
    check('★ Provenance：prompt 哈希', /prompt: handwritten/.test(built.provenance));
    check('★ Provenance：词条哈希', /knowledgecard: handwritten/.test(built.provenance));
    check('★ Provenance 写进了页面（不是只返回给前端）', html.includes(built.provenance));
    check(
      'Provenance 缺值时不编造（写"未记录"）',
      (await exportMod.buildExportPage({ slots: q01.slots })).provenance.includes('未记录'),
    );

    check(
      '★ 8 个槽位都内联进了载荷',
      ['PROBLEM', 'STEPS', 'ANSWERS', 'VIEW', 'setup', 'stateAt', 'drawFrame', 'readouts'].every((k) =>
        html.includes(`"${k}"`),
      ),
    );
    check(
      '公式做了构建期预渲染（有 mjx-container）',
      html.includes('<mjx-container') || built.renderer === null,
      String(built.renderer),
    );

    /* 真的能跑起来：在 vm 里执行内联脚本，断言运行时注入了 */
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    let runtimeOk = false;
    const runtimeCode = scripts.find((s) => s.includes('window.ODRuntime = Runtime'));
    if (runtimeCode) {
      const sandbox = { window: {}, globalThis: undefined, console };
      sandbox.globalThis = sandbox;
      vm.createContext(sandbox);
      try {
        new vm.Script(runtimeCode).runInContext(sandbox);
        runtimeOk = Boolean(
          sandbox.window.ODRuntime && typeof sandbox.window.ODRuntime.createPlayerFromFactory === 'function',
        );
      } catch {
        runtimeOk = false;
      }
    }
    check('★★ 导出的页面在 vm 里能注入运行时（双击可播的机器证明）', runtimeOk);
    check('内联运行时恰好一份（没有重复注入）', (html.match(/window\.ODRuntime = Runtime/g) || []).length === 1);

    const saved = await exportMod.exportPageToDisk({
      slots: q01.slots,
      id: q01.id,
      title: q01.title,
      model: 'handwritten',
    });
    check('★ 落盘成功且文件真的在', saved.ok === true && existsSync(saved.file), saved.file);
    check('产物 URL 走本机服务（/exports/…）', /^\/exports\/.+\.html$/.test(saved.url), saved.url);
    check('清单里能查到刚导出的那一份', exportMod.listExports().some((x) => x.name === saved.name));

    /* ── B GIF ── */
    console.log('\n『B』GIF：帧数 / 末帧 / 帧间隔 / 尺寸（默认 25 fps · 960×540）');
    const gif = await import(pathToFileURL(join(PROJECT_ROOT, 'web', 'src', 'lib', 'gif-encode.js')).href);

    check(
      '默认值：25 fps / 960×540',
      gif.DEFAULT_GIF_FPS === 25 && gif.DEFAULT_GIF_WIDTH === 960 && gif.DEFAULT_GIF_HEIGHT === 540,
    );

    const times = gif.frameTimes(2.0, 25);
    check('★ 帧数 = round(duration×fps) + 1（2.00 s × 25 fps ⇒ 51 帧）', times.length === 51, String(times.length));
    check('★ 首帧 t = 0', times[0] === 0);
    check(
      '★ 末帧 t = duration（末帧必须落在结尾，否则"首末帧一致"不成立）',
      Math.abs(times[times.length - 1] - 2.0) < 1e-9,
      String(times[times.length - 1]),
    );
    check('帧间隔 = 1/fps', Math.abs(times[1] - times[0] - 0.04) < 1e-9);

    const W = 32;
    const H = 18;
    const gifBytes = gif.encodeGif(
      [solidFrame(W, H, [255, 255, 255]), solidFrame(W, H, [200, 30, 30]), solidFrame(W, H, [20, 90, 170])],
      { width: W, height: H, fps: 25 },
    );
    const parsed = parseGif(gifBytes);
    check('★ 产物是合法 GIF89a', parsed.magic === 'GIF89a', parsed.magic);
    check('★ 尺寸精确等于请求尺寸', parsed.width === W && parsed.height === H, `${parsed.width}×${parsed.height}`);
    check('★ 帧数等于给进去的帧数（3）', parsed.frames.length === 3, String(parsed.frames.length));
    check(
      '★ 每帧延时 = round(1000/25) = 40 ms',
      parsed.frames.every((f) => f.delayMs === 40),
      parsed.frames.map((f) => f.delayMs).join(','),
    );
    check('★ 结构完整（有全局色表、有结束块 0x3B）', parsed.hasGct === true && parsed.sawTrailer === true);
    check('每帧都带了像素数据', parsed.frames.every((f) => f.dataLen > 0));

    const gif20 = parseGif(gif.encodeGif([solidFrame(W, H, [0, 0, 0])], { width: W, height: H, fps: 20 }));
    check('换帧率 ⇒ 延时跟着变（20 fps ⇒ 50 ms）', gif20.frames[0]?.delayMs === 50, String(gif20.frames[0]?.delayMs));

    let sizeErr = '';
    try {
      gif.encodeGif([solidFrame(4, 4, [0, 0, 0])], { width: W, height: H, fps: 25 });
    } catch (err) {
      sizeErr = String(err.message);
    }
    check('★ 帧尺寸不符 ⇒ 立刻报错（不产出半坏文件）', /≠/.test(sizeErr), sizeErr);

    let emptyErr = '';
    try {
      gif.encodeGif([], { width: W, height: H, fps: 25 });
    } catch (err) {
      emptyErr = String(err.message);
    }
    check('零帧 ⇒ 报错', /没有帧/.test(emptyErr), emptyErr);

    /* ── C 服务接口 ── */
    console.log('\n『C』落盘只走本机同一端口（/api/export/*）：写得出 / 取得回 / 非法当场拒');
    const { createRulesService } = await import(
      pathToFileURL(join(PROJECT_ROOT, 'tools', 'rules-service.mjs')).href
    );
    const rulesRoot = join(tmp, 'rules');
    const svc = createRulesService({ port: 0, root: rulesRoot, serveStatic: true });
    /* ⚠ 这是项目自己的封装：listen() 无参、返回 Promise<真实端口>，
       不是 node 的 server.listen(port, host, cb)。写成后者会永久挂住（踩过）。 */
    const port = await svc.listen();
    const base = `http://127.0.0.1:${port}`;

    try {
      const postJson = (path, body) =>
        fetch(`${base}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: base },
          body: JSON.stringify(body),
        });

      const list0 = await (await fetch(`${base}/api/exports`, { headers: { origin: base } })).json();
      check('GET /api/exports 有响应且形如 { ok, items }', list0.ok === true && Array.isArray(list0.items));
      check(
        '服务与自检用的是**同一个**导出目录',
        list0.dir === exportMod.EXPORT_DIR,
        `service=${list0.dir} · test=${exportMod.EXPORT_DIR}`,
      );

      const pageRes = await postJson('/api/export/page', {
        slots: q01.slots,
        id: q01.id,
        title: q01.title,
        model: 'handwritten',
      });
      const pageData = await pageRes.json();
      check('★ POST /api/export/page 成功', pageData.ok === true, JSON.stringify(pageData.issues ?? ''));
      check('返回可打开的 URL 与字节数', /^\/exports\/.+\.html$/.test(pageData.url ?? '') && pageData.bytes > 100 * 1024);

      const pageGet = await fetch(`${base}${pageData.url}`);
      const pageText = await pageGet.text();
      check(
        '★ 取回导出的网页：200 + text/html + 内容对得上',
        pageGet.status === 200 &&
          /text\/html/.test(pageGet.headers.get('content-type') ?? '') &&
          pageText.includes('PROGRAM_DATA'),
        `status=${pageGet.status} ct=${pageGet.headers.get('content-type')} len=${pageText.length}`,
      );

      const gifRes = await fetch(`${base}/api/export/gif?name=animation.gif`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', origin: base },
        body: gifBytes,
      });
      const gifData = await gifRes.json();
      check('★ POST /api/export/gif 成功（二进制原样收下）', gifData.ok === true, JSON.stringify(gifData.issues ?? ''));
      check('GIF 落盘后字节数一致', gifData.bytes === gifBytes.length, `${gifData.bytes} vs ${gifBytes.length}`);

      const gifGet = await fetch(`${base}${gifData.url}`);
      const gifBack = Buffer.from(await gifGet.arrayBuffer());
      check(
        '★ 取回 GIF：200 + 内容逐字节一致',
        gifGet.status === 200 && gifBack.length === gifBytes.length && gifBack.equals(Buffer.from(gifBytes)),
      );

      const badGif = await fetch(`${base}/api/export/gif?name=x.gif`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', origin: base },
        body: Buffer.from('这不是 GIF'),
      });
      const badData = await badGif.json();
      check(
        '★ 非 GIF 字节 ⇒ 400 且不落盘',
        badGif.status === 400 && badData.issues?.[0]?.code === 'export.not-gif',
        JSON.stringify(badData.issues ?? ''),
      );

      const crossOrigin = await fetch(`${base}/api/export/page`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
        body: JSON.stringify({ slots: q01.slots }),
      });
      check('★ 跨源写操作 ⇒ 403（Origin 校验没被放宽）', crossOrigin.status === 403);

      const list1 = await (await fetch(`${base}/api/exports`, { headers: { origin: base } })).json();
      check(
        '清单随导出增长（A 一次 + C 两次 ⇒ ≥3）',
        (list1.items?.length ?? 0) >= 3,
        `${list1.items?.length} 条：${(list1.items ?? []).map((x) => x.name).join(', ')}`,
      );
    } finally {
      await svc.close();
    }

    /* ── D 边界 ── */
    console.log('\n『D』边界：产物落 exports/，绝不写进 ai-rules/');
    const exportDirFiles = exportMod.listExports().map((x) => x.name);
    check(
      '★ 导出产物都在导出目录里',
      exportDirFiles.length >= 2 && exportDirFiles.every((n) => /\.(html|gif)$/.test(n)),
      exportDirFiles.join(','),
    );
    check('导出目录不在 ai-rules 下', !exportMod.EXPORT_DIR.includes('ai-rules'), exportMod.EXPORT_DIR);
  } finally {
    for (const d of created) {
      /* Windows 上句柄有时释放慢，重试几次；仍然失败就算了（放在系统 TMP 里，不脏工作区） */
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          rmSync(d, { recursive: true, force: true });
          break;
        } catch {
          if (attempt === 2) break;
        }
      }
    }
    delete process.env.OD_EXPORT_DIR;
  }

  console.log(
    failures.length
      ? `\n✗ 导出取证：通过 ${passed} 条，失败 ${failures.length} 条\n\n失败明细：\n${failures
          .map((f) => `  ✗ ${f.name}${f.detail ? `\n      ${f.detail}` : ''}`)
          .join('\n')}\n`
      : `\n✓ 导出取证：通过 ${passed} 条，失败 0 条\n`,
  );
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
