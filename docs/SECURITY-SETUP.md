# Credentials and private files

The portfolio is public; credentials belong in server-side configuration.
Do not add passwords, API keys, private keys, or confidential backups to HTML,
browser JavaScript, public JSON data, or `frontend/assets/`.

## What is already protected

- Admin login reads `ADMIN_PASSWORD` from the server environment. Without it,
  login is disabled. There is no built-in production password.
- Password verification uses scrypt. Random session IDs and CSRF tokens are
  generated on the server and kept in memory, not in repository files.
- Session cookies are HttpOnly and SameSite=Strict. HTTPS configuration enables
  Secure cookies. Restarting the backend invalidates all existing sessions.
- Google Analytics signing keys belong in Cloudflare Worker secrets. The
  Worker sends only aggregate visitor statistics to the browser. Analytics
  measurement IDs, property IDs, and the service-account email are identifiers,
  not private keys or authentication tokens.
- Git ignores environment files, signing keys, common credential filenames,
  and backup/draft downloads. Already tracked files are not removed by ignore
  rules; the scanner checks tracked files and the Git index separately.
- The server serves designated runtime files and permitted assets. The static
  build publishes images, fonts, PDFs, and the generated image manifest, while
  excluding private filenames, arbitrary asset JSON, scripts, and hidden files.

## Start the local admin without putting the password in shell history

In Bash, enter a unique password of at least 16 characters at the hidden prompt:

```bash
read -r -s -p "Admin password: " ADMIN_PASSWORD
printf '\n'
export ADMIN_PASSWORD
npm start
unset ADMIN_PASSWORD
```

The prompt does not echo the password. Environment variables still belong to
the local process environment; this does not protect against a compromised
account or machine. For hosted backends use the hosting provider's secret
store. Do not paste real values into chat or commit a populated environment
file. This application does not automatically load `.env` files.

The browser editor saves public profile content only. Keep downloaded backups
outside the website directory, or in an ignored `backups/` directory. JSON
content backups do not contain session credentials or signing keys.

## Check before committing

```bash
npm run security:check
npm run security:history
```

The first command checks current nonignored files and the Git index. The second
also scans locally available Git history for credential patterns and private
filenames. Reports contain filenames and categories, never matched values.
The deployment workflow fetches full available history and runs this check
before publishing.

This is pattern-based detection, not proof that every possible secret is absent.
It cannot verify credentials stored in hosting accounts or history that has not
been fetched. CI runs after a push: it can stop deployment, but cannot prevent
a secret from reaching a public repository. Run local checks before committing;
also enable GitHub secret scanning/push protection where available.

If a real credential was committed or shared, revoke/rotate it first. Removing
the current file or making the repository private does not invalidate copies.
Then remove it from tracked content and plan any history cleanup separately;
this change does not rewrite Git history or rotate hosting credentials.

## Review on 11 November 2026

The initial inspection found no credential-pattern matches in 129 tracked
files or 108 locally available historical text objects. Live requests for
`.env`, `.git/config`, `backend/auth.js`, `admin.html`, a service-account asset,
and a backup asset all returned HTTP 404. These probes establish the responses
for those paths at the time of review, not the absence of every possible leak.
