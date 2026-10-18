/**
 * 模型网关：OpenAI 兼容协议的客户端（§2.2 / M2）。
 *
 * 本目录（`core/gateway/`）负责"把一段对话发给模型、把流式文本取回来"。
 * 它**不知道**物理、不知道槽位、不知道 Prompt 组装 —— 那些在 `core/prompts/` 与
 * `core/orchestrator/`。这样切分是为了让"协议细节"与"业务语义"各自可测。
 *
 * 依赖口径：**不引入 `openai` 包**（用户第 3 期裁决），用 Node 内置 `fetch` 手写。
 * 见 README 12.3 与 12.13（模型网关实施记录）。
 */

export {
  MODEL_ERROR_KINDS,
  classifyHttpStatus,
  classifyFetchError,
  classifyStreamAbort,
  describeModelError,
  ModelError,
} from './error-taxonomy.mjs';

export {
  streamChatCompletion,
  collectChatCompletion,
  buildUserMessage,
  checkImageInput,
  IMAGE_MAX_BYTES,
  IMAGE_ALLOWED_MIME,
} from './model-client.mjs';

export {
  EndpointConfigError,
  loadEndpointConfig,
  resolveStageEndpoint,
  assertVisionAvailable,
  pickModel,
  redact,
  redactText,
} from './endpoint-config.mjs';

/**
 * 第 6 期第 4 项：端点配置的**存储层**（Key 单独存、导出永不含 Key）与"测试连接"。
 *
 * 与上面的 `endpoint-config.mjs` 分工：
 *   · `endpoint-config.mjs` —— **读一份已在内存里的配置**，回答"这个阶段用哪个端点/Key"（纯逻辑）；
 *   · `endpoint-store.mjs`  —— **读写磁盘上的两份文件**（endpoints.json / keys.json），
 *                              负责合并、校验、导出导入、级联删除、乐观锁。
 * 拆开是为了让"配置从哪来"与"配置怎么用"各自可测：前者要 IO，后者不要。
 */
export {
  ENDPOINTS_FILE,
  KEYS_FILE,
  KEYS_FORMAT,
  KEYS_VERSION,
  loadKeys,
  loadEndpointStore,
  formatEndpointIssues,
  saveEndpoints,
  saveKeys,
  upsertEndpoint,
  removeEndpoint,
  setStageModel,
  setKey,
  clearKey,
  exportEndpointsText,
  assertNoSecrets,
  parseImportEndpoints,
  importEndpoints,
  endpointFilesInfo,
} from './endpoint-store.mjs';

export {
  CONNECTION_TEST_NOTICE,
  probeUrl,
  isTransportAllowed,
  testConnection,
  formatConnectionResult,
} from './connection-test.mjs';
