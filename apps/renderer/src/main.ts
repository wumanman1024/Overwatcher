import { createApp } from 'vue'
import App from './App.vue'
import StatusBar from './StatusBar.vue'
import TrendPage from './TrendPage.vue'
import './styles.css'

const surface = new URLSearchParams(location.search).get('surface')
createApp(surface === 'status' ? StatusBar : surface === 'trend' ? TrendPage : App).mount('#app')
