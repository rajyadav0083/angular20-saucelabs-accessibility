// Combines raw axe results from reports/a11y/raw/ into
// accessibility.json, accessibility.html, summary.md and fixes.md.
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.A11Y_REPORT_DIR || path.join('reports', 'a11y');
const RAW = path.join(OUT, 'raw');
const SRC = 'src';

const SC_NAMES = {
  '1.1.1': 'Non-text Content (A)', '1.2.2': 'Captions (Prerecorded) (A)', '1.3.1': 'Info and Relationships (A)',
  '1.3.5': 'Identify Input Purpose (AA)', '1.4.1': 'Use of Color (A)', '1.4.2': 'Audio Control (A)',
  '1.4.3': 'Contrast (Minimum) (AA)', '1.4.4': 'Resize Text (AA)', '1.4.12': 'Text Spacing (AA)',
  '2.1.1': 'Keyboard (A)', '2.2.1': 'Timing Adjustable (A)', '2.2.2': 'Pause, Stop, Hide (A)',
  '2.4.1': 'Bypass Blocks (A)', '2.4.2': 'Page Titled (A)', '2.4.4': 'Link Purpose (In Context) (A)',
  '2.5.3': 'Label in Name (A)', '2.5.8': 'Target Size (Minimum) (AA)', '3.1.1': 'Language of Page (A)',
  '3.1.2': 'Language of Parts (AA)', '3.3.2': 'Labels or Instructions (A)', '4.1.1': 'Parsing (obsolete in 2.2)',
  '4.1.2': 'Name, Role, Value (A)', '4.1.3': 'Status Messages (AA)',
};

const MANUAL_CHECKS = [
  ['1.3.2', 'Meaningful Sequence', 'Reading/DOM order matches visual order.'],
  ['1.3.4', 'Orientation', 'Page works in portrait and landscape on the mobile targets.'],
  ['1.4.10', 'Reflow', 'No 2-D scrolling at 320 CSS px / 400% zoom.'],
  ['1.4.11', 'Non-text Contrast', 'Input borders, focus rings and button boundaries reach 3:1.'],
  ['1.4.13', 'Content on Hover or Focus', 'Any tooltip/popover is dismissible, hoverable, persistent.'],
  ['2.1.1 / 2.1.2', 'Keyboard / No Keyboard Trap', 'All controls operable by keyboard alone; no traps.'],
  ['2.4.3', 'Focus Order', 'Tab order is logical.'],
  ['2.4.6', 'Headings and Labels', 'Headings and labels are descriptive (axe only checks presence).'],
  ['2.4.7', 'Focus Visible', 'Every focusable element shows a visible focus indicator.'],
  ['2.4.11', 'Focus Not Obscured (Minimum) (new in 2.2)', 'Focused element is not hidden by sticky content.'],
  ['2.5.7', 'Dragging Movements (new in 2.2)', 'Any drag interaction has a single-pointer alternative.'],
  ['2.5.8', 'Target Size (Minimum) (new in 2.2)', 'Targets are at least 24x24 CSS px or spaced (axe check is partial).'],
  ['3.2.1 / 3.2.2', 'On Focus / On Input', 'No unexpected context change on focus or input.'],
  ['3.2.6', 'Consistent Help (new in 2.2)', 'Help mechanisms appear in the same relative order across pages.'],
  ['3.3.1 / 3.3.3', 'Error Identification / Suggestion', 'Validation errors are announced in text with suggestions.'],
  ['3.3.7', 'Redundant Entry (new in 2.2)', 'Previously entered info is auto-filled or selectable.'],
  ['3.3.8', 'Accessible Authentication (Minimum) (new in 2.2)', 'No cognitive function test for login, if added.'],
  ['4.1.3', 'Status Messages', 'Submit status is announced by screen readers (VoiceOver/TalkBack test).'],
  ['—', 'Assistive technology pass', 'Screen reader (NVDA/VoiceOver/TalkBack), zoom and voice control walkthrough.'],
];

