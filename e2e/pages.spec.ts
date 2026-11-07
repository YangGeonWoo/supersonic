/**
 * 2D·3D 페이지 화면 테스트: 열리는지, 공이 뜨는지, 조작이 결과로 이어지는지, 오류가 없는지.
 */
import { expect, test, type Page } from '@playwright/test';

/** 화면 오류(예외, console.error)를 모은다 */
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/** 라벨 글자로 슬라이더를 찾아 값을 바꾼다 (React onChange가 받도록 input 이벤트) */
async function setSlider(page: Page, labelText: string, value: number) {
  await page.evaluate(
    ([text, v]) => {
      const lab = [...document.querySelectorAll('label.slider')].find((l) => l.textContent?.includes(text as string));
      if (!lab) throw new Error(`slider not found: ${text}`);
      const el = lab.querySelector('input') as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
    },
    [labelText, value] as const,
  );
}

const mainStatus = (page: Page) => page.locator('.stats .status strong').first();

test.describe('2D 페이지', () => {
  test('열리고 공이 뜸, 주요 수치 표시', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./');
    await expect(page.getByRole('heading', { name: '초음파 공중부양' })).toBeVisible();
    await expect(mainStatus(page)).toHaveText('부양', { timeout: 45_000 });
    await expect(page.locator('.stats')).toContainText('1500 Pa');
    await expect(page.locator('.stats')).toContainText('마디 개수');
    await expect(page.locator('.size-note')).toContainText('ka = 1.10');
    expect(errors).toEqual([]);
  });

  test('구동 세기를 거의 0으로 내리면 떨어짐', async ({ page }) => {
    await page.goto('./');
    await expect(mainStatus(page)).toHaveText('부양', { timeout: 45_000 });
    await setSlider(page, '구동 세기', 0.05);
    await expect(mainStatus(page)).toHaveText('낙하', { timeout: 30_000 });
  });

  test('무게 늘리기 10×: 한계 근처에서 떨어지고 결과 표시', async ({ page }) => {
    await page.goto('./');
    await expect(mainStatus(page)).toHaveText('부양', { timeout: 45_000 });
    await page.getByRole('radio', { name: '10×' }).click();
    await page.getByRole('button', { name: '무게 늘리기 시작' }).click();
    const result = page.locator('.stats .result');
    await expect(result).toContainText('떨어짐', { timeout: 30_000 });
    // 부양 한계(2D 장) 대비 % — 95~105% 사이
    const text = (await result.textContent()) ?? '';
    const pct = Number(/대비 (\d+)%/.exec(text)?.[1]);
    expect(pct).toBeGreaterThanOrEqual(95);
    expect(pct).toBeLessThanOrEqual(105);
  });

  test('공진 맞춤 버튼이 d를 λ/2 정수배로', async ({ page }) => {
    await page.goto('./');
    await setSlider(page, '발생기 간격 d', 23);
    await page.getByRole('button', { name: /가장 가까운 공진 거리로/ }).click();
    await expect(page.getByRole('button', { name: /가장 가까운 공진 거리로/ })).toContainText('5.00 × λ/2');
  });

  test('3D 페이지로 가는 링크', async ({ page }) => {
    await page.goto('./');
    await page.getByRole('link', { name: /3D로 보기/ }).click();
    await expect(page).toHaveURL(/3d\.html$/);
  });
});

test.describe('3D 페이지 (축대칭 CPU 모드)', () => {
  test('3D 장면이 그려지고 공이 뜸, 횡방향 안정, fps 표시', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('./3d.html?mode=cpu');
    await expect(page.getByRole('heading', { name: '초음파 공중부양 3D' })).toBeVisible();
    await expect(page.locator('canvas.view3d-canvas')).toBeVisible();
    await expect(mainStatus(page)).toHaveText('부양', { timeout: 60_000 });
    await expect(page.locator('.lateral .status strong')).toHaveText('안정');
    await expect(page.locator('.lateral')).toContainText('횡방향 / 축 방향 복원력');
    await expect(page.locator('.fps')).toHaveText(/\d+ fps/);
    // WebGL 캔버스가 실제로 그려졌는지: 가운데 영역이 배경 한 색이 아님
    const shot = await page.locator('canvas.view3d-canvas').screenshot();
    expect(shot.byteLength).toBeGreaterThan(20_000);
    expect(errors).toEqual([]);
  });

  test('위 발생기 출력을 크게 줄이면 횡방향 불안정 표시', async ({ page }) => {
    await page.goto('./3d.html?mode=cpu');
    await expect(page.locator('.lateral .status strong')).toBeVisible({ timeout: 60_000 });
    await setSlider(page, '위 발생기 출력', 0.1);
    await expect(page.locator('.lateral .status strong')).toHaveText('불안정', { timeout: 30_000 });
    await expect(mainStatus(page)).toContainText('부양 (', { timeout: 30_000 });
  });

  test('밀림 효과 카드와 키보드 회전', async ({ page }) => {
    await page.goto('./3d.html?mode=cpu');
    await expect(page.locator('.push-card')).toContainText('평형 위치 이동', { timeout: 60_000 });
    const canvas = page.locator('canvas.view3d-canvas');
    await canvas.focus();
    const before = await canvas.screenshot();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(500);
    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('2D로 돌아가는 링크', async ({ page }) => {
    await page.goto('./3d.html?mode=cpu');
    await page.getByRole('link', { name: /2D 단면으로/ }).click();
    await expect(page.getByRole('heading', { name: '초음파 공중부양' })).toBeVisible();
  });
});
