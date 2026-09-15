import { createApp } from 'vue'
import App from './App.vue'
import StatusBar from './StatusBar.vue'
import TrendPage from './TrendPage.vue'
import { router } from './router'
import 'element-plus/dist/index.css'
import 'virtual:svg-icons-register'
import './styles.css'

const surface = new URLSearchParams(location.search).get('surface')
const vueApp = createApp(surface === 'status' ? StatusBar : surface === 'trend' ? TrendPage : App)
if (surface === 'toolbox') vueApp.use(router)
vueApp.mount('#app')