const FIXES = {
  'document-title': 'Set a descriptive `<title>` in `src/index.html` and per route via `title` in `app.routes.ts` (Angular `Title`/`TitleStrategy`).',
  'html-has-lang': 'Add `lang="en"` to `<html>` in `src/index.html` (and set `i18n.sourceLocale` in `angular.json` if localised).',
  'html-lang-valid': 'Use a valid BCP 47 value for `<html lang>` in `src/index.html`.',
  label: 'Associate a visible `<label for="id">` with each control (or wrap the control), e.g. `<label for="name">Name</label><input id="name" formControlName="name">`.',
  'color-contrast': 'Adjust the CSS colour in the component stylesheet to reach 4.5:1 (3:1 for large text).',
  'button-name': 'Give the `<button>` visible text or `aria-label`; for icon buttons use `[attr.aria-label]="..."`.',
  'link-name': 'Give each `<a>` discernible text, or `aria-label` for icon-only links.',
  'image-alt': 'Add `alt` (or `[alt]` binding); use `alt=""` for decorative images.',
  'aria-allowed-attr': 'Remove ARIA attributes not permitted on the element\'s role.',
  'aria-required-attr': 'Add the ARIA attributes required by the role (e.g. `aria-checked` on `role="checkbox"`).',
  'aria-valid-attr-value': 'Fix ARIA attribute values, e.g. `aria-labelledby` must reference existing ids.',
  'duplicate-id-aria': 'Make ids unique; in repeated templates derive them from an index or signal.',
  'select-name': 'Label the `<select>` with `<label for>` or `aria-label`.',
  'target-size': 'Give interactive targets at least 24x24 CSS px (padding/min-width/min-height) in the component CSS.',
  'autocomplete-valid': 'Use valid `autocomplete` tokens (e.g. `name`, `email`) on personal-data inputs.',
  'list': 'Only `<li>`, `<script>` or `<template>` may be direct children of `<ul>/<ol>`; fix `@for` output wrappers.',
  'listitem': 'Ensure `<li>` is inside `<ul>`/`<ol>`.',
  'nested-interactive': 'Do not nest focusable elements inside buttons/links; restructure the template.',
};

function scFromTags(tags) {
  return tags
    .map((t) => /^wcag(\d)(\d)(\d+)$/.exec(t))
    .filter(Boolean)
    .map((m) => `${m[1]}.${m[2]}.${m[3]}`);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(html|ts|css|scss)$/.test(e.name) && !e.name.endsWith('.spec.ts') ? [p] : [];
  });
}
const sourceFiles = walk(SRC).map((f) => ({ f, lines: fs.readFileSync(f, 'utf8').split('\n') }));

function locateSource(ruleId, node) {
  if (['document-title', 'html-has-lang', 'html-lang-valid', 'meta-viewport'].includes(ruleId)) return ['src/index.html'];
  const html = node.html || '';
  const tokens = [];
  const id = /\sid="([^"]+)"/.exec(html);
  if (id) tokens.push(`id="${id[1]}"`, `#${id[1]}`);
  const cls = /\sclass="([^"]+)"/.exec(html);
  if (cls) cls[1].split(/\s+/).filter((c) => c && !c.startsWith('ng-')).forEach((c) => tokens.push(c));
  const tag = /^<([a-z0-9-]+)/i.exec(html);
  if (!tokens.length && tag) tokens.push(`<${tag[1]}`);
  const hits = [];
  for (const { f, lines } of sourceFiles) {
    lines.forEach((l, i) => {
      if (tokens.some((t) => l.includes(t))) hits.push(`${f}:${i + 1}`);
    });
  }
  return hits.slice(0, 5);
}

