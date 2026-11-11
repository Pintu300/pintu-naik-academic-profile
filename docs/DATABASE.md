# PostgreSQL website storage

The Node backend reads website content from PostgreSQL and stores admin edits
there. Existing `backend/data/*.json` content is imported once without changing
the original files. Visitor registration/login, comments, and contact forms are
not active, and no default application accounts were created. The existing
local admin login now uses a persistent account in PostgreSQL; email OTP recovery
is available after [private configuration](ADMIN-RECOVERY.md). GitHub Pages remains a
static deployment using exported JSON.

## Project-local setup

With PostgreSQL server/client tools installed, run:

```bash
npm run db:setup
npm run db:import
npm run db:status
npm run db:check
```

Setup creates a persistent cluster under `backend/private/postgresql-data` and
binds it only to `127.0.0.1`, normally on port 15432. It does not change the
system PostgreSQL service. `LOCAL_POSTGRES_PORT` can select a port on first
setup; `PG_BIN` can select the PostgreSQL binary directory. Repeating setup
preserves data and credentials. The local setup uses PostgreSQL 16.

Credentials are randomly generated in owner-only
`backend/private/local-postgresql.json` (0600), inside a private directory (0700).
Do not publish or commit that file. Database commands automatically read it.
The migration role `portfolio_owner` owns the database/schema. The application
role `portfolio_app` has table access but cannot create schemas, alter the
migration ledger, create databases/roles, or act as a superuser. A separate
private bootstrap role is used only for local setup. These credentials are
separate from the website admin password.

```bash
npm run db:start   # start again after a reboot
npm run db:stop    # stop this project's cluster; keep data
npm run db:init    # apply future migrations using the owner role
npm run db:backup
```

There is no operating-system autostart service. Keep the local database running
while developing database features. GitHub Pages does not run this database or
the Node backend; a custom domain alone does not provide backend hosting.

## Connect to another database

Install dependencies with `npm ci`. Node 22 in `.nvmrc` is recommended. The
Node.js 22 or newer is required by the current server and patched dependencies.
You need an existing PostgreSQL database and private connection credentials;
no hosted database was purchased/provisioned by this change.

In Bash, enter the complete connection URL without putting it in shell history:

```bash
read -r -s -p "Private PostgreSQL DATABASE_URL: " DATABASE_URL
printf '\n'
export DATABASE_URL
npm run db:init
npm run db:import
npm run db:check
```

Do not paste the URL into chat, HTML, browser JavaScript, JSON content, or Git.
Environment files are not automatically loaded. `db:init` creates application
tables in the existing database; it does not create a PostgreSQL server or the
database itself. It needs a migration role allowed to create the `portfolio`
schema and its objects. For a separate migration role, provide
`DATABASE_MIGRATION_URL` privately; only `db:init` uses it. Future hosted request
handlers should use a separate role with only the required schema/table access,
not a PostgreSQL superuser or schema owner. Explicit environment settings take
precedence over local credentials. The project-local setup configures these
role grants; another server needs equivalent permissions configured privately.

Remote connections use verified TLS. The supported URL option is `sslmode`:
`require`, `verify-ca`, and `verify-full` all retain certificate/hostname
verification. `disable` is allowed only for loopback development. Unsupported
SSL options are rejected rather than overriding secure settings. A provider CA
can be supplied as a private `DATABASE_CA_FILE` path. Pools have bounded
connection/query timeouts and a maximum of five connections.

## Tables and migrations

| Table | Prepared purpose |
| --- | --- |
| `portfolio.users` | Case-insensitive unique email, display name, encoded password-hash field, creation time. |
| `portfolio.comments` | User ownership, resource slug, bounded body, moderation state defaulting to pending. |
| `portfolio.contact_messages` | Name/email/subject/body, creation time, inbox state defaulting to new. |
| `portfolio.schema_migrations` | Applied versions/checksums. |
| `portfolio.site_content` | Public portfolio content as one JSONB document, updated transactionally. |
| `portfolio.admin_account` | Private admin credentials, recovery address, version for session revocation, and expiring hashed OTP state. |

## Editing and publishing

Run `npm start` with your private admin password configured. Public API and
`/data/*.json` requests now read PostgreSQL. Admin saves lock the content row,
check its revision, create a private snapshot of the previous content, and
commit the update atomically. Stale revisions return HTTP 412. Backup failures
cancel the update. Database failures do not silently fall back to stale JSON.

