export type ReasoningEffort = 'off' | 'low' | 'medium' | 'xhigh';
/** 一条大模型服务配置。全部字段都由用户填写，代码里不提供任何真实地址或模型名的默认值。 */
export interface ModelConfig {
    id: string;
    name: string;
    /** OpenAI 兼容服务的基础地址，例如 https://host:port/v1。 */
    baseUrl: string;
    /** 请求体 model 字段用的模型标识。 */
    modelId: string;
    /** 明文保存，内网服务可留空。 */
    apiKey: string;
    /** vLLM 的 reasoning_effort；off 表示关闭思考。 */
    effort: ReasoningEffort;
    temperature: number;
    maxTokens?: number;
    timeoutMs: number;
    isDefault: boolean;
}
/** 新建/编辑表单提交的数据：id 与 isDefault 由存储层负责。 */
export type ModelConfigInput = Omit<ModelConfig, 'id' | 'isDefault'>;
/** 渲染层把配置原样带进主进程，主进程不落盘也不持有默认地址。 */
export interface LlmChatRequest {
    config: ModelConfig;
    messages: Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
    }>;
}
export interface LlmChatResult {
    content: string;
    finishReason?: string;
}
export interface LlmTestResult {
    ok: boolean;
    count?: number;
    error?: string;
}
export declare const REASONING_EFFORTS: ReasoningEffort[];
export declare const REASONING_EFFORT_LABEL: Record<ReasoningEffort, string>;
/** 逐字段规整：任何一条坏数据都整条丢弃，而不是产出半残缺的配置。 */
export declare function normalizeModelConfig(raw: unknown): ModelConfig | null;
/** 规整整个列表，并保证恰好一条 isDefault：保留第一条被标记的，都没标记则把第一条设为默认，避免工具无模型可用。 */
export declare function normalizeModelList(raw: unknown): ModelConfig[];
/** 表单校验：返回中文错误文案，通过则返回 null。与 normalizeModelConfig 的区别是它给用户看原因。 */
export declare function validateModelInput(input: ModelConfigInput): string | null;