const raws = fs.existsSync(RAW) ? fs.readdirSync(RAW).filter((f) => f.endsWith('.json')).sort() : [];
const jobsFile = path.join(OUT, 'sauce-jobs.json');
const sauceJobs = fs.existsSync(jobsFile) ? JSON.parse(fs.readFileSync(jobsFile, 'utf8')) : {};

const targets = [];
for (const file of raws) {
  const raw = JSON.parse(fs.readFileSync(path.join(RAW, file), 'utf8'));
  if (raw.error) {
    targets.push({ target: raw.target, label: raw.label, status: 'error', error: raw.error, sessionId: raw.sessionId ?? null, violations: [], incomplete: [] });
    continue;
  }
  const env = raw.environment;
  const job = env.sessionId ? sauceJobs[env.sessionId] : undefined;
  const violations = raw.results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    description: v.description,
    helpUrl: v.helpUrl,
    wcagTags: v.tags.filter((t) => t.startsWith('wcag')),
    successCriteria: scFromTags(v.tags).map((sc) => ({ sc, name: SC_NAMES[sc] || '' })),
    nodes: v.nodes.map((n) => ({ target: n.target, html: n.html, failureSummary: n.failureSummary, likelySource: locateSource(v.id, n) })),
    screenshots: raw.screenshots?.[v.id] || [],
    recommendedFix: FIXES[v.id] || `See ${v.helpUrl}`,
  }));
  targets.push({
    target: raw.target,
    label: env.label || 'Local Playwright (localhost dev server)',
    runner: raw.runner,
    location: env.location,
    page: raw.page,
    url: raw.results.url,
    sessionId: env.sessionId || null,
    jobUrl: env.jobUrl || null,
    sauceJob: job || null,
    browser: env.returned
      ? {
          browserName: env.returned.browserName,
          browserVersion: env.returned.browserVersion || job?.browser_version,
          platformName: env.returned.platformName,
          platformVersion: env.requested['appium:platformVersion'] === (env.returned.browserVersion || job?.browser_version) ? undefined : env.requested['appium:platformVersion'],
          deviceName: env.requested['appium:deviceName'],
        }
      : { browserName: env.browserName },
    axeVersion: raw.results.testEngine.version,
    timestamp: raw.results.timestamp,
    tags: raw.tags,
    status: violations.length ? 'violations' : 'pass',
    counts: { rulesPassed: raw.results.passes.length, rulesIncomplete: raw.results.incomplete.length, rulesInapplicable: raw.results.inapplicable.length },
    violations,
    incomplete: raw.results.incomplete.map((i) => ({ id: i.id, impact: i.impact, help: i.help, nodes: i.nodes.length, successCriteria: scFromTags(i.tags) })),
  });
}

const impacts = ['critical', 'serious', 'moderate', 'minor'];
const allV = targets.flatMap((t) => t.violations.map((v) => ({ ...v, target: t.target })));
const byImpact = Object.fromEntries(impacts.map((i) => [i, allV.filter((v) => v.impact === i).length]));
const uniqueRules = [...new Map(allV.map((v) => [v.id, v])).values()];
const criteria = [...new Set(allV.flatMap((v) => v.successCriteria.map((s) => s.sc)))].sort();

const report = {
  generatedAt: new Date().toISOString(),
  standard: 'WCAG 2.2 Level A + AA (axe-core tags: ' + (targets.find((t) => t.tags)?.tags || []).join(', ') + ')',
  disclaimer: 'Automated axe-core results only. Passing these rules does not demonstrate WCAG 2.2 AA conformance; the manual checks listed must also be completed.',
  totals: { targets: targets.length, targetsErrored: targets.filter((t) => t.status === 'error').length, violationInstances: allV.length, uniqueRules: uniqueRules.length, nodes: allV.reduce((n, v) => n + v.nodes.length, 0), byImpact },
  successCriteriaFailed: criteria.map((sc) => ({ sc, name: SC_NAMES[sc] || '' })),
  targets,
  manualChecks: MANUAL_CHECKS.map(([sc, name, check]) => ({ sc, name, check, status: 'not tested (manual)' })),
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'accessibility.json'), JSON.stringify(report, null, 2));

