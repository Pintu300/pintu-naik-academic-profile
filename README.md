# pintu-naik-academic-profile
Academic profile website for Pintu Naik, PhD scholar in Computer Science and Engineering at IIT Jammu.

A professional personal website organized with separate frontend and backend code.

## Project Structure

```text
frontend/
  index.html              Profile homepage
  research.html           Research interests
  publications.html       Publications list
  projects.html           Research and software projects
  teaching.html           Teaching and mentoring
  achievements.html       Awards, certificates, and photo gallery
  education.html          Education history
  cv.html                 Academic CV
  admin.html              Local, password-protected content editor
  styles.css              Frontend design and responsive layout
  script.js               Browser behavior and JSON content loading
  admin.js                Admin editor behavior
  login.html              Admin sign-in page
  login.js                Admin sign-in behavior
  assets/
    research-graph-computing.jpg
    research-nanopore-lab.jpg
    research-distributed-systems.jpg
    profile-publications.jpg
    profile-projects.jpg
    profile-teaching.jpg
    profile-achievements.jpg
    profile-education.jpg
    profile-cv.jpg

backend/
  server.js               Node.js HTTP server and API routes
  auth.js                 Admin login, sessions, throttling, and logout
  data/
    profile.json          Name, title, contact links, summary, about text
    research.json         Research interests
    updates.json          Homepage news and recent updates
    publications.json     Publication list
    projects.json         Project cards
    achievements.json     Achievement cards with image paths
    education.json        Education history
    skills.json           Technical strengths
    teaching.json         Teaching and mentoring history

package.json              Project scripts
site.config.json          Public URL for canonical links and sitemap
scripts/                  Syntax checks, static build, metadata generation
README.md                 Project documentation
```

## Development setup

Node.js 22 is recommended for development and is configured in `.nvmrc` and
GitHub Actions. Install the locked development tools with `npm ci`. The basic
local server still supports Node 18, but regenerating images requires Node
20.9 or newer because the patched Sharp build tool does not support Node 18.
Generated images are included in the repository, so starting the server does
not require regenerating them or loading Sharp.

## Run

Start the backend server:

```bash
npm start
```

Open the website:

```text
http://localhost:3000
```

For development, this command does the same thing:

```bash
npm run dev
```

Check JavaScript syntax:

```bash
npm run check
```

## Publish on GitHub Pages

GitHub Pages serves static files and does not run the Node.js backend. This
repository includes a GitHub Actions workflow that publishes the frontend and
its JSON content files whenever you push to the `main` or `master` branch.

1. Push this project to a public GitHub repository.
2. In the repository, open **Settings → Pages** and set the build and
   deployment source to **GitHub Actions**.
3. Push to `main` or `master`, or start **Deploy website to GitHub Pages**
   from the **Actions** tab.
4. Open the published URL shown by the workflow.

The public site reads its content from `backend/data/` as static JSON files.
The deployment workflow runs syntax checks and all regression tests, then
builds `dist/` with the public frontend, JSON data, sitemap, and metadata. The Node
backend and password-protected admin editor are for local use and are not
deployed to GitHub Pages. To update the public site, edit the relevant JSON
file, then commit and push the change.

## Build and public URL

```bash
npm run check
npm test
npm run build
```

The static output is generated in `dist/`. The GitHub Actions workflow uploads
this directory only after checks and tests pass. Login, admin, editor helpers,
and test scripts are excluded from the public output.

`site.config.json` sets `publicUrl`. Its default assumes the repository's
GitHub Pages address: `https://pintu300.github.io/pintu-naik-academic-profile/`.
Change this value if you use another URL or a custom domain. Include the full
repository path for a project site. You can also override it for a build:

```bash
SITE_URL="https://example.com/" npm run build
```

The build generates canonical URLs, Open Graph and Twitter sharing tags,
`robots.txt`, and `sitemap.xml`. Metadata uses the current profile name,
summary, and photo. Keep the final public URL configured before publishing.
These files do not imply the website has been deployed.

## Restore content and recover drafts

