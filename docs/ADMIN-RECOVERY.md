# Admin recovery by Gmail OTP

This feature runs on the Node backend, not on GitHub Pages. Use Node.js 22 or
newer (see `.nvmrc`) and the existing PostgreSQL database. The patched email
library requires a modern Node runtime; Node 18 is no longer supported.

## One-time private setup

1. Enable Google 2-Step Verification on the Gmail account you will send from.
2. Create a Google **app password** for this website. Use the app password,
   never your normal Gmail password. Some managed/Advanced Protection accounts
   do not offer app passwords; this Gmail setup cannot be used with those accounts.
3. In the project terminal, apply the database migration and configure recovery:

```bash
npm run db:start
npm run db:setup
ADMIN_RECOVERY_EMAIL='pintunaik300@gmail.com' npm run admin:configure
```

The command asks for your website admin username, a new admin password
(at least 12 characters), confirmation, the Gmail sending address (defaults to
the recovery address), and its app password. Secret input is hidden. It does
not send an email during setup. Keep these secrets out of chat and Git.

This command intentionally replaces the admin credentials and recovery address,
invalidates existing sessions/codes, and writes private mail settings to
`backend/private/admin-recovery.json` (0600 in a 0700 directory). That directory
is ignored by Git and excluded from public builds. The app password and a random
OTP signing secret stay in this private file. The admin password is stored only
as a salted scrypt hash in `portfolio.admin_account`.

Restart the Node server after configuration:

```bash
npm start
```

If you still use Node 18, install/switch to Node 22 before running these steps.
For a temporary run using npm's Node package, you can use
`npx --yes --package=node@22 -- npm run admin:configure` and
`npx --yes --package=node@22 -- npm start` in place of the corresponding commands.

## Recover access

Open `http://localhost:3000/login.html`, select **Forgot username or password?**,
enter the configured recovery email, and select **Send recovery code**. Enter
the 8-digit code from your inbox and a new password twice. On success the page
shows your username. Return to sign-in and use the new password. Existing
admin sessions are invalidated, including sessions in another server process.

Codes expire after 10 minutes, can be used once, and stop working after five
incorrect attempts. Each registered account can receive at most five codes in
15 minutes, with a minimum of 60 seconds between sends. Requesting a new code
replaces the previous one. IP limits also protect the endpoints; password
resets themselves are processed with bounded concurrency. Request responses
do not reveal whether an email is registered. OTPs are stored as HMAC digests,
not plaintext. SMTP delivery requires verified TLS, and codes/credentials are
never printed in logs. A password-change notification is sent after a reset.

If delivery fails, check spam and the server's generic mail-error message.
Recheck the configured app password and Gmail account restrictions. No real
Gmail delivery has been verified until you perform this inbox test yourself.
Do not repeatedly request codes; observe the cooldown and limits.

## Local emergency recovery

To reset only the website username/password without Gmail setup, run:

```bash
npm run admin:password
```

Enter your desired username and a new password twice at the hidden prompts.
Existing recovery email and private mail settings are preserved. Passwords
from the environment are ignored for this command so you can choose a new one.
Use Node 22; if necessary run
`npx --yes --package=node@22 -- npm run admin:password`.

If you lose the website password or access to the configured mailbox, you can
rerun `npm run admin:configure` as the computer/server owner to set new admin
credentials and a recovery address you control. No old password or code is
required for this local server-owner operation. Restart the server afterward.
This command is not exposed over HTTP.

`ADMIN_USER`/`ADMIN_PASSWORD` now seed an absent PostgreSQL admin account on
startup only. They **do not overwrite** an existing account or undo an email
password reset after restart. Use `admin:configure` for later manual changes.

Backups made by `npm run db:backup` now include the private admin password hash,
recovery address, and OTP state. Keep dumps private; never publish them. Keep
a separate secure copy of the private mail settings or reconfigure them after
restoring the database. Public `db:export` exports only `site_content`, never
admin or recovery records. A hosted admin service needs HTTPS and private
database/mail connectivity; a custom domain or GitHub Pages alone is insufficient.

Tests cover expiry, failed attempts, replacement, replay, concurrent resets,
unknown emails, send limits, failed mail delivery, origin checks, password
validation, session revocation, and public build exclusion. Mail is captured by
an injected fake sender in tests; no real messages are sent.

References: [Google app passwords](https://support.google.com/accounts/answer/185833),
[Nodemailer Gmail setup](https://nodemailer.com/usage/using-gmail/),
[OWASP recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).