// ---------- Markdown summary ----------
const md = [];
const jobLink = (t) =>
  (t.jobUrl ? `[${t.sessionId}](${t.jobUrl})` : t.sessionId || '—') + (t.sauceJob ? ` (MCP: ${t.sauceJob.consolidated_status})` : '');
md.push('# Accessibility summary — WCAG 2.2 A/AA (automated)', '');
md.push(`Generated: ${report.generatedAt}  `, `Standard: ${report.standard}`, '');
md.push(`> **${report.disclaimer}**`, '');
md.push('## Execution', '', '| Target | Environment | Runner | axe | Result | Violations (rules / nodes) | Needs review | Sauce job |', '|---|---|---|---|---|---|---|---|');
for (const t of targets) {
  const b = t.browser ? [t.browser.browserName, t.browser.browserVersion, t.browser.platformName, t.browser.platformVersion, t.browser.deviceName].filter(Boolean).join(' · ') : '';
  md.push(`| ${t.target} | ${t.label}${b ? ` (${b})` : ''} | ${t.runner || '—'} | ${t.axeVersion || '—'} | ${t.status}${t.error ? `: ${t.error.split('\n')[0]}` : ''} | ${t.violations.length} / ${t.violations.reduce((n, v) => n + v.nodes.length, 0)} | ${t.incomplete.length} | ${jobLink(t)} |`);
}
if (sauceJobs._tunnel) md.push('', `Sauce Connect tunnel \`${sauceJobs._tunnel.name}\` (${sauceJobs._tunnel.id}); build \`${sauceJobs._build?.name}\`. ${sauceJobs._build?.note || ''}`);
md.push('', '## Violation counts (all targets)', '', '| Critical | Serious | Moderate | Minor | Total |', '|---|---|---|---|---|');
md.push(`| ${byImpact.critical} | ${byImpact.serious} | ${byImpact.moderate} | ${byImpact.minor} | ${allV.length} |`, '');
md.push('## WCAG success criteria with automated failures', '');
md.push(criteria.length ? criteria.map((sc) => `- ${sc} ${SC_NAMES[sc] || ''}`).join('\n') : '_None detected by the automated rules on the scanned page(s)._', '');
if (uniqueRules.length) {
  md.push('## Violations', '', '| Rule | Impact | WCAG SC | Targets | Likely source |', '|---|---|---|---|---|');
  for (const r of uniqueRules) {
    const ts = allV.filter((v) => v.id === r.id).map((v) => v.target).join(', ');
    md.push(`| ${r.id} | ${r.impact} | ${r.successCriteria.map((s) => s.sc).join(', ')} | ${ts} | ${[...new Set(r.nodes.flatMap((n) => n.likelySource))].join('<br>')} |`);
  }
  md.push('', 'See `fixes.md` for recommended Angular fixes.', '');
}
const inc = targets.flatMap((t) => t.incomplete.map((i) => ({ ...i, target: t.target })));
md.push('## Automated "needs review" results', '', inc.length ? inc.map((i) => `- ${i.target}: \`${i.id}\` (${i.help}) — ${i.nodes} node(s)`).join('\n') : '_None._', '');
md.push('## Manual WCAG 2.2 AA checks (not covered by automation — outstanding)', '', '| SC | Criterion | What to verify | Status |', '|---|---|---|---|');
for (const m of report.manualChecks) md.push(`| ${m.sc} | ${m.name} | ${m.check} | ${m.status} |`);
md.push('', '## Artifacts', '', '- `reports/a11y/accessibility.json` — combined machine-readable results', '- `reports/a11y/accessibility.html` — HTML report', '- `reports/a11y/fixes.md` — recommended Angular fixes', '- `reports/a11y/raw/` — raw axe output per target', '- `reports/a11y/screenshots/` — page/violation screenshots', '- `reports/a11y/sauce-jobs.json` — Sauce job details retrieved via the Sauce Labs MCP', '');
fs.writeFileSync(path.join(OUT, 'summary.md'), md.join('\n'));

