import { createRouter, createWebHistory } from 'vue-router'
import CategoriesView from '../views/CategoriesView.vue'
import ChartsView from '../views/ChartsView.vue'
import HistoryView from '../views/HistoryView.vue'
import HomeView from '../views/HomeView.vue'
import LaterView from '../views/LaterView.vue'
import PodcastView from '../views/PodcastView.vue'
import SearchView from '../views/SearchView.vue'
import SettingsView from '../views/SettingsView.vue'
import SubscriptionsView from '../views/SubscriptionsView.vue'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/search', name: 'search', component: SearchView },
    { path: '/charts', name: 'charts', component: ChartsView },
    { path: '/categories', name: 'categories', component: CategoriesView },
    // :id = iTunes collectionId, 或手动 RSS 的 'rss:' + feedUrl 哈希
    { path: '/podcast/:id', name: 'podcast', component: PodcastView },
    { path: '/subscriptions', name: 'subscriptions', component: SubscriptionsView },
    { path: '/later', name: 'later', component: LaterView },
    { path: '/history', name: 'history', component: HistoryView },
    { path: '/settings', name: 'settings', component: SettingsView },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})
