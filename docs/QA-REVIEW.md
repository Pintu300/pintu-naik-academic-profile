# Website engineering review — 10 November 2026

The review covered the local website, its admin workflow, generated public
build, and read-only checks of the existing public deployment. No academic
content or real project records were changed. Nothing was deployed.

## 1. Browser and mobile verification

Firefox 158 completed 39 browser checks. All eight public pages were checked
at actual viewport widths of 1440, 768, 390, and 320 CSS pixels. The runner
asserts the measured width so Firefox's minimum outer-window size cannot
silently turn a mobile test into a desktop test.

Checks covered content loading, horizontal overflow, loaded images, mobile
navigation, gallery focus handling, login/logout, and the editor. No unhandled
JavaScript errors were reported. Homepage, CV, and publications screenshots
were inspected.

Issues found and fixed:

- The sticky Save bar could cover admin controls on narrow screens. It now
  stays in normal flow on mobile, with scroll margins for form controls.
- Styled elements could override the native `hidden` attribute. A global
  hidden rule now reliably hides inactive controls and content.
- The mobile hero image reduced text contrast. Its mobile background now uses
  a stronger light overlay.
- Reveal animations left below-fold CV sections invisible in printed output.
  Print styles now show all sections and disable animations. CV printing also
  waits for its images to decode. The verified A4 export contains three pages,
  with publications, research interests, teaching, and skills present.

Generated evidence: `artifacts/browser/report.json`, screenshots, and `cv.pdf`.
The artifacts are local and ignored by Git. The PDF was inspected visually and
its section text was checked using `pdftotext`.

Limit: these are Firefox viewport checks, not tests on physical phones, Safari,
or Chromium. The live visitor-statistics service was not audited end to end.

## 2. Admin workflow

The runner uses a temporary copy of `backend/data`, random test credentials,
and an isolated browser profile. It successfully exercised the following on
both 390 px and 1440 px layouts:

1. Reject incorrect login credentials and accept correct credentials.
2. Add two temporary projects and edit their contribution and code fields.
3. Reorder, remove, and restore an entry.
4. Save, open the public Projects page, and reload the editor.
5. Sign out and verify that the admin page requires login again.

Hashes of the real data files were identical before and after the test.
Projects remain empty in the actual website, ready for the owner to add later.

## 3. Performance changes

Responsive WebP variants were generated for the portrait and selected research
and profile-card photographs. The original photographs were preserved.

| Selected images | Bytes |
| --- | ---: |
| Original JPEG inputs | 1,152,728 |
| Largest generated display variants | 510,194 |
| Reduction at those display sizes | 56% |

The variants include small portraits for the navigation and larger files for
the hero and cards. HTML supplies `srcset`, `sizes`, and dimensions. A changed
profile photo falls back to its original path when no matching prepared
variants exist.

The Node server now compresses eligible text responses and supports public
asset revalidation through ETags. Edited assets produce new ETags. Admin pages,
code, and API responses remain `no-store`. Tests verify gzip negotiation,
unchanged-asset 304 responses, and edited-asset freshness.

Localhost no longer initializes Google Analytics, preventing development and
browser-test visits from inflating the real visitor statistics.

The browser report includes local resource and paint timing samples. They are
unthrottled localhost measurements, may reuse decoded images across navigations,
and are not field Core Web Vitals or a Lighthouse score. Firefox did not expose
layout-shift measurements in this run; no CLS value is claimed.

## 4. Publication review

The existing publication records were retained. Crossref returned matching
titles and author lists for both supplied DOIs.

| Record | Finding | Action |
| --- | --- | --- |
| IEEE crowd-counting conference paper | DOI metadata matches title, author order, and 2024 year. | Retained. |
| Viterbi decoder book chapter | Title and author order match. Crossref's published and print dates are 13 November 2024; local data says 2025. | Owner should confirm the intended citation year before changing it. |
| Accepted and submitted papers without DOIs | Acceptance and submission states cannot be established from the supplied identifiers alone. | Owner-provided states retained. No DOI, authors, or final details invented. |
| Journal metrics | Wiley currently displays a 10% acceptance rate. The stored Q2 classification was not independently established for a specific ranking year/category. | Existing values retained; confirm ranking context if displaying it. |

Primary sources:

