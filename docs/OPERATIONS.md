# Backups, browser CI, and account/device checks

## Automatic content backups

After restarting with the updated `npm start`, the Node backend creates a JSON
snapshot at startup and every 24 hours while running. Every successful admin
save first snapshots the previous saved content. The snapshot and save run in
the same queue as public/admin content reads. A failed pre-save backup cancels
the save with HTTP 503 and leaves the existing content unchanged.

The default destination is `backend/backups/`, outside `frontend/` and `dist/`.
Git ignores it. New backup directories use mode 0700 and files use 0600. The
snapshot is installed by an atomic rename after its contents are flushed.
Only content JSON is included: passwords, sessions, environment variables,
private signing keys, images, and PDFs are not part of these snapshots.

The newest 30 automatically generated snapshots are retained. Retention only
removes this system's timestamp/UUID filenames; manually downloaded backups
and unrelated files are left alone. Snapshots are compatible with **Admin →
Restore a backup**. Selecting and loading one does not change public data until
you explicitly save.

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKUP_DIR` | `backend/backups/` beside the content directory | Use another private, writable destination, such as a separately backed-up drive. |
| `BACKUP_RETENTION` | `30` | Number of managed snapshots to keep; integer from 1 to 1000. |

Destinations inside the frontend, content directory, or default public build
are rejected. Resolved symlink destinations inside those locations are rejected
too. One backend process should manage a content directory and its snapshots.

To make a manual snapshot **while the backend is stopped**, run:

```bash
npm run backup
```

The command opens no web server. Stopping the backend first avoids a separate
process reading content during an admin save. The scheduled timer does not run
while the computer/backend is stopped; startup creates a fresh snapshot next
time. Local snapshots do not protect against loss of the whole drive. Keep an
independent copy of the backup directory and image/PDF assets on storage you
control. No external backup service or upload destination was configured.

## Browser checks before GitHub Pages deployment

The existing deployment workflow now installs Firefox and geckodriver using
setup actions pinned to exact commits, then runs `npm run test:browser` before
building/uploading the public site. Failure stops deployment. Browser
screenshots, the report, and CV PDF diagnostics are kept as a separate Actions
artifact for seven days, including when the browser step fails. They are not
copied into the public Pages output.

The runner uses temporary copied content and random test credentials. It
verifies layouts, navigation, filters, citations, print output, login/logout,
backup restoration, stale-save protection, and expired-session recovery. It
checks that real content fingerprints did not change. CI sets `FIREFOX_BINARY`
to the installed executable; local users can leave it unset for auto-discovery.
An Ubuntu Snap launcher is not itself the executable for this override.

The workflow has been checked locally, including an actual explicit Firefox
binary run. Its first hosted CI run can only be verified after these changes
are pushed to GitHub. The workflow continues to run on main/master pushes and
manual dispatch; it is not a pull-request approval gate.

Setup action references:

- https://github.com/browser-actions/setup-firefox
- https://github.com/browser-actions/setup-geckodriver

## GitHub account security still needs owner access

No authenticated GitHub account integration was available during implementation.
These account/repository settings were not inspected or changed:

1. Account **Settings → Password and authentication**: check/configure two-factor
   authentication. Keep recovery codes privately; do not put them in this repo.
2. Repository **Settings → Advanced Security**: check Secret Protection/secret
   scanning and enable push protection if available for this repository.

Official guidance:

- [Configure two-factor authentication](https://docs.github.com/en/authentication/securing-your-account-with-two-factor-authentication-2fa/configuring-two-factor-authentication)
- [Enable repository push protection](https://docs.github.com/en/code-security/how-tos/secure-your-secrets/prevent-future-leaks/enable-push-protection)

The project's credential scanner does not replace GitHub push protection. CI
runs after a push and cannot retract a secret already pushed to a public repo.

## Physical phone and Safari verification

`adb devices` found no connected Android device. No BrowserStack/Sauce account
credentials or actual Safari environment were available. No physical-phone or
actual Safari result is claimed; Linux Firefox/WebKit viewport tests do not
establish those results.

On the live site, check navigation and portrait/landscape layouts, publication
search/filters, citation dialogs/downloads, reviewer-card layout, CV print/save,
and visitor-statistics recovery. If a device is later connected or testing
service access is provided, these checks can be completed and recorded.

## Verification on 11 November 2026

72 automated tests and 47 Firefox checks passed. Tests cover snapshot
permissions, retention, restoration-compatible contents, public-path/symlink
rejection, automatic pre-save copies, and safe failure when backups are not
writable. The workflow YAML parses and places browser checks before publication.
Real website data stayed unchanged during browser tests.
An isolated CLI smoke test also confirmed startup snapshots, graceful shutdown,
the manual `npm run backup` implementation, 0600 permissions, and unchanged
source content. Syntax/build/whitespace checks passed and the final redacted
source/index/history scan reported no credential-pattern findings.
