<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import ToolboxPage from '../ToolboxPage.vue'
const router = useRouter(); const imageSampleColor = ref(''); const screenColorPickerSupported = Boolean(window.screenColorPicker); const screenColorMessage = ref(screenColorPickerSupported ? '点击后可在任意显示器上选择颜色；右键取消，结果会自动复制。' : '屏幕取色组件未加载，请完全退出并重新启动 LocalForge。'); const backToPortal = () => router.push({ name: 'portal' })
const pickScreenColor = async () => { try { if (!window.screenColorPicker) throw new Error('屏幕取色组件未加载，请完全退出并重新启动 LocalForge 后重试。'); imageSampleColor.value = await window.screenColorPicker.pick(); await navigator.clipboard.writeText(imageSampleColor.value); screenColorMessage.value = `已取色并复制 ${imageSampleColor.value}。` } catch (error) { if (error instanceof Error && error.name !== 'AbortError') screenColorMessage.value = error.message } }
</script>
<template><ToolboxPage><header class="toolbox-heading"><div><p>设计工具 / COLOR PICKER</p><h2>屏幕取色</h2><span>覆盖所有显示器，鼠标离开应用窗口后仍可继续取色。</span></div><button class="back-button" @click="backToPortal">‹ 返回工具列表</button></header><section class="color-card"><div class="color-preview" :style="{ background: imageSampleColor || '#eef2ef' }"></div><label>当前颜色<input :value="imageSampleColor" readonly placeholder="点击开始取色"></label><button class="screen-color-start" :disabled="!screenColorPickerSupported" @click="pickScreenColor"><b>⌖</b><span>开始取色</span></button><p class="tool-message">{{ screenColorMessage }}</p></section></ToolboxPage></template>
