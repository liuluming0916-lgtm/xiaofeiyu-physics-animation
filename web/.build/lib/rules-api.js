/**
 * 规则工作室的**前端唯一出口**（第 6 期第 5 项）。
 *
 * 它与 `tools/rules-service.mjs` 的 `/api/*` 一一对应；页面里不出现裸 `fetch`，
 * 好处是：错误形状只有一种（`RulesApiError` 带 issues/warnings）、路径只写一次、
 * 以后换成别的服务端实现时改这一个文件。
 *
 * 同源：页面由同一个 Node 服务发出来（`127.0.0.1:8080`），所以 `BASE = '/api'`。
 * 用 `python -m http.server` 打开的老方式没有 `/api`，会走到"服务未启动"的兜底提示。
 */
export class RulesApiError extends Error {
    status;
    issues;
    warnings;
    constructor(message, status, issues, warnings) {
        super(message);
        this.name = 'RulesApiError';
        this.status = status;
        this.issues = issues;
        this.warnings = warnings;
    }
}
const BASE = '/api';
function isIssueList(v) {
    return Array.isArray(v);
}
async function request(method, path, body) {
    const init = { method };
    if (body !== undefined) {
        init.headers = { 'content-type': 'application/json' };
        init.body = JSON.stringify(body);
    }
    let res;
    try {
        res = await fetch(`${BASE}${path}`, init);
    }
    catch {
        throw new RulesApiError('连不上规则服务', 0, [{ code: 'service.down', path: '/api', message: '连不上本机服务（请重开一次软件；仍不行就看「启动并诊断.bat」的输出）' }], []);
    }
    const text = await res.text();
    let json = null;
    try {
        json = JSON.parse(text);
    }
    catch {
        json = null;
    }
    if (!res.ok) {
        const rec = (json ?? {});
        const issues = isIssueList(rec.issues) ? rec.issues : [];
        const warnings = isIssueList(rec.warnings) ? rec.warnings : [];
        const first = issues[0]?.message ?? `HTTP ${res.status}`;
        throw new RulesApiError(first, res.status, issues, warnings);
    }
    return (json ?? {});
}
/* ────────────────────────────── 接口 ────────────────────────────── */
export const api = {
    health: () => request('GET', '/health'),
    status: () => request('GET', '/status'),
    promptCatalog: () => request('GET', '/prompts'),
    prompt: (id) => request('GET', `/prompts/${id}`),
    savePrompt: (id, text, expectedHash, force = false) => request('PUT', `/prompts/${id}`, { text, expectedHash, force }),
    resetPrompt: (id, expectedHash, force = false) => request('DELETE', `/prompts/${id}?expectedHash=${encodeURIComponent(expectedHash ?? '')}${force ? '&force=1' : ''}`),
    rebasePrompt: (id) => request('POST', `/prompts/${id}/rebase`),
    cleaning: () => request('GET', '/cleaning'),
    addRule: (rule) => request('POST', '/cleaning/rules', { rule }),
    patchRule: (id, patch) => request('PATCH', `/cleaning/rules/${id}`, { patch }),
    deleteRule: (id) => request('DELETE', `/cleaning/rules/${id}`),
    enableRule: (id, enabled) => request('POST', `/cleaning/rules/${id}/enable`, { enabled }),
    moveRule: (id, toIndex) => request('POST', `/cleaning/rules/${id}/move`, { toIndex }),
    resetCleaning: () => request('POST', '/cleaning/reset', {}),
    endpoints: () => request('GET', '/endpoints'),
    saveEndpoints: (endpoints, stageModels, expectedHash, force = false) => request('PUT', '/endpoints', { endpoints, stageModels, expectedHash, force }),
    setKey: (id, key) => request('POST', `/endpoints/${id}/key`, { key }),
    clearKey: (id) => request('DELETE', `/endpoints/${id}/key`),
    deleteEndpoint: (id) => request('DELETE', `/endpoints/${id}`),
    testEndpoint: (id) => request('POST', `/endpoints/${id}/test`, {}),
    setStage: (stage, endpointId) => request('POST', '/endpoints/stage', { stage, endpointId }),
    exportEndpoints: () => request('GET', '/endpoints/export'),
    importEndpoints: (text) => request('POST', '/endpoints/import', { text }),
    knowledgecard: () => request('GET', '/knowledgecard'),
    knowledgecardPack: (name) => request('GET', `/knowledgecard/packs/${encodeURIComponent(name)}`),
    saveKnowledgecardPack: (name, text) => request('PUT', `/knowledgecard/packs/${encodeURIComponent(name)}`, { text }),
    createKnowledgecardPack: (name) => request('POST', '/knowledgecard/packs', { name }),
    deleteKnowledgecardPack: (name) => request('DELETE', `/knowledgecard/packs/${encodeURIComponent(name)}`),
    copyBuiltinKnowledgecard: (id) => request('POST', '/knowledgecard/copy', { id }),
    restoreKnowledgecardBuiltin: () => request('POST', '/knowledgecard/restore', {}),
    knowledgecardV2: () => request('GET', '/knowledgecard/v2'),
    saveKnowledgecardV2Entry: (entry) => request('POST', '/knowledgecard/v2/entry', { entry }),
    saveKnowledgecardV2VocabState: (disabledElements, disabledScenes) => request('POST', '/knowledgecard/v2/vocab-state', {
        disabledElements,
        disabledScenes,
    }),
    addKnowledgecardV2VocabEntry: (kind, entry) => request('POST', '/knowledgecard/v2/vocab-entry', { kind, entry }),
    removeKnowledgecardV2VocabEntry: (kind, id) => request('DELETE', '/knowledgecard/v2/vocab-entry', { kind, id }),
};