// ---------- fixes.md ----------
const fx = ['# Recommended Angular fixes (not applied)', '', '> Generated from automated axe-core findings. No application code has been changed.', ''];
if (!uniqueRules.length) {
  fx.push('No automated WCAG 2.2 A/AA violations were detected on any target, so there are no automated fixes to recommend.', '');
  fx.push('Remaining risk is in the manual checks listed in `summary.md`. Suggested Angular follow-ups for those:', '');
  fx.push('- **2.4.7 / 1.4.11** — keep a visible `:focus-visible` outline with 3:1 contrast on inputs and the submit button in `src/app/app.css`.');
  fx.push('- **3.3.1 / 3.3.3** — when validation is added, render errors as text linked with `aria-describedby` and set `aria-invalid` from the form control state.');
  fx.push('- **4.1.3** — confirm the submit status region (`role="status"` / `aria-live="polite"`) in `src/app/app.html` is announced by VoiceOver and TalkBack.');
  fx.push('- **2.5.8** — keep the submit button and any future icon buttons at least 24x24 CSS px.');
  fx.push('- **2.4.2** — set per-route titles with the router `title` property once more routes exist.', '');
}
for (const r of uniqueRules) {
  const inst = allV.filter((v) => v.id === r.id);
  fx.push(`## \`${r.id}\` — ${r.help}`, '');
  fx.push(`- Impact: **${r.impact}**`, `- WCAG: ${r.successCriteria.map((s) => `${s.sc} ${s.name}`).join('; ')}`, `- Targets: ${inst.map((v) => v.target).join(', ')}`, `- Reference: ${r.helpUrl}`, '');
  fx.push('**Affected elements**', '');
  for (const n of r.nodes) fx.push(`- \`${n.target.flat().join(' ')}\` → ${n.likelySource.join(', ') || 'source not located'}`, '  ```html', `  ${n.html}`, '  ```');
  fx.push('', `**Approximate fix:** ${r.recommendedFix}`, '');
  const shots = [...new Set(inst.flatMap((v) => v.screenshots))];
  if (shots.length) fx.push('**Screenshots:** ' + shots.map((s) => `[${path.basename(s)}](${s})`).join(', '), '');
}
fs.writeFileSync(path.join(OUT, 'fixes.md'), fx.join('\n'));

// ---------- HTML ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const rows = targets
  .map((t) => `<tr><td>${esc(t.target)}</td><td>${esc(t.label)}</td><td>${esc(t.browser ? Object.values(t.browser).filter(Boolean).join(' · ') : '')}</td><td class="${t.status}">${esc(t.status)}${t.error ? `<br><small>${esc(t.error.split('\n')[0])}</small>` : ''}</td><td>${t.violations.length}</td><td>${t.incomplete.length}</td><td>${t.counts?.rulesPassed ?? '—'}</td><td>${t.jobUrl ? `<a href="${esc(t.jobUrl)}">${esc(t.sessionId)}</a>${t.sauceJob ? `<br><small>MCP: ${esc(t.sauceJob.consolidated_status)}</small>` : ''}` : '—'}</td></tr>`)
  .join('\n');
const vrows = allV
  .map((v) => `<tr><td>${esc(v.target)}</td><td><a href="${esc(v.helpUrl)}">${esc(v.id)}</a></td><td class="${esc(v.impact)}">${esc(v.impact)}</td><td>${esc(v.successCriteria.map((s) => `${s.sc} ${s.name}`).join('; '))}</td><td>${v.nodes.map((n) => `<code>${esc(n.target.flat().join(' '))}</code><br><small>${esc(n.likelySource.join(', '))}</small>`).join('<hr>')}</td><td>${esc(v.recommendedFix)}</td><td>${v.screenshots.map((s) => `<a href="${esc(s)}"><img src="${esc(s)}" alt="Screenshot of ${esc(v.id)} on ${esc(v.target)}" width="160"></a>`).join('')}</td></tr>`)
  .join('\n');
