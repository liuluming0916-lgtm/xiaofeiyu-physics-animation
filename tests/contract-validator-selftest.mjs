#!/usr/bin/env node
/**
 * 契约跨字段校验的逐条取证（§11.2 九条 + §12 清洗规则）。
 *
 * 做法与前两期的 `lint-selftest` / `instrument-selftest` 一致：
 * **每条判据都配正例或反例**，而且反例断言的是"被哪条规则号拒绝"，
 * 不是"有没有报错"——否则规则被写宽了也照样绿。
 *
 * 用法：node tests/contract-validator-selftest.mjs
 */

import { validateEndpointConfig, validateCleaningRuleSet, formatIssues } from '../contracts/validate.mjs';

/* ────────────────────────────── 测试骨架 ────────────────────────────── */

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

/** 断言"被某条规则号拒绝" */
function expectRejected(name, result, code) {
  const codes = result.issues.map((i) => i.code);
  check(`${name} → 命中 ${code}`, !result.ok && codes.includes(code), `实际：${codes.join(', ') || '（未报错）'}`);
}

function expectAccepted(name, result) {
  check(
    `${name} → 通过`,
    result.ok,
    result.ok ? '' : `实际被拒：\n${formatIssues(result.issues)}`,
  );
}

/* ────────────────────────────── 正例 ────────────────────────────── */

/** 一份合法配置：两个端点（一个复用另一个的 Key）、分阶段模型、一个本地推理端点 */
function validConfig(overrides = {}) {
  return {
    configVersion: 1,
    endpoints: [
      {
        id: 'ep_main',
        displayName: '主力模型',
        baseURL: 'https://api.example.com/v1',
        defaultModel: 'some-model',
        visionModel: 'some-vision',
        apiKeyModelId: null,
        supportsJsonMode: true,
        supportsVision: true,
        enableThinking: false,
        preserveThinking: false,
        timeoutMs: 300000,
      },
      {
        id: 'ep_reuse',
        displayName: '复用主力 Key',
        baseURL: 'https://other.example.com/v1',
        defaultModel: 'another-model',
        apiKeyModelId: 'ep_main',
        supportsJsonMode: false,
        supportsVision: false,
        enableThinking: true,
        preserveThinking: true,
        timeoutMs: 60000,
      },
      {
        id: 'ep_local',
        displayName: '本地推理',
        baseURL: 'http://127.0.0.1:11434/v1',
        defaultModel: 'local-model',
        apiKeyModelId: null,
        supportsJsonMode: true,
        supportsVision: false,
        enableThinking: false,
        preserveThinking: false,
        timeoutMs: 120000,
      },
    ],
    stageModels: {
      solve: 'ep_main',
      analysis: 'ep_main',
      breakdown: 'ep_main',
      scene_code: 'ep_main',
      dry_run: null,
      repair: null,
      knowledgecard: null,
    },
    keys: { ep_main: 'sk-fake-not-a-real-key' },
    ...overrides,
  };
}

console.log('契约跨字段校验取证（§11.2 / §12）\n');

console.log('『正例』');
expectAccepted('合法配置（含 Key 复用链、localhost 明文）', validateEndpointConfig(validConfig()));
expectAccepted(
  '合法的清洗规则表（含一条真实正则）',
  validateCleaningRuleSet({
    format: 'od-cleaning-rules',
    version: 1,
    rules: [
      { id: 'strip-fence', name: '剥代码围栏', stage: 'scene_code', pattern: '```[a-z]*', flags: 'g', replacement: '', enabled: true },
      { id: 'trim', name: '去首尾空白', stage: 'solve', pattern: '^\\s+|\\s+$', flags: 'g', replacement: '', enabled: true },
    ],
  }),
);

/* ────────────────────────────── 反例：§11.2 九条 ────────────────────────────── */

console.log('\n『§11.2 规则 1–2：URL』');
const withURL = (url) => {
  const c = validConfig();
  c.endpoints[0].baseURL = url;
  return validateEndpointConfig(c);
};
expectRejected('远程 http:// （非回环）被拒', withURL('http://api.example.com/v1'), 'endpoint.url.https-required');
expectAccepted('回环 http://127.0.0.1 放行', withURL('http://127.0.0.1:8080/v1'));
expectAccepted('localhost http:// 放行', withURL('http://localhost:8080/v1'));
expectRejected('地址含凭据被拒', withURL('https://user:pw@api.example.com/v1'), 'endpoint.url.has-credentials');
expectRejected('地址含查询参数被拒', withURL('https://api.example.com/v1?x=1'), 'endpoint.url.has-query');
expectRejected('地址含片段被拒', withURL('https://api.example.com/v1#frag'), 'endpoint.url.has-fragment');
expectRejected('地址不是合法 URL 被拒', withURL('not a url'), 'endpoint.url.unparsable');

console.log('\n『§11.2 规则 3：id 字符集与唯一性』');
{
  const c = validConfig();
  c.endpoints[0].id = 'ep main!';
  expectRejected('id 含非法字符被拒', validateEndpointConfig(c), 'endpoint.id.charset');
}
{
  const c = validConfig();
  c.endpoints[1].id = 'ep_main';
  expectRejected('id 重复被拒', validateEndpointConfig(c), 'endpoint.id.duplicate');
}

console.log('\n『§11.2 规则 4：端点数量 ≤300』');
{
  const c = validConfig();
  const one = c.endpoints[0];
  c.endpoints = Array.from({ length: 301 }, (_, i) => ({ ...one, id: `ep_${i}` }));
  expectRejected('301 个端点被拒', validateEndpointConfig(c), 'endpoints.too-many');
}

