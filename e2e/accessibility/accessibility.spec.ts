import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('WCAG 2.2 Accessibility', () => {

  test('Hello World page should meet WCAG 2.2', async ({ page }) => {

    await page.goto(process.env['BASE_URL'] || 'http://localhost:4200');

    await page.waitForLoadState('networkidle');

    const accessibilityScanResults =
      await new AxeBuilder({ page })
        .withTags([
          'wcag2a',
          'wcag2aa',
          'wcag21a',
          'wcag21aa',
          'wcag22aa'
        ])
        .analyze();

    console.log(
      JSON.stringify(
        accessibilityScanResults.violations,
        null,
        2
      )
    );

    expect(
      accessibilityScanResults.violations
    ).toEqual([]);
  });

});