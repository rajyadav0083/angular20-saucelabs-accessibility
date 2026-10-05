# Recommended Angular fixes (not applied)

> Generated from automated axe-core findings. No application code has been changed.

No automated WCAG 2.2 A/AA violations were detected on any target, so there are no automated fixes to recommend.

Remaining risk is in the manual checks listed in `summary.md`. Suggested Angular follow-ups for those:

- **2.4.7 / 1.4.11** — keep a visible `:focus-visible` outline with 3:1 contrast on inputs and the submit button in `src/app/app.css`.
- **3.3.1 / 3.3.3** — when validation is added, render errors as text linked with `aria-describedby` and set `aria-invalid` from the form control state.
- **4.1.3** — confirm the submit status region (`role="status"` / `aria-live="polite"`) in `src/app/app.html` is announced by VoiceOver and TalkBack.
- **2.5.8** — keep the submit button and any future icon buttons at least 24x24 CSS px.
- **2.4.2** — set per-route titles with the router `title` property once more routes exist.
