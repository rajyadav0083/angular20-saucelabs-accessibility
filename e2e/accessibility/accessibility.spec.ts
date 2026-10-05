import { test, expect, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';

// WCAG 2.0, 2.1 and 2.2, Levels A and AA.
export const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];

const RAW_DIR = path.join('reports', 'a11y', 'raw');
const SHOT_DIR = path.join('reports', 'a11y', 'screenshots');

const pages = [{ name: 'home', path: '/' }];

async function captureViolationScreenshots(page: Page, target: string, violations: any[]) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const shots: Record<string, string[]> = {};
  for (const violation of violations) {
    shots[violation.id] = [];
    for (const [i, node] of violation.nodes.entries()) {
      const selector = node.target.flat().join(' ');
      const file = path.join(SHOT_DIR, `${target}-${violation.id}-${i + 1}.png`);
      const locator = page.locator(selector).first();
      await locator.evaluate((el: HTMLElement) => {
        el.style.outline = '4px solid #d00';
        el.style.outlineOffset = '2px';
      });
      await page.screenshot({ path: file, fullPage: true });
      await locator.evaluate((el: HTMLElement) => {
        el.style.outline = '';
        el.style.outlineOffset = '';
      });
      shots[violation.id].push(path.relative(path.join('reports', 'a11y'), file));
    }
  }
  return shots;
}

test.describe('WCAG 2.2 Level A/AA automated scan (axe-core)', () => {
  for (const p of pages) {
    test(`${p.name} page has no automatically detectable WCAG 2.2 A/AA violations`, async ({
      page,
      browserName,
    }, testInfo) => {
      const target = `playwright-${testInfo.project.name}-${p.name}`;
      await page.goto(p.path);
      await page.waitForLoadState('networkidle');
      // Guard against scanning a dev-server error page instead of the rendered app.
      await expect(page.locator('app-root > *').first()).toBeVisible();

      const results = await new AxeBuilder({ page }).withTags(WCAG_AA_TAGS).analyze();

      const screenshots = await captureViolationScreenshots(page, target, results.violations);
      fs.mkdirSync(RAW_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(RAW_DIR, `${target}.json`),
        JSON.stringify(
          {
            target,
            runner: 'playwright',
            environment: { browserName, project: testInfo.project.name, location: 'local' },
            page: p,
            tags: WCAG_AA_TAGS,
            screenshots,
            results,
          },
          null,
          2,
        ),
      );

      expect(
        results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s)`),
      ).toEqual([]);
    });
  }
});
