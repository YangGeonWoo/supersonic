/**
 * 화면 자동 테스트 (Playwright). 빌드 결과를 vite preview로 띄워 2D·3D 페이지를 실제 브라우저에서 확인한다.
 * 로컬: npm run test:e2e   (처음 한 번 npx playwright install chromium)
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 4174;

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  // CI: 'github'는 실패 내용을 GitHub 주석으로 남긴다 (로그 권한 없이도 확인 가능)
  reporter: process.env.CI ? [['list'], ['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/`,
    viewport: { width: 1400, height: 1300 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1400, height: 1300 },
        // GPU 없는 환경(CI)에서도 WebGL(3D 페이지)이 돌도록 소프트웨어 렌더러
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
