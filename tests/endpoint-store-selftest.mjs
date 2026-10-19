#!/usr/bin/env node
/**
 * 端点配置取证（第 6 期第 4 项 · §11.1 / §11.2 / §16）。
 *
 * 用户裁决：**Key 单独存**（`ai-rules/keys.json`），可导出的那份配置里**永远没有** Key。
 *
 * 本文件钉住四件事：
 *   A 两份文件的分工：endpoints.json 里搜不到 Key，keys.json 里才有（负对照：证明不是"什么都没存"）；
 *   B **导出不含任何 Key**：不是"导出时过滤"，而是"导出函数根本不读它"，外加一道自证；
 *   C 导入的三种拒绝：版本不对 / 带 Key / 判据不过；
 *   D **测试连接**：真的发一个最小请求（本地假服务），并把 §11.2 那句提示原样带出来。
 *
 * ⚠ 全部在临时目录里，不碰仓库真实的 `ai-rules/`。
 *
 * 用法：node tests/endpoint-store-selftest.mjs
 */

import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { isCliEntry } from '../tools/paths.mjs';
import {
  CONNECTION_TEST_NOTICE,
  assertNoSecrets,
  clearKey,
  exportEndpointsText,
  importEndpoints,
  isTransportAllowed,
  loadEndpointStore,
  loadKeys,
  parseImportEndpoints,
  probeUrl,
  removeEndpoint,
  saveEndpoints,
  saveKeys,
  setKey,
  setStageModel,
  testConnection,
  upsertEndpoint,
} from '../core/gateway/index.mjs';
import { validateEndpointConfig } from '../contracts/validate.mjs';

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const created = [];
function freshDir() {
  const d = mkdtempSync(join(tmpdir(), 'od-endpoint-'));
  created.push(d);
  return d;
}

const has = (list, code) => (list ?? []).some((x) => x.code === code);
const find = (list, code) => (list ?? []).find((x) => x.code === code) ?? null;

/** 一个合法端点 */
function endpoint(over = {}) {
  return {
    id: 'ep_local',
    displayName: '本地推理',
    baseURL: 'http://127.0.0.1:11434/v1',
    defaultModel: 'local-model',
    visionModel: '',
    apiKeyModelId: null,
    supportsJsonMode: true,
    supportsVision: false,
    enableThinking: false,
    preserveThinking: false,
    timeoutMs: 120000,
    ...over,
  };
}

const KEY_A = 'sk-AAA1111222233334444';
const KEY_B = 'sk-BBB5555666677778888';