const mrows = report.manualChecks.map((m) => `<tr><td>${esc(m.sc)}</td><td>${esc(m.name)}</td><td>${esc(m.check)}</td><td>${esc(m.status)}</td></tr>`).join('\n');
const shotsAll = fs.existsSync(path.join(OUT, 'screenshots')) ? fs.readdirSync(path.join(OUT, 'screenshots')).filter((f) => f.endsWith('-page.png')) : [];
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Accessibility report — WCAG 2.2 A/AA (automated)</title>
<style>
body{font:15px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:1200px;padding:0 1rem;color:#1a1a1a}
table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #bbb;padding:.4rem .6rem;text-align:left;vertical-align:top}
th{background:#eef1f5}.pass{color:#0a6b2e;font-weight:600}.error,.critical,.violations{color:#a4000f;font-weight:600}.serious{color:#a4000f}.moderate{color:#7a4a00}
.note{border-left:4px solid #7a4a00;background:#fff8e8;padding:.6rem 1rem}.cards{display:flex;gap:1rem;flex-wrap:wrap}
.card{border:1px solid #bbb;border-radius:6px;padding:.6rem 1rem;min-width:8rem}.card b{display:block;font-size:1.6rem}
figure{display:inline-block;margin:.5rem}code{background:#f3f3f3;padding:0 .2rem}
</style></head><body>
<main>
<h1>Accessibility report — WCAG 2.2 Level A/AA (automated)</h1>
<p>Generated ${esc(report.generatedAt)}. ${esc(report.standard)}</p>
<p class="note"><strong>${esc(report.disclaimer)}</strong></p>
<h2>Totals</h2>
<div class="cards">
<div class="card"><b>${report.totals.targets}</b>targets</div>
<div class="card"><b>${allV.length}</b>violations</div>
<div class="card"><b>${byImpact.critical}</b>critical</div>
<div class="card"><b>${byImpact.serious}</b>serious</div>
<div class="card"><b>${byImpact.moderate}</b>moderate</div>
<div class="card"><b>${byImpact.minor}</b>minor</div>
</div>
<h2>Targets</h2>
<table><thead><tr><th>Target</th><th>Environment</th><th>Browser / platform</th><th>Result</th><th>Violations</th><th>Needs review</th><th>Rules passed</th><th>Sauce job</th></tr></thead><tbody>
${rows}
</tbody></table>
<h2>Automated violations</h2>
${allV.length ? `<table><thead><tr><th>Target</th><th>Rule</th><th>Impact</th><th>WCAG SC</th><th>Elements / likely source</th><th>Approximate Angular fix</th><th>Screenshots</th></tr></thead><tbody>${vrows}</tbody></table>` : '<p>No automated WCAG 2.2 A/AA violations were detected on any target.</p>'}
<h2>Manual WCAG 2.2 AA checks (outstanding)</h2>
<table><thead><tr><th>SC</th><th>Criterion</th><th>What to verify</th><th>Status</th></tr></thead><tbody>
${mrows}
</tbody></table>
${shotsAll.length ? `<h2>Page screenshots</h2>${shotsAll.map((s) => `<figure><img src="screenshots/${esc(s)}" alt="Page screenshot: ${esc(s)}" width="280"><figcaption>${esc(s)}</figcaption></figure>`).join('')}` : ''}
</main></body></html>
`;
fs.writeFileSync(path.join(OUT, 'accessibility.html'), html);
console.log(`targets=${targets.length} violations=${allV.length}`, byImpact);
