import {defineConfig} from 'vite'
import {svelte} from '@sveltejs/vite-plugin-svelte'
export default defineConfig({
    plugins: [svelte()],
    server: {host: '127.0.0.1', port: 1234},
    preview: {host: '127.0.0.1', port: 4173},
    build: {outDir: 'dist', target: 'es2020'},
})