/** 起一个本地假端点，返回 baseURL 与关闭函数 */
async function startServer(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: async () => {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function main() {
  console.log('端点配置取证（第 6 期第 4 项 · §11 / §16）\n');

  try {
    /* ────────────────────────────── 『A』两份文件的分工 ────────────────────────────── */

    console.log('『A』Key 单独存：endpoints.json 里根本搜不到它');
    {
      const dir = freshDir();
      const missing = loadEndpointStore({ dir });
      check('没有配置时明确报"没有端点配置"（而不是空配置冒充）', missing.ok === false && has(missing.issues, 'endpoints.missing'));

      const init = saveEndpoints({ dir, endpoints: [], stageModels: {} });
      check('建立空配置成功', init.ok === true, JSON.stringify(init.issues));
      check('空配置的 endpoints.json 里 keys 是空对象', JSON.parse(readFileSync(join(dir, 'endpoints.json'), 'utf8')).keys !== undefined);
      check('keys.json 还不存在（不凭空造文件）', loadKeys({ dir }).exists === false);

      saveEndpoints({ dir, endpoints: [endpoint(), endpoint({ id: 'ep_remote', displayName: '远端', baseURL: 'https://api.example.com/v1' })], stageModels: { solve: 'ep_local' } });
      const k1 = setKey({ dir, id: 'ep_local', key: KEY_A });
      const k2 = setKey({ dir, id: 'ep_remote', key: KEY_B });
      check('两个端点各自设 Key 成功', k1.ok && k2.ok, JSON.stringify([k1.issues, k2.issues]));

      const loaded = loadEndpointStore({ dir });
      check('载入时把两份文件合并成完整配置', loaded.ok === true && loaded.keys.ep_local === KEY_A && loaded.keys.ep_remote === KEY_B);
      check('（对照）合并后的配置本身就带 keys（契约要求这个字段）', Object.keys(loaded.config.keys).length === 2);

      const endpointsText = readFileSync(join(dir, 'endpoints.json'), 'utf8');
      const keysText = readFileSync(join(dir, 'keys.json'), 'utf8');
      check('★ endpoints.json 里**搜不到** Key（结构性分离）', !endpointsText.includes(KEY_A) && !endpointsText.includes(KEY_B));
      check('★ endpoints.json 里 keys 恒为空对象', /"keys":\s*\{\s*\}/.test(endpointsText));
      check('（负对照）keys.json 里**确实有** Key（证明上一条不是"什么都没存"）', keysText.includes(KEY_A) && keysText.includes(KEY_B));
      check('keys.json 带格式标识与版本（坏文件能一眼认出来）', keysText.includes('od-endpoint-keys') && keysText.includes('"version": 1'));
      check('载入还给出了两份文件的哈希（供乐观锁与审计）', /^[0-9a-f]{64}$/.test(loaded.hashes.endpoints) && /^[0-9a-f]{64}$/.test(loaded.hashes.keys));
    }

    /* ────────────────────────────── 『B』导出绝不含 Key ────────────────────────────── */

    console.log('\n『B』导出：结构性地不含 Key');
    {
      const dir = freshDir();
      saveEndpoints({ dir, endpoints: [endpoint()], stageModels: { solve: 'ep_local' } });
      setKey({ dir, id: 'ep_local', key: KEY_A });
      const loaded = loadEndpointStore({ dir });

      const out = exportEndpointsText({
        endpoints: loaded.config.endpoints,
        stageModels: loaded.config.stageModels,
        knownKeys: Object.values(loaded.keys),
      });
      check('导出成功', typeof out.text === 'string' && out.bytes > 0);
      check('★ 导出文本里没有 Key 值', !out.text.includes(KEY_A));
      check('★ 导出文本里没有 sk- 形态的字符串', !/sk-[A-Za-z0-9_-]{8,}/.test(out.text));
      check('导出的 keys 是空对象', /"keys":\s*\{\s*\}/.test(out.text));
      check('导出的配置本身是合法契约（能通过九条判据）', validateEndpointConfig(JSON.parse(out.text)).ok === true);
      check('导出给了哈希（用于"甲导出的 == 乙导出的"）', /^[0-9a-f]{64}$/.test(out.hash));

      // 自证必须有牙齿：拿一段**故意含 Key** 的文本喂给它
      let code = '';
      try {
        assertNoSecrets(`{"keys":{"ep_local":"${KEY_A}"}}`, [KEY_A]);
      } catch (e) {
        code = e.code;
      }
      check('★ 负对照：自证在文本含 Key 时确实抛（不是摆设）', code === 'endpoints.key-leak', code);

      let code2 = '';
      try {
        assertNoSecrets('{"note":"sk-ZZZ999988887777666"}');
      } catch (e) {
        code2 = e.code;
      }
      check('★ 自证也认得"没见过的"Key 形态（sk- 前缀）', code2 === 'endpoints.key-leak', code2);
    }

    /* ────────────────────────────── 『C』导入的三种拒绝 ────────────────────────────── */

    console.log('\n『C』导入：版本 / 带 Key / 判据，各给明确理由');
    {
      const dir = freshDir();
      saveEndpoints({ dir, endpoints: [endpoint()], stageModels: { solve: 'ep_local' } });
      setKey({ dir, id: 'ep_local', key: KEY_A });
      const loaded = loadEndpointStore({ dir });
      const good = exportEndpointsText({ endpoints: loaded.config.endpoints, stageModels: loaded.config.stageModels });

      const ok = parseImportEndpoints(good.text);
      check('导入自己的导出包：通过', ok.ok === true, JSON.stringify(ok.issues));

      const withKeys = parseImportEndpoints(JSON.stringify({ configVersion: 1, endpoints: [endpoint()], stageModels: {}, keys: { ep_local: KEY_A } }));
      check('★ 导入包带 Key ⇒ 拒绝', withKeys.ok === false && has(withKeys.issues, 'endpoints.keys-not-allowed'));
      const p = find(withKeys.issues, 'endpoints.keys-not-allowed');
      check('★ 拒绝时说明"导入包不应含任何 Key"，而不是静默丢掉', /不应含任何 Key/.test(p?.message ?? ''), p?.message);

      const badVer = parseImportEndpoints(JSON.stringify({ configVersion: 2, endpoints: [], stageModels: {}, keys: {} }));
      check('版本 2 ⇒ 明确拒绝（不猜新版本语义）', badVer.ok === false && has(badVer.issues, 'endpoints.bad-version'));

      const broken = parseImportEndpoints('{\n  "configVersion": 1,\n  "endpoints": [\n');
      check('坏 JSON ⇒ 拒绝并给位置', broken.ok === false && /第 \d+ 行/.test(find(broken.issues, 'endpoints.bad-json')?.message ?? ''), find(broken.issues, 'endpoints.bad-json')?.message);

      const badShape = parseImportEndpoints(JSON.stringify({ configVersion: 1, endpoints: [endpoint({ baseURL: 'http://example.com/v1' })], stageModels: {}, keys: {} }));
      check('判据不过（http 非本机）⇒ 拒绝', badShape.ok === false && has(badShape.issues, 'endpoint.url.https-required'));

      // 导入写盘：不动已有 Key
      const before = loadKeys({ dir }).keys;
      const imported = importEndpoints({ dir, text: good.text });
      check('导入写盘成功', imported.ok === true, JSON.stringify(imported.issues));
      check('★ 导入**不会**清空或改动已有的 Key', JSON.stringify(loadKeys({ dir }).keys) === JSON.stringify(before));
    }

    /* ────────────────────────────── 『D』九条判据（抽样） ────────────────────────────── */

    console.log('\n『D』九条判据：在"保存"这条路上也拦');
    {
      const dir = freshDir();
      const cases = [
        ['http 非本机 ⇒ 拒', [endpoint({ baseURL: 'http://example.com/v1' })], 'endpoint.url.https-required'],
        ['地址不得含凭据', [endpoint({ baseURL: 'https://u:p@api.example.com/v1' })], 'endpoint.url.has-credentials'],
        ['地址不得含查询参数', [endpoint({ baseURL: 'https://api.example.com/v1?x=1' })], 'endpoint.url.has-query'],
        ['地址不得含片段', [endpoint({ baseURL: 'https://api.example.com/v1#frag' })], 'endpoint.url.has-fragment'],
        ['id 不得重复', [endpoint(), endpoint()], 'endpoint.id.duplicate'],
        ['超时不得小于 1000ms', [endpoint({ timeoutMs: 10 })], 'endpoint.timeoutMs.too-small'],
      ];
      for (const [label, eps, code] of cases) {
        const r = saveEndpoints({ dir, endpoints: eps, stageModels: {} });
        check(label, r.ok === false && has(r.issues, code), JSON.stringify((r.issues ?? []).map((i) => i.code)));
      }

      // apiKeyModelId 成环
      const cyc = saveEndpoints({
        dir,
        endpoints: [endpoint({ id: 'a', apiKeyModelId: 'b' }), endpoint({ id: 'b', apiKeyModelId: 'a' })],
        stageModels: {},
      });
      check('apiKeyModelId 成环 ⇒ 拒', cyc.ok === false && has(cyc.issues, 'endpoint.apiKeyModelId.cycle'));

      // stageModels 悬空
      const dangling = saveEndpoints({ dir, endpoints: [endpoint()], stageModels: { solve: 'nope' } });
      check('stageModels 指向不存在的端点 ⇒ 拒', dangling.ok === false && has(dangling.issues, 'stageModels.dangling'));

      /* v1.1.9alpha：distill 阶段已删除。
         · 保存时旧键直接丢弃（不再因 unknown-stage 整份失败）；
         · 读旧文件时丢弃并给 warning。 */
      const legacySave = saveEndpoints({ dir, endpoints: [endpoint()], stageModels: { distill: 'ep_local', solve: null } });
      check(
        '旧 stageModels.distill 保存时被丢弃（不整份拒绝）',
        legacySave.ok === true && !readFileSync(join(dir, 'endpoints.json'), 'utf8').includes('"distill"'),
        JSON.stringify((legacySave.issues ?? []).map((i) => i.code)),
      );

      const legacyFile = {
        configVersion: 1,
        endpoints: [endpoint()],
        stageModels: { distill: 'ep_local', solve: null },
        keys: {},
      };
      writeFileSync(join(dir, 'endpoints.json'), `${JSON.stringify(legacyFile, null, 2)}\n`, 'utf8');
      const legacyLoad = loadEndpointStore({ dir });
      check(
        '旧 endpoints.json 里的 distill 读时丢弃并 alert（软件不会打不开）',
        legacyLoad.ok === true &&
          !('distill' in legacyLoad.stageModels) &&
          legacyLoad.warnings.some((w) => w.code === 'endpoints.legacy-stage-dropped'),
        JSON.stringify((legacyLoad.issues ?? []).map((i) => i.code)),
      );

      /* v1.1.9alpha：worldbook 阶段改名 knowledgecard，旧键读时改名保留值 */
      legacyFile.stageModels = { worldbook: 'ep_local', solve: null };
      writeFileSync(join(dir, 'endpoints.json'), `${JSON.stringify(legacyFile, null, 2)}\n`, 'utf8');
      const renamed = loadEndpointStore({ dir });
      check(
        '旧 stageModels.worldbook 读时迁移为 knowledgecard（值保留）',
        renamed.ok === true &&
          renamed.stageModels.knowledgecard === 'ep_local' &&
          !('worldbook' in renamed.stageModels) &&
          renamed.warnings.some((w) => w.code === 'endpoints.legacy-stage-migrated'),
        JSON.stringify((renamed.issues ?? []).map((i) => i.code)),
      );

      // 合法：全部通过
      const ok = saveEndpoints({ dir, endpoints: [endpoint({ supportsVision: true })], stageModels: { solve: null } });
      check('（对照）合法配置能保存', ok.ok === true, JSON.stringify(ok.issues));
    }

    /* ────────────────────────────── 『E』删除端点级联 ────────────────────────────── */

    console.log('\n『E』删除端点：分阶段模型置空 + Key 一并清掉');
    {
      const dir = freshDir();
      saveEndpoints({ dir, endpoints: [endpoint(), endpoint({ id: 'ep_two', displayName: '二', baseURL: 'https://api.example.com/v1' })], stageModels: { solve: 'ep_local', steps: 'ep_two' } });
      setKey({ dir, id: 'ep_local', key: KEY_A });
      setKey({ dir, id: 'ep_two', key: KEY_B });

      const r = removeEndpoint({ dir, id: 'ep_local' });
      check('删除成功', r.ok === true, JSON.stringify(r.issues));
      check('★ 指向它的阶段被置空（否则配置会立刻变非法，用户被反锁在门外）', loadEndpointStore({ dir }).stageModels.solve === null);
      check('★ 它的 Key 一并删掉（不留孤儿）', loadKeys({ dir }).keys.ep_local === undefined);
      check('别的端点与 Key 不受影响', loadKeys({ dir }).keys.ep_two === KEY_B);
      check('删除后整份配置仍可载入', loadEndpointStore({ dir }).ok === true);
      check('给了一条"阶段已置空"的提醒（不静默）', has(r.warnings, 'endpoints.stage-cleared'));
      check('给了一条"Key 已删除"的提醒', has(r.warnings, 'endpoints.key-removed'));
      check('删不存在的端点 ⇒ 报错', has(removeEndpoint({ dir, id: 'ghost' }).issues, 'endpoints.not-found'));
    }

    /* ────────────────────────────── 『F』孤儿 Key 与 setKey 的前置检查 ────────────────────────────── */

    console.log('\n『F』孤儿 Key：降级 + 报警，而不是让软件打不开');
    {
      const dir = freshDir();
      saveEndpoints({ dir, endpoints: [endpoint()], stageModels: {} });
      saveKeys({ dir, keys: { ep_local: KEY_A, ghost: 'sk-GHOST000011112222' } });

      const loaded = loadEndpointStore({ dir });
      check('★ 有孤儿 Key 时仍能载入（它是不可达的，不该拖垮整份配置）', loaded.ok === true);
      check('★ 但必须报警（keys.orphan-dropped）', has(loaded.warnings, 'keys.orphan-dropped'));
      check('★ 孤儿 Key 被排除在合并结果之外（不会被发给任何请求）', loaded.keys.ghost === undefined && loaded.keys.ep_local === KEY_A);

      check('给不存在的端点设 Key ⇒ 拒绝（从源头不产生孤儿）', has(setKey({ dir, id: 'ghost2', key: 'sk-X' }).issues, 'endpoints.not-found'));
      check('空 Key 被拒（要清除请用 clearKey）', has(setKey({ dir, id: 'ep_local', key: '' }).issues, 'keys.empty'));
      const cleared = clearKey({ dir, id: 'ep_local' });
      check('清除 Key 成功', cleared.ok === true && loadKeys({ dir }).keys.ep_local === undefined);
      check('清除不存在的 Key ⇒ 报错', has(clearKey({ dir, id: 'ep_local' }).issues, 'keys.not-found'));
    }

    /* ────────────────────────────── 『G』乐观锁 / 外部改动 ────────────────────────────── */

    console.log('\n『G』乐观锁：磁盘上的版本不是它以为的那版就拒绝');
    {
      const dir = freshDir();
      saveEndpoints({ dir, endpoints: [endpoint()], stageModels: {} });
      const stale = saveEndpoints({ dir, endpoints: [endpoint({ defaultModel: 'changed' })], stageModels: {}, expectedHash: null });
      check('用错的 expectedHash 保存 ⇒ 拒绝', stale.ok === false && has(stale.issues, 'endpoints.conflict'));
      check('★ 拒绝时磁盘一个字都没动', JSON.parse(readFileSync(join(dir, 'endpoints.json'), 'utf8')).endpoints[0].defaultModel === 'local-model');

      const forced = saveEndpoints({ dir, endpoints: [endpoint({ defaultModel: 'changed' })], stageModels: {}, expectedHash: null, force: true });
      check('force ⇒ 覆盖成功', forced.ok === true);

      // upsert / setStageModel 走同一条路
      const up = upsertEndpoint({ dir, endpoint: endpoint({ id: 'ep_new', displayName: '新', baseURL: 'https://api.example.com/v1' }) });
      check('upsert 新端点成功', up.ok === true, JSON.stringify(up.issues));
      const st = setStageModel({ dir, stage: 'solve', endpointId: 'ep_new' });
      check('设置阶段端点成功', st.ok === true, JSON.stringify(st.issues));
      check('未知阶段被拒', has(setStageModel({ dir, stage: 'nope', endpointId: null }).issues, 'endpoints.stage-unknown'));
    }

    /* ────────────────────────────── 『H』测试连接（真的发请求） ────────────────────────────── */

    console.log('\n『H』测试连接：最小请求 + 延迟 + §11.2 原文提示');
    {
      check('提示语逐字等于 §11.2 原文', CONNECTION_TEST_NOTICE === '仅验证文本连通性，视觉与解题质量需另行测试');
      check('探测地址拼的是 /models', probeUrl('https://api.example.com/v1') === 'https://api.example.com/v1/models');
      check('尾部斜杠不会拼出 //', probeUrl('https://api.example.com/v1/') === 'https://api.example.com/v1/models');
      check('http 非本机不允许发 Key', isTransportAllowed('http://example.com/v1') === false);
      check('本机 http 允许（本地推理服务）', isTransportAllowed('http://127.0.0.1:11434/v1') === true);

      // ① 200 + 模型列表
      const s1 = await startServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }));
      });
      const r1 = await testConnection({ endpoint: { baseURL: s1.baseURL }, apiKey: KEY_A, timeoutMs: 5000 });
      await s1.close();
      check('200 ⇒ ok', r1.ok === true, JSON.stringify(r1));
      check('数出了 3 个模型', r1.modelCount === 3, String(r1.modelCount));
      check('给了延迟毫秒（数字且非负）', typeof r1.latencyMs === 'number' && r1.latencyMs >= 0, String(r1.latencyMs));
      check('★ 结果里带那句提示（UI 必须显示）', r1.notice === CONNECTION_TEST_NOTICE);

      // ② 401
      const s2 = await startServer((req, res) => {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad key' }));
      });
      const r2 = await testConnection({ endpoint: { baseURL: s2.baseURL }, apiKey: 'sk-wrong', timeoutMs: 5000 });
      await s2.close();
      check('401 ⇒ 失败但说清"网络通、认证失败"', r2.ok === false && r2.code === 'auth' && /认证失败/.test(r2.message), r2.message);

      // ③ 404（不少网关不实现 /models）—— 算"通"
      const s3 = await startServer((req, res) => {
        res.writeHead(404);
        res.end('not found');
      });
      const r3 = await testConnection({ endpoint: { baseURL: s3.baseURL }, timeoutMs: 5000 });
      await s3.close();
      check('★ 404 ⇒ 仍判"连通"，但说明列不出模型（免得用户去改一个没问题的地址）', r3.ok === true && r3.code === 'models-unsupported');

      // ④ 超时
      const s4 = await startServer(() => {
        /* 永不响应 */
      });
      const r4 = await testConnection({ endpoint: { baseURL: s4.baseURL }, timeoutMs: 1000 });
      await s4.close();
      check('超时 ⇒ code=timeout（下限 1000ms）', r4.code === 'timeout', JSON.stringify(r4));

      // ⑤ 连接被拒
      const closed = await startServer(() => {});
      const deadURL = closed.baseURL;
      await closed.close();
      const r5 = await testConnection({ endpoint: { baseURL: deadURL }, timeoutMs: 2000 });
      check('端口关闭 ⇒ code=network', r5.code === 'network', JSON.stringify(r5.code));

      // ⑥ 不安全传输：连 fetch 都不该被调用
      let called = false;
      const r6 = await testConnection({
        endpoint: { baseURL: 'http://example.com/v1' },
        apiKey: KEY_A,
        fetchImpl: async () => {
          called = true;
          throw new Error('不该被调用');
        },
      });
      check('★ http 非本机 ⇒ 拒绝发请求（Key 不出门）', r6.code === 'insecure-transport' && called === false);

      // ⑦ 服务端把 Key 回显在错误体里 ⇒ 结果必须脱敏（§16：绝不写入日志）
      const s7 = await startServer((req, res) => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `bad request, Authorization: Bearer ${KEY_A}` }));
      });
      const r7 = await testConnection({ endpoint: { baseURL: s7.baseURL }, apiKey: KEY_A, timeoutMs: 5000 });
      await s7.close();
      check(
        '★ 服务端回显 Key 时，返回的文案已脱敏（不会写进日志/界面）',
        !`${r7.message}${r7.note ?? ''}`.includes(KEY_A),
        `${r7.message} ${r7.note ?? ''}`,
      );
      check('（对照）它确实拿到了服务端的错误正文（说明脱敏不是"什么都没取"）', /bad request/.test(`${r7.message}${r7.note ?? ''}`));
    }
  } finally {
    for (const d of created) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* 临时目录清不掉不影响结论 */
      }
    }
  }

  console.log(`\n${failures.length ? '✗' : '✓'} 端点配置取证：通过 ${passed} 条，失败 ${failures.length} 条`);
  if (failures.length) {
    console.log('\n失败明细：');
    for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
    process.exitCode = 1;
  }
}

if (isCliEntry(import.meta.url)) main();

export { main };
