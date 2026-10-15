import 'vuetify/styles'
import { createVuetify } from 'vuetify'
import * as components from 'vuetify/components'
import * as directives from 'vuetify/directives'
import { aliases, mdi } from 'vuetify/iconsets/mdi'
import '@mdi/font/css/materialdesignicons.css'

export default createVuetify({
  components,
  directives,
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  theme: {
    defaultTheme: 'dark',
    themes: {
      dark: {
        dark: true,
        colors: {
          primary: '#D0BCFF',
          'on-primary': '#381E72',
          'primary-container': '#4F378B',
          surface: '#141218',
          'surface-container': '#1D1B20',
          'surface-container-high': '#2B2930',
        },
      },
      light: {
        dark: false,
        colors: {
          primary: '#6750A4',
          'on-primary': '#FFFFFF',
          'primary-container': '#EADDFF',
          surface: '#FEF7FF',
          'surface-container': '#F3EDF7',
          'surface-container-high': '#ECE6F0',
        },
      },
    },
  },
})