In the local admin editor, **Download saved backup** exports the content last
loaded or saved in that editor. **Download current draft** includes its unsaved
edits. Both files contain public website content, not passwords or session
tokens. Keep backups outside the public assets directory.

To restore a file, choose it under **Restore a backup**. The server validates
the JSON structure, required fields, URLs, and size before showing a summary.
**Cancel restoration** leaves the editor unchanged. **Load backup into editor**
replaces the current unsaved draft; review the imported content before pressing
**Save details**. Selecting or loading a backup does not write website files.
Restoring JSON does not restore image/PDF files: retain those assets separately.

Every editor load receives a content version. Saves must send that exact
version in `If-Match`; a successful save returns the new version in `ETag`.
An older tab receives HTTP 412 instead of overwriting newer content. A missing
version receives HTTP 428. If a conflict occurs, download your current draft,
reload the saved content, and reapply the edits you want to keep. These checks
also detect direct JSON edits made since the editor was opened.

The Node backend serializes admin reads and writes within one server process.
Run one server process for a data directory; this is not a distributed database
lock for multiple servers or concurrent external file-writing programs.

## Physical-device acceptance checks

Linux WebKit checks do not establish compatibility with Safari on macOS/iOS.
Before a release, check the deployed URL in actual Safari and on an Android
phone: all navigation links, portrait/landscape layouts, publication filters,
citations and downloads, the CV print preview, and visitor-error recovery.
Verify keyboard navigation at increased text size where available. The local
admin editor additionally needs restore/cancel/save and two-tab conflict checks
when testing on an accessible local server. Do not expose the admin server
publicly just to run a device test.

## Admin Editor

The browser editor is available when you run the Node backend locally. It is
not included in the GitHub Pages deployment.

Start the server with an admin password:

```bash
ADMIN_PASSWORD="change-this-password" npm start
```

Then open:

```text
http://localhost:3000/login.html
```

Opening `/admin.html` redirects here when you are signed out.

Login credentials:

```text
Username: admin
Password: the ADMIN_PASSWORD value you used
```

You can also choose a custom username:

```bash
ADMIN_USER="yourname" ADMIN_PASSWORD="change-this-password" npm start
```

The editor uses labeled forms for research, news, publications, projects,
achievements, education, skills, and teaching. Expand an entry to edit it;
use **Add entry**, **Move up**, **Move down**, or **Remove** to manage the list.
**Undo removal** restores the most recently removed entry in that section
before saving. Changes apply only when you click **Save Details**. The editor
warns before navigating away with unsaved changes.

To add a project later, open the **Projects** section, click **Add project**,
and fill in its title, description, your contribution, results, technologies,
and any details, code, or demo URLs. Leave optional fields empty when you do
not have them. Save, then open the Projects page to review it. No projects
have been invented or added as placeholders. To publish local edits to GitHub
Pages, commit the changed JSON data and push it to the repository.

About text uses normal paragraphs separated by blank lines. Photo fields use
local `assets/` paths; place files in `frontend/assets/` first. Existing custom
record fields are preserved even if the editor does not display them.

The login form authenticates against `ADMIN_USER` and `ADMIN_PASSWORD` on the
Node server. Credentials are checked using scrypt and constant-time comparisons.
There is no registration or default password. The editor and its API require
an opaque server-side session; HTTP Basic authentication is no longer accepted.
The portfolio remains public.

Session cookies use `HttpOnly` and `SameSite=Strict`, with `Secure` enabled when
`ADMIN_ORIGIN` uses HTTPS or the connection is encrypted. Sessions expire after
30 minutes of inactivity or eight hours total. **Sign out** revokes the current
session on the server. Signing in again rotates the current session and its
CSRF token. Restarting the server signs out every session; changing the admin
credentials requires a restart. Sessions and rate limits are held in memory,
so this setup is intended for a single Node process.

The local server validates admin updates and limits save request bodies to
1 MB; login bodies have a separate 4 KB limit. Use localhost or HTTPS. Server
errors are logged to the terminal, while API responses return concise messages.
The static GitHub Pages deployment excludes both the admin and login files.

## Security

