import {defineConfig} from '@playwright/test'
export default defineConfig({
    testDir: './tests/e2e',
    testMatch: '*.spec.ts',
    fullyParallel: false,
    workers: 1,
    use: {
        baseURL: 'http://localhost:4174',
        viewport: {width: 1440, height: 900},
        trace: 'retain-on-failure',
    },
    webServer: {
        command: 'npm run preview -- --port 4174 --strictPort',
        url: 'http://localhost:4174',
        reuseExistingServer: false,
    },
})
