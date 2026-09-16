<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import ToolboxPage from '../ToolboxPage.vue'
const router = useRouter()
const sourceJson = ref('{\n  "hello": "developer toolbox"\n}')
const resultJson = ref('')
const jsonIndent = ref<2 | 4>(Number(localStorage.getItem('localforge:json-indent')) === 4 ? 4 : 2)
const jsonMessage = ref('在本地格式化 JSON，内容不会上传。')
const backToPortal = () => router.push({ name: 'portal' })
const updateIndent = (event: Event) => { jsonIndent.value = (event as CustomEvent<2 | 4>).detail }
window.addEventListener('localforge:json-indent-changed', updateIndent)
onBeforeUnmount(() => window.removeEventListener('localforge:json-indent-changed', updateIndent))
const parse = (): unknown => JSON.parse(sourceJson.value)
const run = (mode: 'format' | 'minify' | 'sort') => {
  try {
    if (sourceJson.value.length > 10 * 1024 * 1024) throw new Error('JSON 内容不能超过 10 MB')
    const sortObject = (value: unknown): unknown => Array.isArray(value) ? value.map(sortObject) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortObject(child)])) : value
    resultJson.value = JSON.stringify(mode === 'sort' ? sortObject(parse()) : parse(), null, mode === 'minify' ? undefined : jsonIndent.value)
    jsonMessage.value = mode === 'format' ? '格式化成功。' : mode === 'minify' ? '压缩成功。' : '已按键名排序。'
  } catch (error) { resultJson.value = ''; jsonMessage.value = `JSON 无效：${error instanceof Error ? error.message : String(error)}` }
}
const copyResult = async () => { if (resultJson.value) { await navigator.clipboard.writeText(resultJson.value); jsonMessage.value = '结果已复制到剪贴板。' } }
</script>
<template><ToolboxPage><header class="toolbox-heading"><div><p>数据工具 / JSON</p><h2>JSON 格式化与校验</h2><span>输入内容只在本地处理，不会发送到网络。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header><section class="json-actions"><label>缩进 <select v-model.number="jsonIndent"><option :value="2">2 空格</option><option :value="4">4 空格</option></select></label><button class="primary" @click="run('format')">格式化</button><button @click="run('minify')">压缩</button><button @click="run('sort')">键排序</button><button :disabled="!resultJson" @click="copyResult">复制结果</button></section><p class="tool-message">{{ jsonMessage }}</p><section class="json-editors"><label>输入<textarea v-model="sourceJson" spellcheck="false" placeholder="粘贴 JSON 内容"></textarea></label><label>结果<textarea v-model="resultJson" spellcheck="false" readonly placeholder="格式化结果会出现在这里"></textarea></label></section></ToolboxPage></template>