The local server binds to `127.0.0.1` by default. Open it at
`http://localhost:3000`. The admin editor stays disabled until you set
`ADMIN_PASSWORD`; use a unique password of at least 16 characters and keep it
out of Git. Set `HOST` explicitly only when you intend to expose the server.

Security protections include:

- Authentication on normalized admin paths, including percent-encoded paths.
- A 15-minute block after 10 failed password guesses from one socket IP.
  Forwarded IP headers are not trusted; clients behind a proxy share its limit.
  Limits are held in memory and reset when the server restarts.
- A session-specific CSRF token required for admin saves and logout, plus
  Origin and Fetch Metadata checks. Login and logout require the custom
  `X-Requested-With: admin-editor` request header. API clients first POST JSON
  `{ "username": "...", "password": "..." }` to `/api/auth/login`, retain its
  session cookie, then GET `/api/admin/site-data` with that cookie. Read the
  `X-CSRF-Token` response header and supply it with the cookie on PUT requests.
  POST `/api/auth/logout` with the cookie, CSRF token, and custom header to
  invalidate the session. Credentials and session tokens must stay private.
- Validation of text, email, HTTP(S) links, and local asset paths before saving.
  Photos and logos must use `assets/` paths. Saves are serialized to avoid
  concurrent updates interfering with rollback.
- Rejection of hidden files, symlink aliases, unsupported file types, malformed
  paths, and files outside the frontend directory.
- Content Security Policy, disabled camera/microphone/location permissions,
  frame blocking, and other response headers on the Node server.

All HTML pages also include a Content Security Policy for the static GitHub
Pages deployment. It blocks inline JavaScript and unapproved script sources
while allowing the existing Google Analytics and visitor-statistics service.
Inline styles remain allowed for generated research illustrations. If you add
an external service, review and update the policies in the HTML and server.
GitHub Pages does not run the Node backend: admin authentication, throttling,
CSRF protection, and Node response headers apply only to the Node server.
Frame blocking requires HTTP response headers and cannot be supplied by an
HTML meta tag.

For a public Node deployment, terminate HTTPS at your reverse proxy and set
`ADMIN_ORIGIN` to its exact public origin, for example `https://example.com`
(with no trailing slash). Keep the Node port private. The application does not
trust `X-Forwarded-Proto` or `X-Forwarded-For`. Configure HTTPS redirects and
HSTS at the HTTPS host; the local HTTP server does not install certificates.
The GitHub Pages workflow continues to exclude the admin editor.

Run `npm run check` and `npm test` before publishing. Regression tests cover
encoded admin paths, CSRF, password throttling, unsafe content, file access,
security policies, concurrent saves, rollback, login, session expiry, and logout. These protections do not
replace HTTPS, strong credentials, or keeping the deployment environment updated.

## Customize

For local development, use the protected admin editor or edit the relevant
data file directly. To change the published site, edit the data file and push
the change to GitHub:

```bash
backend/data/profile.json
backend/data/research.json
backend/data/publications.json
backend/data/projects.json
backend/data/achievements.json
backend/data/education.json
```

In VS Code, open the file from the left sidebar and change the text directly.

### Homepage visitor statistics by country

The homepage visitor panel uses Google Analytics 4 for real unique-user totals
and country breakdowns. Since GitHub Pages is static, a Cloudflare Worker reads
GA4 securely; Google credentials are stored as Worker secrets and are never
sent to visitors' browsers. The deployed endpoint is
`https://pintu-naik-visitor-stats.pintunaik300.workers.dev/api/visitor-stats`.
The panel displays zero until GA4 has collected reportable data.

1. In Google Cloud Console, enable the **Google Analytics Data API** and create
   a service account. Keep its downloaded JSON key private.
2. In Google Analytics, open **Admin → Property access management** and add the
   service account email as a **Viewer**. Copy the numeric GA4 Property ID from
   **Admin → Property details**.
3. Install Wrangler if needed (`npm install --global wrangler`), then log in:

   ```bash
   npx wrangler login
   ```

