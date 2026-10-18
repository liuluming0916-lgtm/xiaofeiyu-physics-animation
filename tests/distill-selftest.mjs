/**
 * ㉜ 教辅蒸馏取证（第 7 期 §15 / M19 简版）
 *
 * 用户裁决：**不做 PDF**，只做"丢图片 / 粘文字 → distill（视觉模型）→ 候选词条 → 人工确认 → 入库"。
 *
 * 本门禁钉的是**判据本身**，不联网（模型用注入的假 collect）：
 *   A. 成本预估：页数 × 单页 token（只报 token，不编钱）
 *   B. 消息组装：system = 可编辑的 distill Prompt；任务段带输出契约；**图片只进任务段**
 *   C. 解析：合法 JSON / 带围栏带闲话 / 完全没 JSON / 缺字段 —— 四种都要有确定结论
 *   D. 视觉门控：端点 supportsVision=false ⇒ 读图当场拒（契约第 7 条）
 *   E. 会话：页级状态可落盘、可续做（done 的页不会被当成 pending）
 *   F. 入库：**绝不自动入库**；空选择拒；坏词条整批失败且不落盘；好词条进 pack 后可被读回
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

export async function main() {
  const tmp = mkdtempSync(join(PROJECT_ROOT, '.tmp-distill-'));
  process.env.OD_DISTILL_DIR = join(tmp, 'sessions');
  try {
    const D = await import(pathToFileURL(join(PROJECT_ROOT, 'core', 'distill', 'index.mjs')).href);
    const { buildUserMessage } = await import(pathToFileURL(join(PROJECT_ROOT, 'core', 'gateway', 'index.mjs')).href);
    const wb = await import(pathToFileURL(join(PROJECT_ROOT, 'core', 'worldbook', 'index.mjs')).href);

    /* ── A 成本预估 ── */
    console.log('\n『A』成本预估：页数 × 单页 token（只报 token，不编单价）');
    const est3 = D.estimateCost({ pages: [{ kind: 'image' }, { kind: 'image' }, { kind: 'image' }] });
    check('★ 3 张图 ⇒ 输入 3×1400 tokens', est3.tokensIn === 3 * D.TOKEN_BUDGET.imagePage, String(est3.tokensIn));
    check('★ 输出按每页 700 估', est3.tokensOut === 3 * D.TOKEN_BUDGET.outputPerPage, String(est3.tokensOut));
    check('预估文案里带页数与 token 数', /3 页/.test(est3.note) && /tokens/.test(est3.note));
    const estText = D.estimateCost({ pages: [{ kind: 'text', chars: 1600 }] });
    check('文字页按字数折算（1600 字 ⇒ 1000 tokens）', estText.tokensIn === 1000, String(estText.tokensIn));
    check('不报金额（单位里没有货币符号）', !/[¥$€]/.test(est3.note), est3.note);

    /* ── B 消息组装 ── */
    console.log('\n『B』消息组装：system = 可编辑 Prompt；任务段带输出契约');
    const messages = D.buildDistillMessages({
      promptText: '我是 distill prompt',
      page: { kind: 'text', text: '某页教辅文字' },
      pageIndex: 0,
      pageCount: 2,
      buildUserMessage,
    });
    check('★ 两条消息：system + user', messages.length === 2 && messages[0].role === 'system' && messages[1].role === 'user');
    check('★ system 就是 Prompt 原文（用户改了立刻生效）', messages[0].content === '我是 distill prompt');
    check('★ 任务段带页序号（页级进度靠它）', /第 1 \/ 2 页/.test(String(messages[1].content)));
    check('★ 任务段带输出契约（JSON 形状写清楚）', /"entries"/.test(String(messages[1].content)));
    check('文字页的 content 是字符串（兼容性最好）', typeof messages[1].content === 'string');

    /* ── C 解析 ── */
    console.log('\n『C』解析模型输出：四种形态都要有确定结论');
    const good = D.parseDistillOutput(
      '{"entries":[{"title":"滑动摩擦判据","keys":["μ","摩擦"],"slot":"solve","content":"$f=\\mu N$"}]}',
    );
    check('★ 合法 JSON ⇒ 1 条候选', good.entries.length === 1 && good.issues.length === 0);
    check('候选带 title/keys/content/slot', good.entries[0].title === '滑动摩擦判据' && good.entries[0].keys.length === 2 && good.entries[0].slot === 'solve');

    const chatty = D.parseDistillOutput('好的，结果如下：\n```json\n{"entries":[{"title":"t","keys":["k"],"content":"c"}]}\n```\n希望有帮助！');
    check('★ 带围栏、带闲话也照样解析出来', chatty.entries.length === 1, JSON.stringify(chatty.issues));

    /* ★ 真实高频故障：模型在 JSON 里写 LaTeX 常只写 \mu 而不是 \\mu，
       `\m` 不是合法转义 ⇒ 原生 JSON.parse 必炸。这里必须靠"修反斜杠再试一次"救回来。 */
    const latex = D.parseDistillOutput('{"entries":[{"title":"摩擦","keys":["μ"],"content":"$f=\\mu N$ 方向相反"}]}');
    check('★ LaTeX 反斜杠没转义也能救回来（不丢整页）', latex.entries.length === 1, JSON.stringify(latex.issues));
    check('救回来之后 LaTeX 内容完整', /\$f=\\mu N\$/.test(String(latex.entries[0]?.content)), String(latex.entries[0]?.content));

    const noJson = D.parseDistillOutput('这一页我看不清');
    check('★ 没有 JSON ⇒ 明确报 distill.no-json（不静默丢）', noJson.issues[0]?.code === 'distill.no-json');
    check('失败时保留原文（人能看到模型到底说了什么）', /看不清/.test(String(noJson.issues[0]?.raw)));

    const partial = D.parseDistillOutput('{"entries":[{"title":"缺键","content":"c"},{"title":"好","keys":["k"],"content":"c"}]}');
    check('缺 keys 的候选被跳过并给 issue', partial.entries.length === 1 && partial.issues.length === 1);
    check('slot 非法值归一到 solve', D.parseDistillOutput('{"entries":[{"title":"t","keys":["k"],"content":"c","slot":"乱写"}]}').entries[0].slot === 'solve');
    check('空输出 ⇒ distill.empty', D.parseDistillOutput('   ').issues[0]?.code === 'distill.empty');

    /* ── D 视觉门控 ── */
    console.log('\n『D』视觉门控：读图必须 supportsVision（契约第 7 条）');
    check('★ 端点不支持视觉 ⇒ 拒绝读图', D.assertVisionReady({ id: 'e1', supportsVision: false }).code === 'distill.needs-vision');
    check('★ 没有端点 ⇒ 明确拒绝', D.assertVisionReady(null).code === 'distill.no-endpoint');
    check('支持视觉 ⇒ 放行', D.assertVisionReady({ id: 'v', supportsVision: true }).ok === true);
    check('纯文字页不需要视觉能力', D.assertVisionReady({ id: 'x', supportsVision: false }, { needsImage: false }).ok === true);

    /* ── E 单页蒸馏（注入假 collect，不联网） ── */
    console.log('\n『E』单页蒸馏：成功 / 失败 / 门控 三条路');
    const base = { promptText: 'p', pageCount: 1, buildUserMessage };
    const ok1 = await D.distillPage({
      ...base,
      endpoint: { id: 'v', supportsVision: true },
      apiKey: 'k',
      page: { kind: 'text', text: 'x' },
      collect: async () => ({ text: '{"entries":[{"title":"t","keys":["k"],"content":"c"}]}' }),
    });
    check('★ 成功 ⇒ ok + 1 条候选', ok1.ok === true && ok1.entries.length === 1);
    check('成功时保留模型原文（便于复核）', /entries/.test(String(ok1.raw)));

    const bad = await D.distillPage({
      ...base,
      endpoint: { id: 'v', supportsVision: true },
      apiKey: 'k',
      page: { kind: 'text', text: 'x' },
      collect: async () => {
        throw new Error('网络断了');
      },
    });
    check('★ 调用失败 ⇒ ok:false 且带 distill.call-failed', bad.ok === false && bad.code === 'distill.call-failed');
    check('失败信息里能看出原因', /网络断了/.test(String(bad.message)));

    const gated = await D.distillPage({
      ...base,
      endpoint: { id: 'nv', supportsVision: false },
      apiKey: 'k',
      page: { kind: 'image', image: { mime: 'image/png', data: 'x' } },
      collect: async () => ({ text: '{}' }),
    });
    check('★ 视觉不达标 ⇒ 在调用模型之前就被拦下', gated.ok === false && gated.code === 'distill.needs-vision');

    /* ── F 会话：页级状态与续做 ── */
    console.log('\n『F』会话：页级进度可落盘、可中断续做');
    const session = D.createSession({ title: '第 5 期教辅试样', pages: [{ kind: 'image' }, { kind: 'image' }, { kind: 'text', chars: 800 }] });
    check('★ 建会话：3 页全部 pending', session.pages.length === 3 && session.pages.every((p) => p.status === 'pending'));
    check('会话自带成本预估', session.estimate.pages === 3);

    D.applyPageResult({ session, pageIndex: 0, entries: [{ title: 'a', keys: ['k'], content: 'c' }], issues: [] });
    const reloaded = D.loadSession({ id: session.id });
    check('★ 第 1 页标为 done 并落盘', reloaded.pages[0].status === 'done' && reloaded.pages[0].entries.length === 1);
    check('★ 其余页仍是 pending（续做时只跑没做的）', reloaded.pages[1].status === 'pending' && reloaded.pages[2].status === 'pending');

    D.applyPageResult({ session: reloaded, pageIndex: 1, entries: [], issues: [{ code: 'distill.no-json', message: '看不清' }], status: 'failed' });
    const afterFail = D.loadSession({ id: session.id });
    check('★ 失败页标为 failed 且保留原因（不静默跳过）', afterFail.pages[1].status === 'failed' && afterFail.pages[1].issues.length === 1);

    const listed = D.listSessions();
    check('清单能列出会话并统计完成/失败页', listed.some((s) => s.id === session.id && s.done === 1 && s.failed === 1), JSON.stringify(listed[0]));

    /* ── G 入库：必须人工确认，且整批校验 ── */
    console.log('\n『G』入库：绝不自动、空选择拒、坏词条整批失败');
    const rulesDir = join(tmp, 'rules');

    const empty = D.commitCandidates({ dir: rulesDir, sessionId: session.id, picks: [] });
    check('★ 没勾选 ⇒ 拒绝（不会"顺手全入库"）', empty.ok === false && empty.issues[0]?.code === 'distill.nothing-picked');

    const badPick = D.commitCandidates({ dir: rulesDir, sessionId: session.id, picks: [{ title: '', keys: ['k'], content: 'c' }] });
    check('★ 坏词条（空标题）⇒ 整批拒绝', badPick.ok === false && badPick.issues.length > 0, JSON.stringify(badPick.issues));
    check('★ 拒绝时**没有**写任何文件（不留半截）', !existsSync(join(rulesDir, 'worldbook')) || readdirSync(join(rulesDir, 'worldbook')).length === 0);

    const committed = D.commitCandidates({
      dir: rulesDir,
      sessionId: session.id,
      picks: [
        { title: '滑动摩擦判据', keys: ['摩擦', 'μ'], slot: 'solve', content: '$f=\\mu N$，方向与相对运动相反。' },
        { title: '传送带共速判据', keys: ['传送带', '共速'], slot: 'scene_code', content: '相对速度为零即共速。' },
      ],
      packName: 'distill-sample',
    });
    check('★ 勾选 2 条 ⇒ 入库成功', committed.ok === true, JSON.stringify(committed.issues ?? ''));
    check('入库产物是词条包（.json）', /\.json$/.test(String(committed.name)), String(committed.name));

    const back = wb.readWorldbookPack({ dir: rulesDir, name: committed.name });
    check('★ 写进去的包能被读回（结构合规）', back.ok !== false, JSON.stringify(back.issues ?? ''));
    const entries = back.entries ?? back.pack?.entries ?? [];
    check('★ 两条词条都在，且 origin=user', entries.length === 2 && entries.every((e) => e.origin === 'user'));
    check('★ insertion_slot 是数组且合法', entries.every((e) => Array.isArray(e.insertion_slot) && e.insertion_slot.length >= 1));
    check('词条 id 带会话前缀（不会撞车）', entries.every((e) => String(e.id).startsWith('ds-')), entries.map((e) => e.id).join(','));
    check('category 取 user_lore', entries.every((e) => e.category === 'user_lore'), entries.map((e) => e.category).join(','));

    /* ── H 边界 ── */
    console.log('\n『H』边界：候选只在 distill-sessions/，不碰规则目录');
    check('★ 会话目录不在 ai-rules 下', !D.SESSION_DIR.includes('ai-rules'), D.SESSION_DIR);
    check('会话文件确实写在会话目录里', readdirSync(D.SESSION_DIR).some((f) => f.startsWith(session.id)));

    /* ── I 服务接口（HTTP 层）──
       ⚠ 这一节是被真实故障补出来的：㉜ 最初只测核心模块、**没测 HTTP 路由**，
         于是"前端报 `没有这个接口：POST /api/distill/sessions`"这种问题门禁完全看不见
         （真实原因当时是用户的服务进程还是旧代码，但路由漏挂也会是同样表现）。
         所以：路由必须真的打一遍，走真实 127.0.0.1 端口。 */
    console.log('\n『I』服务接口：/api/distill/* 真打（路由挂了这里就会红）');
    const { createRulesService } = await import(
      pathToFileURL(join(PROJECT_ROOT, 'tools', 'rules-service.mjs')).href
    );
    const svc = createRulesService({ port: 0, root: join(tmp, 'rules-http'), serveStatic: false });
    const port = await svc.listen();
    /* ⚠ 变量名别用 `base`：上面『E』里已经有一个 `base`（消息组装的入参），会撞名。 */
    const httpBase = `http://127.0.0.1:${port}`;
    const jsonHeaders = { 'content-type': 'application/json', origin: httpBase };
    try {
      const created = await fetch(`${httpBase}/api/distill/sessions`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ title: 'http 用例', pages: [{ kind: 'image' }, { kind: 'text', chars: 500 }] }),
      });
      const createdBody = await created.json();
      check('★ POST /api/distill/sessions ⇒ 200 且回会话', created.status === 200 && createdBody.ok === true, String(created.status));
      check('★ 建会话的响应里带成本预估（前端直接显示）', /tokens/.test(String(createdBody.session?.estimate?.note)), String(createdBody.session?.estimate?.note));

      const listRes = await fetch(`${httpBase}/api/distill/sessions`, { headers: { origin: httpBase } });
      const listBody = await listRes.json();
      check('GET /api/distill/sessions ⇒ 200 且能列出刚建的那条', listRes.status === 200 && (listBody.items?.length ?? 0) >= 1);

      const oneRes = await fetch(`${httpBase}/api/distill/sessions/${createdBody.session?.id}`, { headers: { origin: httpBase } });
      const oneBody = await oneRes.json();
      check('GET /api/distill/sessions/:id ⇒ 200 且页数与提交一致', oneRes.status === 200 && oneBody.session?.pages?.length === 2);

      const commitRes = await fetch(`${httpBase}/api/distill/commit`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ sessionId: createdBody.session?.id, picks: [] }),
      });
      const commitBody = await commitRes.json();
      check(
        '★ POST /api/distill/commit（空选择）⇒ 400 且给出 distill.nothing-picked',
        commitRes.status === 400 && commitBody.issues?.[0]?.code === 'distill.nothing-picked',
        JSON.stringify(commitBody.issues ?? ''),
      );

      const cross = await fetch(`${httpBase}/api/distill/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
        body: JSON.stringify({ pages: [] }),
      });
      check('★ 跨源建会话 ⇒ 403（Origin 校验没被放宽）', cross.status === 403, String(cross.status));
    } finally {
      await svc.close();
    }
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* 临时目录清不掉不影响结论 */
    }
    delete process.env.OD_DISTILL_DIR;
  }

  console.log(
    failures.length
      ? `\n✗ 教辅蒸馏取证：通过 ${passed} 条，失败 ${failures.length} 条\n\n失败明细：\n${failures
          .map((f) => `  ✗ ${f.name}${f.detail ? `\n      ${f.detail}` : ''}`)
          .join('\n')}\n`
      : `\n✓ 教辅蒸馏取证：通过 ${passed} 条，失败 0 条\n`,
  );
  if (failures.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`✗ ${err?.stack ?? err}`);
    process.exit(1);
  });
}
