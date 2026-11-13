import {defineConfig} from 'vite'
import {svelte} from '@sveltejs/vite-plugin-svelte'
export default defineConfig({
    plugins: [svelte()],
    server: {host: 'localhost', port: 1234},
    preview: {host: 'localhost', port: 4173},
    build: {outDir: 'dist', target: 'es2020'},
})
