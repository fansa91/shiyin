import {
  argbFromHex,
  Hct,
  hexFromArgb,
  SchemeTonalSpot,
} from '@material/material-color-utilities'
import { watch } from 'vue'
import type { useTheme } from 'vuetify'
import { settings } from './settings'

type VuetifyTheme = ReturnType<typeof useTheme>

function schemeColors(scheme: SchemeTonalSpot): Record<string, string> {
  const h = (n: number) => hexFromArgb(n)
  return {
    background: h(scheme.background),
    'on-background': h(scheme.onBackground),
    surface: h(scheme.surface),
    'on-surface': h(scheme.onSurface),
    'surface-variant': h(scheme.surfaceVariant),
    'on-surface-variant': h(scheme.onSurfaceVariant),
    'surface-container': h(scheme.surfaceContainer),
    'surface-container-high': h(scheme.surfaceContainerHigh),
    primary: h(scheme.primary),
    'on-primary': h(scheme.onPrimary),
    'primary-container': h(scheme.primaryContainer),
    'on-primary-container': h(scheme.onPrimaryContainer),
    secondary: h(scheme.secondary),
    'on-secondary': h(scheme.onSecondary),
    error: h(scheme.error),
    'on-error': h(scheme.onError),
  }
}

function isDark(): boolean {
  if (settings.themeMode === 'dark') return true
  if (settings.themeMode === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 当前是否深色模式 (供播放器等非组件逻辑使用) */
export function themeIsDark(): boolean {
  return isDark()
}

function validHex(hex: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#6750A4'
}

/**
 * 根据设置应用 M3 主题: seed color 生成完整的 light/dark 配色,
 * 写入 Vuetify 主题。设置变化或系统主题变化时自动重算。
 */
export function initTheme(theme: VuetifyTheme): void {
  const apply = () => {
    const hct = Hct.fromInt(argbFromHex(validHex(settings.seedColor)))
    Object.assign(theme.themes.value.light.colors, schemeColors(new SchemeTonalSpot(hct, false, 0)))
    Object.assign(theme.themes.value.dark.colors, schemeColors(new SchemeTonalSpot(hct, true, 0)))
    theme.global.name.value = isDark() ? 'dark' : 'light'
  }
  apply()
  watch(() => [settings.seedColor, settings.themeMode], apply)
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply)
}
