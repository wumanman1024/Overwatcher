<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js'
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js'
import { STLLoader } from 'three/addons/loaders/STLLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { SplatMesh, SparkRenderer } from '@sparkjsdev/spark'
import ToolboxPage from '../ToolboxPage.vue'

const router = useRouter()
const viewport = ref<HTMLElement>()
const picker = ref<HTMLInputElement>()
const filename = ref('')
const message = ref('选择模型文件，或将文件拖入下方区域。')
const loading = ref(false)
const dragging = ref(false)
const moveSpeed = ref(1)
const rotation = ref({ x: 0, y: 0, z: 0 })
let renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, controls: OrbitControls, spark: SparkRenderer
let current: THREE.Object3D | undefined
let animation = 0, request = 0, resize: ResizeObserver | undefined, lastFrameTime = 0
let lookingPointer: number | undefined
let homePosition = new THREE.Vector3(3, 2, 3), homeTarget = new THREE.Vector3()
const keys = new Set<string>()
const extensions = /\.(ply|obj|stl|gltf|glb|splat|ksplat|spz|sog)$/i
function disposeObject(object: THREE.Object3D) {
  if (object instanceof SplatMesh) { object.dispose(); return }
  object.traverse((child) => {
    const mesh = child as THREE.Mesh
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []
    materials.forEach((material) => { Object.values(material).forEach(value => { if (value instanceof THREE.Texture) value.dispose() }); material.dispose() })
  })
}
function resetView() { camera.position.copy(homePosition); controls.target.copy(homeTarget); controls.update() }
function splatViewBounds(object: SplatMesh) {
  const full = object.getBoundingBox()
  const count = object.splats?.getNumSplats() ?? 0
  if (count < 100) return full
  const step = Math.max(1, Math.floor(count / 20000))
  const samples: number[][] = [[], [], []]
  object.forEachSplat((index, center) => {
    if (index % step !== 0 || !Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(center.z)) return
    samples[0].push(center.x); samples[1].push(center.y); samples[2].push(center.z)
  })
  if (samples[0].length < 100) return full
  for (const values of samples) values.sort((a, b) => a - b)
  const low = Math.floor((samples[0].length - 1) * 0.01)
  const high = Math.ceil((samples[0].length - 1) * 0.99)
  const robust = new THREE.Box3(
    new THREE.Vector3(samples[0][low], samples[1][low], samples[2][low]),
    new THREE.Vector3(samples[0][high], samples[1][high], samples[2][high])
  )
  const fullSize = full.getSize(new THREE.Vector3()).length()
  const robustSize = robust.getSize(new THREE.Vector3()).length()
  return robustSize > 0 && fullSize > robustSize * 4 ? robust : full
}
function fit(object: THREE.Object3D) {
  object.updateMatrixWorld(true)
  const box = object instanceof SplatMesh ? splatViewBounds(object).applyMatrix4(object.matrixWorld) : new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) throw new Error('模型没有可显示的几何数据')
  const center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3())
  const radius = Math.max(size.x, size.y, size.z, 0.01)
  homeTarget = center.clone(); homePosition = center.clone().add(new THREE.Vector3(radius * 1.4, radius, radius * 1.4))
  camera.near = Math.max(radius / 10000, 0.0001); camera.far = Math.max(radius * 1000, 100); camera.updateProjectionMatrix()
  controls.minDistance = radius / 1000; controls.maxDistance = radius * 100; resetView()
}
async function loadFiles(files: FileList | File[]) {
  const all = Array.from(files); const file = all.find(f => extensions.test(f.name))
  if (!file) { message.value = '未找到支持的模型文件，请选择 PLY、OBJ、STL、GLTF、GLB 或高斯泼溅文件。'; return }
  const id = ++request; loading.value = true; message.value = `正在加载 ${file.name}…`
  const urls = new Map<string, string>()
  for (const f of all) urls.set(f.name.toLowerCase(), URL.createObjectURL(f))
  const manager = new THREE.LoadingManager()
  manager.setURLModifier(url => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url
    const local = urls.get(decodeURIComponent(url.split('/').pop() || '').toLowerCase())
    if (!local) throw new Error(`缺少依赖文件：${url}`)
    return local
  })
  let object: THREE.Object3D | undefined
  try {
    const ext = file.name.split('.').pop()!.toLowerCase()
    const bytes = await file.arrayBuffer()
    const header = ext === 'ply' ? new TextDecoder().decode(bytes.slice(0, Math.min(bytes.byteLength, 65536))).split('end_header')[0] : ''
    const isSplat = ['splat', 'ksplat', 'spz', 'sog'].includes(ext) || (ext === 'ply' && /\b(?:f_dc_0|scale_0|opacity)\b/.test(header))
    if (isSplat) { const splat = new SplatMesh({ fileBytes: bytes, fileName: file.name }); object = splat; await splat.initialized }
    else if (ext === 'obj') {
      const loader = new OBJLoader(manager); const mtl = all.find(f => /\.mtl$/i.test(f.name))
      if (mtl) { const materials = new MTLLoader(manager).parse(await mtl.text(), ''); materials.preload(); loader.setMaterials(materials) }
      object = loader.parse(new TextDecoder().decode(bytes))
    } else if (ext === 'gltf' || ext === 'glb') {
      object = (await new GLTFLoader(manager).parseAsync(ext === 'gltf' ? new TextDecoder().decode(bytes) : bytes, '')).scene
    } else {
      const geometry = ext === 'ply' ? new PLYLoader().parse(bytes) : new STLLoader().parse(bytes)
      if (geometry.index || ext === 'stl' || (ext === 'ply' && /element face\s+[1-9]/.test(header))) {
        if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
        object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: geometry.hasAttribute('color') ? 0xffffff : 0x9db8d4, vertexColors: geometry.hasAttribute('color'), side: THREE.DoubleSide, roughness: 0.75 }))
      } else object = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.01, vertexColors: geometry.hasAttribute('color'), color: geometry.hasAttribute('color') ? 0xffffff : 0x9db8d4 }))
    }
    if (id !== request) { disposeObject(object); return }
    rotation.value = { x: 0, y: 0, z: 0 }
    fit(object)
    if (current) { scene.remove(current); disposeObject(current) }
    current = object; scene.add(object); filename.value = file.name
    message.value = `已加载 ${file.name}${isSplat ? ' · 高斯泼溅' : ''}，文件仅在本地处理。`
  } catch (error) { if (object) disposeObject(object); if (id === request) message.value = `加载失败：${error instanceof Error ? error.message : String(error)}。请检查模型及其依赖文件。` }
  finally { urls.forEach(url => URL.revokeObjectURL(url)); if (id === request) loading.value = false }
}
function applyRotation() {
  if (!current) return
  const { x, y, z } = rotation.value
  if (![x, y, z].every(value => Number.isFinite(value))) return
  current.rotation.set(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z))
  current.updateMatrixWorld(true)
}
function setRotation(x: number, y: number, z: number) {
  rotation.value = { x, y, z }
  applyRotation()
  if (current) fit(current)
}
function fitCurrent() { if (current) fit(current) }
function clearModel() {
  request++; loading.value = false; dragging.value = false; clearKeys()
  if (current) { scene.remove(current); disposeObject(current); current = undefined }
  rotation.value = { x: 0, y: 0, z: 0 }
  filename.value = ''; message.value = '模型已清空，选择或拖入文件以重新加载。'
}
function selected(event: Event) { const input = event.target as HTMLInputElement; if (input.files?.length) void loadFiles(input.files); input.value = '' }
function dropped(event: DragEvent) { dragging.value = false; if (event.dataTransfer?.files.length) void loadFiles(event.dataTransfer.files) }
function lookPointerDown(event: PointerEvent) {
  if (event.button !== 2) return
  event.preventDefault()
  viewport.value?.focus()
  lookingPointer = event.pointerId
  renderer.domElement.setPointerCapture(event.pointerId)
}
function lookPointerMove(event: PointerEvent) {
  if (lookingPointer !== event.pointerId) return
  event.preventDefault()
  const direction = new THREE.Vector3()
  camera.getWorldDirection(direction)
  let yaw = Math.atan2(direction.x, direction.z)
  let pitch = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1))
  yaw -= event.movementX * 0.0025
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.0025, -THREE.MathUtils.degToRad(84), THREE.MathUtils.degToRad(84))
  direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
  const distance = camera.position.distanceTo(controls.target)
  controls.target.copy(camera.position).addScaledVector(direction, distance)
  controls.update()
}
function lookPointerUp(event: PointerEvent) {
  if (lookingPointer !== event.pointerId) return
  lookingPointer = undefined
  if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId)
}
function keydown(event: KeyboardEvent) { if (!viewport.value?.contains(document.activeElement)) return; if (['w','a','s','d','control',' '].includes(event.key.toLowerCase())) { keys.add(event.key.toLowerCase()); event.preventDefault() } }
function keyup(event: KeyboardEvent) { keys.delete(event.key.toLowerCase()) }
function move(deltaTime: number) {
  if (!keys.size) return
  const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize()
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize(); const delta = new THREE.Vector3()
  if (keys.has('w')) delta.add(forward); if (keys.has('s')) delta.sub(forward); if (keys.has('d')) delta.add(right); if (keys.has('a')) delta.sub(right); if (keys.has(' ')) delta.y += 1; if (keys.has('control')) delta.y -= 1
  delta.normalize().multiplyScalar(camera.position.distanceTo(controls.target) * 0.72 * moveSpeed.value * deltaTime); camera.position.add(delta); controls.target.add(delta)
}
onMounted(() => {
  try {
    scene = new THREE.Scene(); scene.background = new THREE.Color(0x111b29)
    camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000); camera.position.copy(homePosition)
    renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); viewport.value!.appendChild(renderer.domElement)
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.mouseButtons.LEFT = THREE.MOUSE.PAN; controls.mouseButtons.RIGHT = null
    scene.add(new THREE.HemisphereLight(0xffffff, 0x52637a, 2)); const light = new THREE.DirectionalLight(0xffffff, 2); light.position.set(5, 10, 7); scene.add(light)
    renderer.domElement.addEventListener('pointerdown', lookPointerDown)
    renderer.domElement.addEventListener('pointermove', lookPointerMove)
    renderer.domElement.addEventListener('pointerup', lookPointerUp)
    renderer.domElement.addEventListener('pointercancel', lookPointerUp)
    spark = new SparkRenderer({ renderer }); scene.add(spark)
    resize = new ResizeObserver(() => { if (!viewport.value) return; const { clientWidth, clientHeight } = viewport.value; if (!clientWidth || !clientHeight) return; camera.aspect = clientWidth / clientHeight; camera.updateProjectionMatrix(); renderer.setSize(clientWidth, clientHeight) }); resize.observe(viewport.value!)
    const loop = (time: number) => { animation = requestAnimationFrame(loop); const deltaTime = lastFrameTime ? Math.min((time - lastFrameTime) / 1000, 0.05) : 0; lastFrameTime = time; move(deltaTime); controls.update(); renderer.render(scene, camera) }; animation = requestAnimationFrame(loop)
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', clearKeys)
  } catch (error) { message.value = `无法初始化 3D 画布：${error instanceof Error ? error.message : String(error)}` }
})
function clearKeys() { keys.clear() }
onBeforeUnmount(() => { request++; cancelAnimationFrame(animation); resize?.disconnect(); window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', clearKeys); if (current) disposeObject(current); renderer?.domElement.removeEventListener('pointerdown', lookPointerDown); renderer?.domElement.removeEventListener('pointermove', lookPointerMove); renderer?.domElement.removeEventListener('pointerup', lookPointerUp); renderer?.domElement.removeEventListener('pointercancel', lookPointerUp); controls?.dispose(); spark?.dispose(); renderer?.dispose() })
</script>
<template><ToolboxPage>
  <header class="toolbox-heading"><div><p>设计工具 / 3D VIEWER</p><h2>3D 模型查看器</h2><span>在本机打开模型、点云和高斯泼溅文件。</span></div><button class="back-button" @click="router.push({ name: 'portal' })">‹ 返回工具列表</button></header>
  <div class="model-toolbar"><button class="model-primary" @click="picker?.click()">选择模型文件</button><button :disabled="!filename" @click="resetView">重置视角</button><button :disabled="!filename &amp;&amp; !loading" @click="clearModel">清空模型</button><span>{{ filename || '尚未选择文件' }}</span><input ref="picker" type="file" multiple accept=".ply,.obj,.stl,.gltf,.glb,.splat,.ksplat,.spz,.sog,.mtl,.bin,.png,.jpg,.jpeg,.webp" hidden @change="selected"></div>
  <section class="model-transform" aria-label="坐标方向设置">
    <div class="model-transform-title"><strong>坐标方向</strong><span>角度单位：°</span></div>
    <div class="model-transform-controls">
      <button type="button" :disabled="!filename" @click="setRotation(0, 0, 0)">原始坐标</button>
      <button type="button" :disabled="!filename" @click="setRotation(90, 180, 0)">Z 轴向上</button>
      <label v-for="axis in (['x', 'y', 'z'] as const)" :key="axis">{{ axis.toUpperCase() }} 旋转 <input v-model.number="rotation[axis]" :disabled="!filename" type="number" step="15" @input="applyRotation"></label>
      <button type="button" :disabled="!filename" @click="fitCurrent">适应模型</button>
    </div>
    <p>原始坐标保持文件方向；选择 Z 轴向上可将 Z 轴转换为 Three.js 的 Y 轴向上。</p>
  </section>
  <div ref="viewport" class="model-viewport" :class="{ dragging }" tabindex="0" aria-label="模型预览区域，聚焦后使用 WASD 移动视角，空格上升，Ctrl 下降" @dragenter.prevent="dragging = true" @dragover.prevent @dragleave.prevent="dragging = false" @drop.prevent="dropped" @click="viewport?.focus()" @focusout="clearKeys">
    <div v-if="!filename || dragging || loading" class="model-overlay"><strong>{{ loading ? '正在加载模型…' : dragging ? '松开鼠标以打开文件' : '拖入模型文件' }}</strong><span>或点击上方按钮选择文件</span></div>
  </div>
  <label class="model-speed">移动速度 <input v-model.number="moveSpeed" type="range" min="0.1" max="5" step="0.1"> <output>{{ moveSpeed.toFixed(1) }}×</output></label>
  <p class="model-message" role="status">{{ message }}</p><p class="model-hint">鼠标左键平移 · 右键拖拽转向 · 滚轮缩放 · 点击画布后使用 W / A / S / D 移动视角 · 空格上升 · Ctrl 下降</p><p class="model-hint">支持 PLY、OBJ、STL、GLTF、GLB、SPLAT、KSPLAT、SPZ、SOG；OBJ / GLTF 的材质、贴图或 BIN 请与模型一起选择或拖入。</p>
</ToolboxPage></template>
<style scoped>
.model-speed{display:flex;align-items:center;gap:10px;margin-top:12px;color:#52637a;font-size:13px}.model-speed input{width:160px;accent-color:#2563eb}.model-speed output{min-width:32px;font-variant-numeric:tabular-nums}.model-transform{margin:0 0 12px;padding:12px 14px;border:1px solid #e1e7ee;border-radius:8px;background:#fff}.model-transform-title{display:flex;align-items:baseline;gap:10px;font-size:13px;color:#334155}.model-transform-title span,.model-transform p{font-size:12px;color:#8491a3}.model-transform-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:9px}.model-transform-controls button{padding:6px 10px;border:1px solid #d7dfe8;border-radius:6px;background:white;cursor:pointer}.model-transform-controls button:disabled,.model-transform-controls input:disabled{opacity:.45;cursor:default}.model-transform-controls label{display:flex;align-items:center;gap:4px;font-size:12px;color:#52637a}.model-transform-controls input{width:64px;padding:5px;border:1px solid #d7dfe8;border-radius:5px}.model-transform p{margin:8px 0 0}.model-toolbar{display:flex;align-items:center;gap:10px;margin:20px 0 12px}.model-toolbar button{border:1px solid #d7dfe8;border-radius:7px;background:#fff;padding:9px 15px;cursor:pointer}.model-toolbar button:disabled{opacity:.45;cursor:default}.model-toolbar .model-primary{background:#2563eb;color:white;border-color:#2563eb}.model-toolbar span{font-size:13px;color:#718096;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.model-viewport{height:min(58vh,620px);min-height:320px;position:relative;overflow:hidden;border-radius:10px;background:#111b29;outline:none}.model-viewport:focus-visible{outline:2px solid #4a87f5}.model-viewport.dragging{outline:2px dashed #73a5ff}.model-viewport :deep(canvas){display:block;width:100%;height:100%}.model-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;color:#e2ecfa;pointer-events:none;background:#111b29aa}.model-overlay strong{font-size:19px}.model-overlay span{font-size:13px;color:#9bb0c8}.model-message{font-size:13px;color:#40546d;margin:12px 0}.model-hint{font-size:12px;color:#8491a3;line-height:1.6;margin:5px 0}
</style>