- [IEEE paper DOI registration](https://api.crossref.org/works/10.1109%2FIC-CGU58078.2024.10530804)
- [Book chapter DOI registration](https://api.crossref.org/works/10.1201%2F9781003581215-42)
- [Wiley journal homepage](https://onlinelibrary.wiley.com/journal/15320634)
- [ICPADS 2026 conference website](https://www.cloud-conf.net/icpads2026/index.html)

The conference website supports the stored Tokyo location and November 22–26,
2026 dates; it does not itself establish an individual paper's acceptance.
The detailed read-only results are in `artifacts/public-audit.json`.

## 5. Deployment review

The configured public URL is
`https://pintu300.github.io/pintu-naik-academic-profile/`.

Read-only checks found:

- HTTPS homepage: HTTP 200.
- HTTP homepage: HTTP 301 to HTTPS.
- HTTPS responses include HSTS.
- Public `admin.html` and `login.html`: HTTP 404, as intended for GitHub Pages.
- Public `sitemap.xml` and `robots.txt`: HTTP 404 at the time of review. They
  exist in the new local build and will appear after that build is deployed.

The workflow uses Node 22, installs locked development dependencies with
`npm ci`, and runs syntax checks, regression tests, and the static build before
uploading `dist/`. Admin, login, editor helpers, and test files are excluded.
The browser runner is optional because it requires Firefox and geckodriver.

The patched image tool requires Node 20.9 or newer; Node 22 is recommended in
`.nvmrc`. A temporary Node 22 runtime generated the images during this review;
the system Node installation was not changed. The installed dependency audit
reported zero vulnerabilities after updating the image tool.

## Verification commands

```bash
npm ci
npm run check
npm test
npm run build
npm run test:browser
npm run audit:public
```

Use Node 22 for development and `npm run images` when regenerating variants.
The initial results were 39 passing automated tests, 39 passing browser checks,
and a successful static build. Publication-year confirmation and checks in
other browser engines remain separate from these verified results.

## Advanced catalogue and editor update

The follow-up feature pass adds publication search with combined type/year/
status filters, shareable query URLs, citation dialogs, clipboard fallback,
and single-record or filtered-result BibTeX downloads. Submitted and accepted
records retain status notes rather than being presented as published papers.
Optional abstracts and richer citation metadata can be entered in the admin
editor. The original publication records were not changed.

Project discovery now supports keyword and technology filtering once projects
are added. The real project list remains empty as requested.

The editor now has section links, record search, expand/collapse controls,
and a saved-content backup download. Browser checks verify that hidden
records are not removed on save, active records stay visible while editing,
and backups contain saved data rather than unsaved drafts. The overlapping
Save bar was removed, and both top and bottom Save controls are available.

Verification for this pass: 44 automated tests and 42 Firefox browser checks
pass. The extended browser checks downloaded and inspected actual `.bib` and
JSON files, exercised clipboard denial fallback, restored URL filters, and
confirmed that real academic data stayed unchanged. The static build succeeds
and includes the public catalogue scripts while excluding editor helpers.
The prior limits for other browser engines and physical devices still apply.

## Latest verification — 10 November 2026

The latest runs passed 47 automated tests, 42 Firefox browser checks, 39
Chromium checks, and 39 WebKit checks. Syntax validation, the static build,
and whitespace checks passed. Browser checks reported no unhandled JavaScript
exceptions, and original JSON data stayed unchanged.

Chromium exposed horizontal overflow on the tablet CV page. The CV header
background now uses a narrower inset below 1028px; Chromium and WebKit passed
all eight public pages at 1440, 768, 390, and 320 CSS pixels after this fix.
The Firefox run preceded this final CSS adjustment.

Chromium and WebKit also verified publication filters, share URLs, citation
copy and downloads, mobile navigation, gallery focus, admin login/logout,
editor saves and backups, and the live visitor start date of 2026-11-10.
Chromium generated an A4 CV PDF whose extracted text includes the expected
sections. WebKit print styles were checked and visually inspected.

The combined evidence is in `artifacts/cross-browser/report.json`; downloads,
screenshots, and the Chromium PDF are stored beside it. Test tooling and
additional browser libraries were installed only under `/tmp`; no system
packages or project dependencies were added for this verification. WebKit's
initial navigation failure was traced to incompatible VS Code Snap GIO
modules; using native system modules resolved it even on a minimal HTTP page.

WebKit on Linux does not establish compatibility with actual Safari on macOS
or iOS. Mobile checks use emulated viewports, not physical devices.

The public HTTPS homepage and HTTP redirect still work. Public admin and
login pages return 404 as intended. Public sitemap and robots files still
return 404 because the latest local build has not been published. The Viterbi
chapter's local 2025 year still differs from Crossref's 13 November 2024 date;
the record remains unchanged pending owner confirmation. This verification
did not deploy the frontend or change academic content.

## Remaining-check follow-up — 10 November 2026

All available follow-up checks passed:

- Full automated suite: **55 tests**, including eight new visitor Worker
  regression tests in `scripts/visitor-worker.test.js`. They verify RSA-signed
  OAuth assertions using a generated test key, the reporting start date,
  escaped PEM handling, routing and CORS, invalid configuration, upstream
  failures, empty reports, invalid totals, and country-row filtering. These
  tests use simulated Google responses and no production credentials.
- Firefox: **42 checks**, rerun after the final CV CSS fix. Original data
  fingerprints still match, and no unhandled JavaScript errors were reported.
- Generated static build: **56 Chromium/WebKit checks** without the backend,
  served under `/pintu-naik-academic-profile/`. All eight pages passed at
  1440x1000, landscape 844x390, and 720x1000 CSS pixels. Metadata, sitemap,
  robots, excluded admin files, publication search, keyboard skip links,
  reduced motion, data-fetch failure/reload recovery, and the visible
  JavaScript-disabled notice passed. The initial notice failure was a test
  selector issue: directly selecting `noscript p` confirmed its visibility.
  No product change was required. CV screenshots were visually inspected.
- Live visitor service: **four checks** passed. GET returns 200 with the
  2026-11-10 period, a valid count, `Cache-Control: no-store`, and CORS headers;
  OPTIONS returns 204, POST returns 405, and an unknown path returns 404.
  Node's first TLS attempt was reset; a curl retry completed successfully.
- JavaScript syntax, static build, and whitespace checks passed. The npm
  dependency audit reported **zero known vulnerabilities**.

Additional evidence is in `artifacts/static-browser-report.json` and
`artifacts/live-visitor-report.json`. The static browser runner used temporary
Playwright tooling; the Worker tests are included in the normal `npm test`
command. No academic data or production deployment was changed.

The remaining unavailable checks require actual Safari on macOS/iOS and
physical phones. The public deployment still returns 404 for sitemap and
robots files pending publication of the tested build. The chapter citation
year and owner-provided acceptance/submission claims still require content
confirmation; automated tests cannot establish them.

## Visitor-panel reliability improvement — 10 November 2026

Visitor requests now abort after ten seconds. Failed or stalled requests offer
a Try again button that retries within the panel. Pending retries disable the
button and cannot overlap; requests still bypass caches and validate the
configured reporting date. The panel exposes its busy state to assistive
technology and restores keyboard focus after retries unless the visitor has
moved to another control. Initial feedback now says Loading visitor statistics
instead of incorrectly suggesting that service setup is required.

The full automated suite passed **58 tests**. Eight focused Chromium/WebKit
checks passed at desktop and mobile widths, including real ten-second timeout
behavior, recovery from a 503 response, country rendering, and keyboard focus.
Evidence: `artifacts/visitor-retry-browser-report.json`. Syntax validation,
the static build, and whitespace checks passed. The change is local and has
not been published.

## Backup restoration and save conflicts — 11 November 2026

The local editor can validate JSON backups, display a summary, cancel without
changing its fields, or load a backup as an unsaved draft. Only an explicit
Save writes the website files. A separate current-draft download preserves
unsaved work; saved-backup downloads continue to exclude it. Imported extra
profile/record metadata is retained. Navigation and collection controls are
rebuilt without duplicates when a backup is loaded.

Admin GET responses return an `ETag` representing the content version while
remaining `no-store`. Saves require that exact version in `If-Match` (428 if
missing, 412 if stale). The version check and write share a serialized queue;
admin reads use the same queue so they cannot observe a partially installed
save. Successful saves return the next revision. This protects editor tabs
from overwriting newer content and detects intervening direct JSON edits.
Use one backend process per data directory; external file-writing processes
do not participate in this in-process queue.

The full suite passed **61 automated tests**. **12 Chromium/WebKit checks**
passed at 1440px and 390px, covering invalid backup rejection, review/cancel,
staging without writes, saved versus draft downloads, preservation of imported
metadata, explicit saves, repeated saves, and real two-tab conflicts. The
original JSON fingerprints stayed unchanged. Evidence is in
`artifacts/admin-recovery-browser-report.json`.

The extended Firefox runner completed 43 checks, with two upload checks blocked
by Snap's separate `/tmp` view. Upload fixtures were moved into the ignored
artifact directory; the requested rerun was not approved, so those corrected
Firefox checks remain unverified. Syntax validation, the static build, and
whitespace checks passed.

The prior public-deployment gap has been resolved by an existing successful
GitHub Actions run for commit `728de30a2d471709fb8cbe433cea9c4a755d8bce`:
https://github.com/Pintu300/pintu-naik-academic-profile/actions/runs/42830250159
All **99 public files** in the current build matched the deployed files by
SHA-256, including the sitemap and robots files (now HTTP 200). Evidence is
in `artifacts/deployment-comparison.json`. No new frontend deployment is needed
for these admin-only changes. Publishing the new backend/editor source changes
is still pending: the GitHub push dry run found no HTTPS authentication.
A GitHub integration was suggested, but no installation/connection was
confirmed during this work.

No Android device was connected according to `adb devices`. Actual Safari,
macOS/iOS devices, and configured BrowserStack/Sauce credentials were
unavailable. Physical-device acceptance steps are recorded in README; viewport
checks and Linux WebKit are not reported as physical-phone or Safari tests.

## Final backend/frontend review — 11 November 2026

The review covered request routing, authentication/session handling, CSRF,
validation, transactional saves and conflicts, private-file policy, static
publication, catalogue behavior, backups/restoration, visitor reporting, and
responsive/keyboard behavior. Academic content and real project data were
not changed.

Two concrete issues were fixed:

- An expired admin session previously redirected a loaded editor to login.
  It now keeps the draft and offers download, sign-in in another tab, and
  reconnection without reloading the editor. Reconnection updates the session
  token but retains the draft's original content revision, so it cannot bypass
  save conflicts. Expired backup validation also preserves the form and resets
  file selection so the same file can be selected again after signing in.
- Public API/JSON reads could race with the file-replacement stage of a save.
  They now use the same in-process queue as admin reads/writes. A controlled
  test pauses a transaction after moving a file and verifies that both public
  routes return the completed update rather than a temporary missing-file error.

A duplicate favicon MIME entry was also removed.

Verification:

- **68 automated tests** passed, including the controlled read/write race.
- **47 Firefox browser checks** passed, including the previously unverified
  file uploads, restoration, session-expiry recovery, and stale-save protection.
- **78 Chromium/WebKit general browser checks** passed.
- **56 Chromium/WebKit static-build checks** passed.
- **12 Chromium/WebKit session-recovery checks** passed at desktop/mobile
  widths using actual session expiry and sign-in in a separate tab. They cover
  draft downloads, recovery saves, changed-content conflicts, and expired
  backup validation.
- Syntax checks, the static build, and whitespace checks passed. The npm
  advisory audit reported **zero known vulnerabilities**. The redacted scan
  found no credential-pattern matches in working files, staged content, or
  locally available history.

The general Chromium/WebKit and static checks preceded the final public-read
queue change; the full regression suite and Firefox checks were rerun after
that change. This queue adjustment does not change static output. The Firefox
run also covers the final admin recovery code.

Evidence is in `artifacts/browser/report.json`,
`artifacts/cross-browser/report.json`, `artifacts/static-browser-report.json`,
and `artifacts/session-recovery-browser-report.json`. Browser runners confirmed
that original data fingerprints were unchanged and reported no unhandled
JavaScript exceptions. The local Node server already running on port 3000
was not stopped or reconfigured by this review; testing used isolated servers.

Actual Safari on macOS/iOS and physical-phone behavior remain outside this
Linux verification. Credential pattern checks and dependency advisories are
bounded checks, not a guarantee against every vulnerability. No deployment or
Git history rewrite was performed. Restart the local backend to use the new
recovery/read behavior, and push the reviewed changes when ready.

## Automatic backups and browser CI — 11 November 2026

The backend now creates private content snapshots before admin saves and,
when started normally, at startup and every 24 hours while running. The default
ignored `backend/backups/` destination is outside public output. The newest 30
managed snapshots are retained; unrelated/manual files are preserved. Files
use 0600 permissions and newly created directories use 0700. A pre-save backup
failure returns a safe HTTP 503 message and cancels the update. `npm run backup`
provides a manual option while the backend is stopped.

The deployment workflow now installs Firefox/geckodriver through pinned setup
actions and runs the browser suite before building/publishing. Diagnostics are
retained separately for seven days. The browser executable can be specified
with `FIREFOX_BINARY`; Ubuntu's Snap launcher was rejected as expected, and the
actual Firefox executable completed the tests.

Verification passed: **72 automated tests**, **47 Firefox checks**, syntax and
static build checks, workflow YAML/ordering validation, a startup/manual-backup
smoke test, and a redacted source/index/history credential scan. Test content
remained isolated and the real JSON data fingerprints were unchanged. The first
hosted run of the updated workflow is pending a push; no deployment was made.

No Android phone or external browser-testing credentials were connected. The
GitHub integration remains uninstalled; account 2FA/push-protection settings
could not be verified or changed. Owner actions and official instructions are
recorded in `docs/OPERATIONS.md`. The configured snapshots are local content
backups, not an offsite service or a copy of image/PDF assets.
