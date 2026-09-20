export const REASONING_EFFORTS = ['off', 'low', 'medium', 'xhigh'];
export const REASONING_EFFORT_LABEL = { off: '关闭（最快）', low: '低', medium: '中', xhigh: '高' };
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_TIMEOUT_MS = 120_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 600_000;
const effortOf = (value) => (REASONING_EFFORTS.includes(value) ? value : 'off');
const bounded = (value, fallback, min, max) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric))
        return fallback;
    return Math.min(max, Math.max(min, numeric));
};
/** 只接受 http/https 的绝对地址；末尾斜杠统一掉，拼接端点时不会出现双斜杠。 */
const baseUrlOf = (value) => {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/[^\s]+$/i.test(trimmed))
        return null;
    return trimmed;
};
/** 逐字段规整：任何一条坏数据都整条丢弃，而不是产出半残缺的配置。 */
export function normalizeModelConfig(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const value = raw;
    if (typeof value.id !== 'string' || !value.id)
        return null;
    if (typeof value.name !== 'string' || !value.name.trim())
        return null;
    if (typeof value.modelId !== 'string' || !value.modelId.trim())
        return null;
    const baseUrl = baseUrlOf(value.baseUrl);
    if (!baseUrl)
        return null;
    const maxTokens = Number.isFinite(Number(value.maxTokens)) && Number(value.maxTokens) > 0 ? Math.trunc(Number(value.maxTokens)) : undefined;
    return {
        id: value.id,
        name: value.name.trim(),
        baseUrl,
        modelId: value.modelId.trim(),
        apiKey: typeof value.apiKey === 'string' ? value.apiKey.trim() : '',
        effort: effortOf(value.effort),
        temperature: bounded(value.temperature, DEFAULT_TEMPERATURE, 0, 2),
        ...(maxTokens ? { maxTokens } : {}),
        timeoutMs: bounded(value.timeoutMs, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
        isDefault: value.isDefault === true
    };
}
/** 规整整个列表，并保证恰好一条 isDefault：保留第一条被标记的，都没标记则把第一条设为默认，避免工具无模型可用。 */
export function normalizeModelList(raw) {
    if (!Array.isArray(raw))
        return [];
    const models = raw.map(normalizeModelConfig).filter((model) => model !== null);
    const deduped = new Map(models.map((model) => [model.id, model]));
    const list = [...deduped.values()];
    if (!list.length)
        return list;
    const keep = list.findIndex((model) => model.isDefault);
    const defaultIndex = keep === -1 ? 0 : keep;
    return list.map((model, index) => ({ ...model, isDefault: index === defaultIndex }));
}
/** 表单校验：返回中文错误文案，通过则返回 null。与 normalizeModelConfig 的区别是它给用户看原因。 */
export function validateModelInput(input) {
    if (!input.name?.trim())
        return '请填写模型显示名称。';
    if (!input.modelId?.trim())
        return '请填写模型标识。';
    if (!baseUrlOf(input.baseUrl))
        return '服务地址需是 http:// 或 https:// 开头的完整地址。';
    if (input.apiKey && /\s/.test(input.apiKey))
        return 'API Key 不能包含空格。';
    return null;
}
