import { defineConfig } from 'vite';

// `base: './'` for the production build emits relative asset URLs, so the app
// works when served from a GitHub Pages project subpath
// (e.g. https://user.github.io/Weeping-Angels/) without hardcoding the repo
// name. Dev server stays at root ('/').
export default defineConfig(({ command }) => ({
  root: '.',
  base: command === 'build' ? './' : '/',
  server: {
    port: 5173,
    open: false,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
}));