4. Add the service-account private key as a Cloudflare Worker secret. The
   service-account email and numeric GA4 Property ID are configured in
   `wrangler.toml`:

   ```bash
   npx wrangler secret put GA_PRIVATE_KEY --config cloudflare/visitor-stats/wrangler.toml
   ```

   Copy the values from the private service-account JSON file when Wrangler
   prompts. Never commit that JSON file or put its private key in frontend code.
5. Deploy the Worker:

   ```bash
   npx wrangler deploy --config cloudflare/visitor-stats/wrangler.toml
   ```

   The command prints the Worker URL. Set the `data-endpoint` attribute on the
   `[data-visitor-stats]` element in `frontend/index.html` to that URL followed
   by `/api/visitor-stats`.
6. Push the updated site to GitHub Pages. Once GA4 has collected data, the
   homepage will show total unique visitors and visitor counts with country
   flags. GA4 reports may take 24–48 hours to populate.

The visitor totals start on `2026-11-10` by default; change `GA_REPORT_START_DATE` in
`cloudflare/visitor-stats/wrangler.toml` to the date you want the total to begin.
The public panel is read-only. Requests include the configured reporting date
and bypass browser caches so a changed period cannot reuse historical totals.
Worker responses use `Cache-Control: no-store`. Set the matching
`data-start-date` in `frontend/index.html` when changing the report start date. Add an appropriate privacy
notice to your site and follow applicable consent and privacy requirements.

Review the profile, publication, project, education, and contact details in
the JSON files before making the repository public.

