/**
 * GPU 3D 격자 모드 화면 테스트. CI(GPU 없음)에서는 SwiftShader로 돌므로 낮은 해상도(λ/16)로 한다.
 */
import { expect, test, type Page } from '@playwright/test';

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

/** 강성 패널의 '덫 위치 (x, y, z) mm' 읽기 */
async function trapPos(page: Page): Promise<number[]> {
  const t = (await page.locator('.stiffness .stat').filter({ hasText: '덫 위치' }).locator('dd').textContent()) ?? '';
  const m = /\(([-\d.]+), ([-\d.]+), ([-\d.]+)\) mm/.exec(t);
  if (!m) throw new Error(`덫 위치 형식: ${t}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

test.describe('3D 페이지 GPU 3D 격자 모드', () => {
  test('GPU 계산이 CPU 기준값과 일치하고 공이 뜸', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('./3d.html?res=low&selftest');
    const st = page.locator('.stiffness .selftest dd');
    await expect(st).toBeVisible({ timeout: 60_000 });
    const text = (await st.textContent()) ?? '';
    const nums = [...text.matchAll(/(\d\.\d)e(-?\d+)/g)].map((m) => Number(`${m[1]}e${m[2]}`));
    expect(nums.length).toBe(3);
    for (const v of nums) expect(v).toBeLessThan(1e-3);
    await expect(page.locator('.stats .status strong').first()).toHaveText('부양', { timeout: 60_000 });
    await expect(page.locator('.stiffness .status strong')).toHaveText('안정');
    // 축대칭이면 덫은 축 위
    const [x, y] = await trapPos(page);
    expect(Math.hypot(x, y)).toBeLessThan(0.05);
    expect(errors).toEqual([]);
  });

  test('위 발생기를 기울이면 덫이 y로, 옆으로 어긋나게 하면 x로 옮겨감', async ({ page }) => {
    await page.goto('./3d.html?res=low');
    await expect(page.locator('.stiffness .stat').first()).toBeVisible({ timeout: 60_000 });
    await setSlider(page, '위 발생기 기울기', 5);
    await expect.poll(async () => (await trapPos(page))[1], { timeout: 60_000 }).toBeGreaterThan(0.1);
    expect(Math.abs((await trapPos(page))[0])).toBeLessThan(0.05);
    await setSlider(page, '위 발생기 기울기', 0);
    await setSlider(page, '위 발생기 옆 어긋남', 2);
    await expect.poll(async () => (await trapPos(page))[0], { timeout: 60_000 }).toBeGreaterThan(0.3);
  });

  test('3D 표시 전환: 값·볼륨/등치면·절반 자르기마다 화면이 바뀌고 오류 없음', async ({ page }) => {
    test.setTimeout(240_000); // SwiftShader에서는 레이 마칭 한 프레임이 느림
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('./3d.html?res=low');
    await expect(page.locator('.stiffness .stat').first()).toBeVisible({ timeout: 60_000 });
    const canvas = page.locator('canvas.view3d-canvas');
    const shots: Buffer[] = [await canvas.screenshot()];
    const step = async (act: () => Promise<unknown>) => {
      await act();
      await page.waitForTimeout(800);
      const s = await canvas.screenshot();
      expect(shots.every((p) => Buffer.compare(p, s) !== 0)).toBe(true);
      shots.push(s);
    };
    await step(() => page.getByRole('combobox', { name: '표현' }).selectOption('iso'));
    await step(() => page.getByRole('checkbox', { name: '절반 자르기' }).check());
    await step(() => page.getByRole('combobox', { name: '값' }).selectOption('potential'));
    await step(() => page.getByRole('combobox', { name: '값' }).selectOption('instant'));
    expect(errors).toEqual([]);
  });
});