`db:import` inserts only when the content row is absent; repeating it preserves
existing database edits. Use the admin editor for subsequent updates. The
existing JSON files remain the initial seed and the publishing snapshot.

For GitHub Pages, after editing in the local admin:

```bash
npm run db:export
npm run build
git diff -- backend/data
```

Review and commit/push those public JSON changes using your normal Git workflow.
Export validates the document before replacing the JSON files. GitHub Pages
cannot run PostgreSQL or accept admin saves. A hosted Node backend with private
database connectivity is required for live online editing.

No plaintext password column or seeded login is provided. Future account code
must implement hashing/verification; the column name alone is not authentication.
Future APIs must validate inputs, enforce ownership and moderation, and use
bound parameters. The resource slug does not currently reference a publication
table because publications are stored within the public content JSONB document.

Schema SQL lives in `backend/database-schema.js`. Append migrations instead of
editing SQL already applied. A transaction/advisory lock serializes concurrent
setup; checksums reject altered migrations, and unrecognized existing tables
are not adopted. Foreign keys, identity keys, unique indexes, status checks,
and content bounds are provided. Public schema access is revoked; explicit
role grants are configured by local setup and must be configured separately
for other servers.

## Backups

```bash
npm run db:backup
```

This needs `pg_dump` installed; use a client compatible with the server version.
It writes a private custom-format `.pgdump` snapshot of the `portfolio` schema
under `BACKUP_DIR`, or `backend/backups/` by default. It opens the destination
exclusively with mode 0600 and refuses existing/public destinations. Passwords
are passed to the child process through its environment, not command arguments
or logs. Failed dumps are removed. Backups do not contain other database schemas,
server roles, or grants. Private restoration uses `pg_restore` with credentials
configured locally; restoration was tested against a new isolated test database.

Full database backups are manual. The JSON editor restore
cannot import `.pgdump` files; use PostgreSQL restore tools. Automatic JSON
snapshots protect the website content document loaded from PostgreSQL, but do
not back up visitor/contact tables or schema. `npm run backup` also snapshots
the current PostgreSQL content. Define a production full backup/restore
schedule before storing visitor records. A separate
independent copy is still needed for protection against loss of the local drive.

Git ignores database dumps, local private storage, and the abandoned empty
SQLite prototype/sidecars. Those prototype files were left private and unused;
no private data was deleted or migrated. Dumps and credentials are excluded
from public builds, and scanners detect PostgreSQL credential URLs/literals.

## Tests and CI

```bash
npm run test:db
npm run test:all
```

With local PostgreSQL server/client binaries installed, the runner starts an
isolated temporary cluster on an unused loopback port, generates test-only
credentials, creates/drops uniquely named test databases, then stops/removes
the cluster. It does not alter the system PostgreSQL service or existing data.
`PG_BIN` can select the binary directory. `PG_DUMP` and `PG_RESTORE` can select
compatible tools. Alternatively set a loopback `TEST_DATABASE_URL` for a test
server whose role may create temporary databases. Ordinary `npm test` skips
database integration tests unless that variable is set; `test:all` runs them.

GitHub Actions uses an isolated PostgreSQL 16 service, runs all regression and
database tests, then checks CLI migrations before deployment. That ephemeral
CI service uses loopback-only trust authentication and synthetic data; it is
not a production configuration. No credentials/dumps go into Pages artifacts.
The first hosted run remains pending a push.

## Verification on 11 November 2026

**99 tests passed with none skipped** using the isolated PostgreSQL 16.15
cluster: concurrent/idempotent migrations, constraints and moderation defaults,
bound values, migration tampering, refusal to adopt unrelated tables, CLI
checks, private backup/restore, and the existing website/security regressions.
Syntax and static build checks passed. The persistent local cluster was also
checked for restricted application permissions, repeatable setup, successful
backup, and a stop/start cycle. Tests also cover PostgreSQL-backed public APIs,
authenticated admin saves, cross-connection stale edit rejection, import
preservation, rollback on backup failure, OTP recovery and replay/guessing
protection, persistent admin credentials, session revocation, and the five-minute
idle timeout with activity renewal and hidden-page expiry. No visitor
account UI was added. Recovery email delivery uses a fake sender in tests;
real Gmail delivery requires private configuration and an inbox test.

References: [node-postgres connections](https://node-postgres.com/features/connecting),
[TLS configuration](https://node-postgres.com/features/ssl),
[transaction handling](https://node-postgres.com/features/transactions), and
[PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html).