The homepage Research themes photos are downloaded from Unsplash and stored
locally for reliable static hosting. Photo sources: [computer hardware](https://images.unsplash.com/photo-1518770660439-4636190af475),
[sequencing laboratory](https://images.unsplash.com/photo-1579154204601-01588f351e67),
and [server room](https://images.unsplash.com/photo-1558494949-ef010cbdcc31).
They are used under the [Unsplash License](https://unsplash.com/license).
The homepage Explore my profile cards also use local Unsplash photos: [publications](https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8),
[projects](https://images.unsplash.com/photo-1519389950473-47ba0277781c),
[teaching](https://images.unsplash.com/photo-1509062522246-3755977927d7),
[academic milestones](https://images.unsplash.com/photo-1523580494863-6f3031224c94),
[education](https://images.unsplash.com/photo-1524995997946-a1c2e315a42f),
and [CV writing](https://images.unsplash.com/photo-1455390582262-044cdead277a).

Education entries can include an `institution` and an `institutionLogo` path in
`backend/data/education.json`. Keep logo files in `frontend/assets/institutes/`;
the Education and CV pages use these local assets.

Publication entries in `backend/data/publications.json` support `title`,
`authors`, `venue`, `year`, `type` (`conference`, `journal`, or `bookChapter`),
`url`, `doi`, and `pdf`. The Publications page groups entries by type and has a
year-order toggle. Use `status` for an accepted paper whose publication details
are not final; do not guess a title or author list.

### Achievements and photos

Add achievement entries in the protected admin editor or
`backend/data/achievements.json`. Put image files in `frontend/assets/` and use
paths such as `assets/award-photo.jpg`. Set `category` to group photos under
headings such as `Achievements`, `Fun & Memories`, or `Travel & Outdoors`. Each
entry can also include `title`, `date`, `issuer`, `description`, `details`,
`image`, `alt`, and an optional `url`.
View the gallery at `/achievements.html`.

## Backend API

```bash
http://localhost:3000/api/health
http://localhost:3000/api/profile
http://localhost:3000/api/research
http://localhost:3000/api/updates
http://localhost:3000/api/publications
http://localhost:3000/api/projects
http://localhost:3000/api/achievements
http://localhost:3000/api/education
http://localhost:3000/api/skills
http://localhost:3000/api/teaching
```

Protected admin API:

```bash
http://localhost:3000/api/admin/site-data
```

Run the backend, frontend behavior, editor data, and static-build tests with:

```bash
npm test
```

## Standard Workflow

Edit academic content in the matching file inside `backend/data/`.

For achievement photos, put image files in `frontend/assets/` and use paths like
`assets/award-photo.jpg` inside the `achievements` list.

For your header profile photo, put an image in `frontend/assets/` and set
`photo` in `backend/data/profile.json`, for example `assets/profile-photo.jpg`.

The CV identity, contact links, photo, summary, and research interests use
the same data as the other pages. Education, publications, teaching, and skills
also come from shared JSON. Keep academic content in `backend/data/`; use
`frontend/index.html` and `frontend/cv.html` for layout changes.

Pages load only their relevant JSON resources. Requests time out after ten
seconds, and one failed section does not prevent the others from rendering.
A visible reload action appears when content cannot load. CV printing stays
disabled until its content has loaded successfully.

The homepage highlights three recent accepted or published papers and excludes
submitted work from that selection. The full Publications page retains all
entries and their original statuses.

Edit design in `frontend/styles.css`.

Edit browser behavior in `frontend/script.js`.

## Browser QA and performance

Run `npm run test:browser` with Firefox and geckodriver installed on PATH.
The runner uses copied temporary JSON data and random test credentials, and
checks actual 1440, 768, 390, and 320 pixel viewport widths. It covers public
pages, navigation, gallery keyboard behavior, login/logout, project editing,
reordering, undo, saving/reloading, and CV PDF export. If `pdftotext` is
installed, it also checks that the PDF contains the below-fold sections.
Screenshots, the PDF, timing samples, and a report are saved under
`artifacts/browser/`, which is ignored by Git. These checks emulate viewports
in Firefox; they do not replace testing Safari, Chromium, or physical phones.

`npm run images` generates responsive WebP variants from the selected trusted
local JPEG files, leaving originals untouched. Run this command with Node 22
after replacing those images. The manifest records source hashes and output
sizes. Public pages choose smaller images with `srcset` and `sizes`; a changed
profile photo falls back to its original path when it has no prepared variants.
The Node server compresses eligible text responses and revalidates public
assets with ETags. Admin content remains `no-store`. Localhost visits do not
initialize Google Analytics.

`npm run audit:public` performs read-only checks of the configured public URL
and Crossref records for supplied DOIs. It writes `artifacts/public-audit.json`.
This command needs internet access and does not change publication data or
publish the website. Accepted/submitted papers without public identifiers
remain owner-provided information.

The review results and remaining publication question are documented in
[docs/QA-REVIEW.md](docs/QA-REVIEW.md).

## Publication and project discovery

The Publications page supports live keyword search across titles, authors,
venues, abstracts, keywords, and years. Combine search with type, year, and
status filters, or toggle the year ordering. The result count updates as you
filter. **Reset filters** restores the complete list.

Filter state is encoded in the URL, so a view such as
`publications.html?q=GPU&type=conference&status=Accepted` can be bookmarked or
shared. **Share this view** copies that URL; when clipboard access is denied,
the page exposes a selectable link instead. Canonical metadata still points
to the main Publications URL.

Each paper has a **Cite / BibTeX** dialog with plain citation text and BibTeX,
copy controls, and a single-paper download. **Export results as BibTeX**
downloads exactly the currently filtered records. Submitted and accepted
records use unpublished entries with status notes; no DOI, publisher, issue,
or pages are invented when missing. Review generated citations before using
them in a manuscript. The unresolved book-chapter year remains unchanged.

The publication editor now accepts optional abstracts, keywords, publisher,
pages, volume, and issue number. An abstract is shown behind **Read abstract**
when provided. Author names use the existing comma-separated format.

Projects support keyword search and technology filters based on comma,
semicolon, or pipe-separated technologies in the Stack field. Their filter
state is also shareable through the URL. The controls appear automatically
when projects are added; the real Projects list remains empty for now.

## Advanced admin controls

The editor has section navigation, per-section record search, and expand/
collapse controls. Search only changes visibility: hidden records are still
included when saving. Add/reorder/remove clears the section's search so the
changed records remain visible. Required fields are revealed if validation
fails inside a collapsed or filtered record.

**Download saved backup** exports the last successfully saved site content as
JSON. It excludes unsaved edits, credentials, cookies, and CSRF tokens. Keep
this file if you want an additional content backup. Downloading does not alter
the website; the current editor does not automatically import or restore it.