console.log('\n『§11.2 规则 5：apiKeyModelId 必须存在、不得成环』');
{
  const c = validConfig();
  c.endpoints[1].apiKeyModelId = 'ep_not_exist';
  expectRejected('指向不存在的端点被拒', validateEndpointConfig(c), 'endpoint.apiKeyModelId.dangling');
}
{
  // 自环
  const c = validConfig();
  c.endpoints[1].apiKeyModelId = 'ep_reuse';
  expectRejected('自环（指向自己）被拒', validateEndpointConfig(c), 'endpoint.apiKeyModelId.cycle');
}
{
  // 三节点环：a → b → c → a
  const c = validConfig();
  const tpl = c.endpoints[0];
  c.endpoints = [
    { ...tpl, id: 'ep_a', apiKeyModelId: 'ep_b' },
    { ...tpl, id: 'ep_b', apiKeyModelId: 'ep_c' },
    { ...tpl, id: 'ep_c', apiKeyModelId: 'ep_a' },
  ];
  c.stageModels = {};
  c.keys = {};
  expectRejected('三节点环被拒', validateEndpointConfig(c), 'endpoint.apiKeyModelId.cycle');
}

console.log('\n『§11.2 规则 6：stageModels 引用必须存在、键必须是已知阶段』');
{
  const c = validConfig();
  c.stageModels.solve = 'ep_missing';
  expectRejected('引用不存在的端点被拒', validateEndpointConfig(c), 'stageModels.dangling');
}
{
  const c = validConfig();
  c.stageModels.scene_review = 'ep_main';
  expectRejected('未知阶段名被拒', validateEndpointConfig(c), 'stageModels.unknown-stage');
}
{
  const c = validConfig();
  c.stageModels.distill = 'ep_main';
  expectRejected('distill 阶段已删除 ⇒ stageModels.distill 被当作未知阶段拒绝', validateEndpointConfig(c), 'stageModels.unknown-stage');
}

console.log('\n『§11.2 规则 8：体积与版本』');
{
  const big = 'x'.repeat(4 * 1024 * 1024 + 1);
  expectRejected('超过 4 MB 被拒', validateEndpointConfig(validConfig(), { rawText: big }), 'config.too-large');
  expectAccepted('刚好 4 MB 以内放行', validateEndpointConfig(validConfig(), { rawText: 'x'.repeat(1024) }));
}
{
  const c = validConfig();
  c.configVersion = 2;
  expectRejected('不支持的 configVersion 被拒', validateEndpointConfig(c), 'config.version-unsupported');
}

console.log('\n『字段形状补充』');
{
  const c = validConfig();
  delete c.endpoints[0].timeoutMs;
  expectRejected('端点缺必填字段被拒', validateEndpointConfig(c), 'endpoint.missing-field');
}
{
  const c = validConfig();
  c.endpoints[0].timeoutMs = 500;
  expectRejected('timeoutMs 低于下限被拒', validateEndpointConfig(c), 'endpoint.timeoutMs.too-small');
}
{
  const c = validConfig();
  c.endpoints[0].supportsVision = 'yes';
  expectRejected('布尔开关传字符串被拒', validateEndpointConfig(c), 'endpoint.flag.not-boolean');
}
{
  const c = validConfig();
  c.keys = { ep_main: 'sk-x', ep_gone: 'sk-y' };
  expectRejected('keys 里有孤儿 Key 被拒（历史残留）', validateEndpointConfig(c), 'keys.orphan');
}
{
  expectRejected('配置不是对象被拒', validateEndpointConfig('nope'), 'config.not-object');
  expectRejected('endpoints 不是数组被拒', validateEndpointConfig({ endpoints: {}, stageModels: {}, keys: {} }), 'config.endpoints.not-array');
}

/* ────────────────────────────── 反例：§12 清洗规则 ────────────────────────────── */

console.log('\n『§12 / §16：清洗规则表』');
const ruleSet = (rules) => validateCleaningRuleSet({ format: 'od-cleaning-rules', version: 1, rules });
const oneRule = () => ({ id: 'r1', name: '规则', stage: 'solve', pattern: 'a', flags: 'g', replacement: '', enabled: true });

expectRejected('非法正则被拒（不落盘）', ruleSet([{ ...oneRule(), pattern: '([a-z' }]), 'rule.pattern.invalid');
expectRejected('未知 stage 被拒', ruleSet([{ ...oneRule(), stage: 'dry_run' }]), 'rule.stage.unknown');
expectRejected('未知 flag 被拒', ruleSet([{ ...oneRule(), flags: 'gz' }]), 'rule.flags.unknown');
expectRejected('规则 id 重复被拒', ruleSet([oneRule(), { ...oneRule() }]), 'rule.id.duplicate');
expectRejected('enabled 非布尔被拒', ruleSet([{ ...oneRule(), enabled: 'true' }]), 'rule.enabled.not-boolean');
expectRejected('缺字段被拒', ruleSet([{ id: 'r2', name: 'x' }]), 'rule.missing-field');
expectRejected('format 不对被拒', validateCleaningRuleSet({ format: 'od-something', version: 1, rules: [] }), 'rules.bad-format');
expectRejected('版本不对被拒', validateCleaningRuleSet({ format: 'od-cleaning-rules', version: 2, rules: [] }), 'rules.bad-version');
expectAccepted('空规则表合法（内置最小集可以被用户删到只剩必需项）', ruleSet([]));

/* ────────────────────────────── 汇总 ────────────────────────────── */

console.log(`\n${failures.length ? '✗' : '✓'} 契约校验取证：通过 ${passed} 条，失败 ${failures.length} 条`);
if (failures.length) {
  console.log('\n失败明细：');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.detail ?? ''}`);
  process.exitCode = 1;
}
