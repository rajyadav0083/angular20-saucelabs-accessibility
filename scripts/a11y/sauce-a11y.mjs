// Runs the axe-core WCAG 2.2 A/AA scan on Sauce Labs (via a Sauce Connect tunnel)
// and writes one raw result file per target to reports/a11y/raw/.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { remote } from 'webdriverio';

const require = createRequire(import.meta.url);
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const WCAG_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
const REGION = process.env.SAUCE_REGION || 'eu-central-1';
// Browsers bypass proxies for localhost, so use a non-loopback hostname reachable via the tunnel.
const BASE_URL = process.env.A11Y_BASE_URL || 'http://localhost:4200';
const TUNNEL = process.env.SAUCE_TUNNEL_NAME || 'angular20-a11y-tunnel';
const BUILD = process.env.SAUCE_BUILD || `angular20-a11y-wcag22-${new Date().toISOString().slice(0, 16)}`;
const PAGES = [{ name: 'home', path: '/' }];
const RAW_DIR = path.join('reports', 'a11y', 'raw');
const SHOT_DIR = path.join('reports', 'a11y', 'screenshots');

const sauceOptions = (name) => ({
  name,
  build: BUILD,
  tunnelName: TUNNEL,
  tags: ['a11y', 'wcag22', 'axe-core'],
});

export const TARGETS = {
  'desktop-chrome': {
    label: 'Desktop Chrome (Windows 11, latest)',
    capabilities: {
      browserName: 'chrome',
      browserVersion: 'latest',
      platformName: 'Windows 11',
      'sauce:options': { ...sauceOptions('WCAG 2.2 AA - Desktop Chrome'), screenResolution: '1920x1080' },
    },
  },
  // Sauce virtual devices: this account's public real-device pool rejects Sauce Connect
  // sessions ("Device usage with Sauce Connect is only allowed if Sauce Connect is enabled
  // for Public Cloud"), so mobile browsers run on Sauce emulators/simulators.
  'android-chrome': {
    label: 'Android Chrome (Sauce Android emulator)',
    capabilities: {
      platformName: 'Android',
      browserName: 'Chrome',
      'appium:deviceName': process.env.SAUCE_ANDROID_DEVICE || 'Google Pixel 9 Emulator',
      'appium:platformVersion': process.env.SAUCE_ANDROID_VERSION || '16.0',
      'appium:automationName': 'UiAutomator2',
      'sauce:options': { ...sauceOptions('WCAG 2.2 AA - Android Chrome'), appiumVersion: process.env.SAUCE_ANDROID_APPIUM || '2.11.0' },
    },
  },
  'ios-safari': {
    label: 'iOS Safari (Sauce iOS simulator)',
    capabilities: {
      platformName: 'iOS',
      browserName: 'Safari',
      'appium:deviceName': process.env.SAUCE_IOS_DEVICE || 'iPhone 16 Simulator',
      'appium:platformVersion': process.env.SAUCE_IOS_VERSION || '27.0',
      'appium:automationName': 'XCUITest',
      'sauce:options': { ...sauceOptions('WCAG 2.2 AA - iOS Safari'), appiumVersion: process.env.SAUCE_IOS_APPIUM || '3.3.0' },
    },
  },
};

async function setJobResult(sessionId, passed) {
  const auth = Buffer.from(`${process.env.SAUCE_USERNAME}:${process.env.SAUCE_ACCESS_KEY}`).toString('base64');
  const res = await fetch(`https://api.${REGION}.saucelabs.com/rest/v1/${process.env.SAUCE_USERNAME}/jobs/${sessionId}`, {
    method: 'PUT',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ passed }),
  });
  if (!res.ok) console.warn(`could not set job result for ${sessionId}: HTTP ${res.status}`);
}

async function waitForAngular(browser) {
  await browser.waitUntil(
    () =>
      browser.execute(() => {
        const t = window.getAllAngularTestabilities?.();
        return (
          document.readyState === 'complete' &&
          !!document.querySelector('app-root > *') &&
          (!t || t.every((x) => x.isStable()))
        );
      }),
    { timeout: 30000, interval: 500, timeoutMsg: 'Angular app did not render/stabilise' },
  );
}

