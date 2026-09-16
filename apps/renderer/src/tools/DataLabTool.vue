<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import ToolboxPage from '../ToolboxPage.vue'
type Operation = 'base64-encode' | 'base64-decode' | 'url-encode' | 'url-decode' | 'timestamp' | 'jwt'
const router = useRouter(); const dataSource = ref(''); const dataResult = ref(''); const dataMessage = ref('输入仅在本地转换，不会上传。'); const dataOperation = ref<Operation>('base64-encode')
const backToPortal = () => router.push({ name: 'portal' })
const unicodeToBase64 = (value: string) => btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(''))
const base64ToUnicode = (value: string) => { const compact = value.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/'); if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) throw new Error('Base64 格式无效'); return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(compact.padEnd(Math.ceil(compact.length / 4) * 4, '=')), (character) => character.charCodeAt(0))) }
const runDataTransform = (operation: Operation) => {
  try {
    const input = dataSource.value.trim(); if (!input) throw new Error('请输入要处理的内容'); if (dataSource.value.length > 20 * 1024 * 1024) throw new Error('待处理内容不能超过 20 MB')
    if (operation === 'base64-encode') dataResult.value = unicodeToBase64(dataSource.value)
    if (operation === 'base64-decode') dataResult.value = base64ToUnicode(input)
    if (operation === 'url-encode') dataResult.value = encodeURIComponent(dataSource.value)
    if (operation === 'url-decode') dataResult.value = decodeURIComponent(input)
    if (operation === 'timestamp') { const numeric = Number(input); const date = Number.isFinite(numeric) ? new Date(Math.abs(numeric) < 100_000_000_000 ? numeric * 1000 : numeric) : new Date(input); if (Number.isNaN(date.getTime())) throw new Error('无法识别时间戳或日期'); dataResult.value = JSON.stringify({ local: date.toLocaleString(), iso: date.toISOString(), unixSeconds: Math.floor(date.getTime() / 1000), unixMilliseconds: date.getTime() }, null, 2) }
    if (operation === 'jwt') { const parts = input.split('.'); if (parts.length < 2) throw new Error('JWT 至少应包含 Header 与 Payload'); dataResult.value = JSON.stringify({ header: JSON.parse(base64ToUnicode(parts[0])), payload: JSON.parse(base64ToUnicode(parts[1])) }, null, 2) }
    dataMessage.value = operation === 'jwt' ? 'JWT 仅完成本地解码，不代表签名已验证。' : '转换完成。'
  } catch (error) { dataResult.value = ''; dataMessage.value = `处理失败：${error instanceof Error ? error.message : String(error)}` }
}
const copyDataResult = async () => { if (dataResult.value) { await navigator.clipboard.writeText(dataResult.value); dataMessage.value = '结果已复制到剪贴板。' } }
</script>
<template><ToolboxPage><header class="toolbox-heading"><div><p>数据工具 / 开发转换台</p><h2>开发数据转换台</h2><span>适合接口调试中的编码、时间与令牌内容检查，处理全程只在本机完成。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header><section class="json-actions data-actions"><label>转换方式 <select v-model="dataOperation"><option value="base64-encode">Base64 编码</option><option value="base64-decode">Base64 解码</option><option value="url-encode">URL 编码</option><option value="url-decode">URL 解码</option><option value="timestamp">解析时间戳</option><option value="jwt">解析 JWT</option></select></label><button class="primary" @click="runDataTransform(dataOperation)">执行转换</button><button :disabled="!dataResult" @click="copyDataResult">复制结果</button></section><p class="tool-message">{{ dataMessage }}</p><section class="json-editors"><label>输入<textarea v-model="dataSource" spellcheck="false" placeholder="粘贴文本、Base64、URL、时间戳或 JWT"></textarea></label><label>结果<textarea v-model="dataResult" spellcheck="false" readonly placeholder="转换结果会出现在这里"></textarea></label></section></ToolboxPage></template>
