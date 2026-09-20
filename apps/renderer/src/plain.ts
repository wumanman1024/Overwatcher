import { toRaw } from 'vue'

/*
 * Vue 的 ref/reactive 会把对象包成 ES Proxy。Electron 的 contextBridge 在把参数从渲染进程
 * 传进 preload 时会做结构化克隆，而 V8 无法克隆 Proxy，直接抛「An object could not be cloned.」。
 * 这个错发生在跨越 contextBridge 边界的瞬间，preload 里再补救已经太晚——必须在渲染层交出对象前拆成纯数据。
 * JSON 往返会读取 Proxy 的 getter、产出普通对象；跨 IPC 的配置/消息本就是扁平 JSON，往返不丢信息。
 */
export const plain = <T>(value: T): T => JSON.parse(JSON.stringify(toRaw(value))) as T