async function screenshotViolations(browser, target, violations) {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const shots = {};
  for (const v of violations) {
    shots[v.id] = [];
    for (const [i, node] of v.nodes.entries()) {
      const selector = node.target.flat().join(' ');
      await browser.execute((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.style.outline = '4px solid #d00';
          el.scrollIntoView({ block: 'center' });
        }
      }, selector);
      const file = path.join(SHOT_DIR, `${target}-${v.id}-${i + 1}.png`);
      await browser.saveScreenshot(file);
      await browser.execute((sel) => {
        const el = document.querySelector(sel);
        if (el) el.style.outline = '';
      }, selector);
      shots[v.id].push(path.relative(path.join('reports', 'a11y'), file));
    }
  }
  return shots;
}

async function runTarget(key) {
  const { label, capabilities } = TARGETS[key];
  const started = new Date().toISOString();
  let browser;
  try {
    browser = await remote({
      user: process.env.SAUCE_USERNAME,
      key: process.env.SAUCE_ACCESS_KEY,
      hostname: `ondemand.${REGION}.saucelabs.com`,
      port: 443,
      protocol: 'https',
      path: '/wd/hub',
      logLevel: 'warn',
      connectionRetryTimeout: 300000,
      capabilities,
    });
    const sessionId = browser.sessionId;
    // Safari/XCUITest defaults to a near-zero async script timeout.
    await browser.setTimeout({ script: 120000, pageLoad: 120000 });
    console.log(`[${key}] Sauce session ${sessionId}`);
    let total = 0;
    for (const p of PAGES) {
      await browser.url(new URL(p.path, BASE_URL).toString());
      await waitForAngular(browser);
      await browser.execute(axeSource);
      const results = await browser.executeAsync((tags, done) => {
        window.axe
          .run(document, { runOnly: { type: 'tag', values: tags } })
          .then((r) => done(JSON.parse(JSON.stringify(r))))
          .catch((e) => done({ error: String(e) }));
      }, WCAG_AA_TAGS);
      if (results.error) throw new Error(results.error);
      const target = `sauce-${key}-${p.name}`;
      const screenshots = await screenshotViolations(browser, target, results.violations);
      if (!results.violations.length) {
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        await browser.saveScreenshot(path.join(SHOT_DIR, `${target}-page.png`));
      }
      total += results.violations.length;
      fs.mkdirSync(RAW_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(RAW_DIR, `${target}.json`),
        JSON.stringify(
          {
            target,
            runner: 'sauce-labs-webdriverio',
            environment: {
              label,
              location: `Sauce Labs ${REGION}`,
              requested: capabilities,
              returned: browser.capabilities,
              sessionId,
              build: BUILD,
              tunnel: TUNNEL,
              jobUrl: `https://app.${REGION}.saucelabs.com/tests/${sessionId}`,
              started,
            },
            page: p,
            tags: WCAG_AA_TAGS,
            screenshots,
            results,
          },
          null,
          2,
        ),
      );
      console.log(`[${key}] ${p.name}: ${results.violations.length} violation rule(s)`);
    }
    await setJobResult(sessionId, total === 0);
    return { key, ok: true, sessionId, violations: total };
  } catch (err) {
    console.error(`[${key}] ERROR ${err.message}`);
    fs.mkdirSync(RAW_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(RAW_DIR, `sauce-${key}-error.json`),
      JSON.stringify({ target: `sauce-${key}`, label, error: err.message, sessionId: browser?.sessionId, started }, null, 2),
    );
    return { key, ok: false, error: err.message, sessionId: browser?.sessionId };
  } finally {
    await browser?.deleteSession().catch(() => {});
  }
}

const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TARGETS);
const outcomes = await Promise.all(keys.map(runTarget));
console.table(outcomes);
process.exit(outcomes.every((o) => o.ok) ? 0 : 1);
