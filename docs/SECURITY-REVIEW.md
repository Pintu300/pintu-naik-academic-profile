# Bug and security fixes — 11 November 2026

The review found and reproduced four gaps. Each regression failed on the
previous implementation and passed after its fix. Real academic content was
not edited, credentials were not displayed, and no deployment/history rewrite
was performed.

| Finding | Reproduction | Fix |
| --- | --- | --- |
| Delayed rejection of oversized uploads | A chunked login body exceeded 4096 bytes but received no response until the client ended the upload. The same issue affected admin uploads. | Reject at the first byte over the limit, discard buffered data, send HTTP 413, and close the connection. |
| Slow uploads consumed password-verification capacity | Four unfinished login bodies occupied all four password-check slots; a separate valid login received HTTP 429. | Reserve a slot only after the complete body passes structural validation, recheck concurrency before hashing, and release it in `finally`. Existing per-IP guess limits and the hashing concurrency bound remain active. |
| Incomplete content/backup validation | A save accepted extra root properties and publications with unsupported/missing types or blank titles. Such papers could disappear from every displayed category; extra root metadata could be retained by the browser despite not being saved to content files. | Reject unknown root fields and require a nonblank publication title and one of the three supported publication types. Apply the same validation to saves and restore previews. Extra fields inside supported profile/record objects continue to be validated and preserved. |
| Gaps in credential-history coverage | Synthetic tokens committed then deleted from a shell file and a binary image escaped the old history extension filter. Untracked binary files also skipped content checks. | Scan every locally reachable historical Git blob, regardless of extension, and scan raw working-file contents without treating NUL bytes as an exemption. Reports still return only locations/categories. |

The request-handling findings concern availability of a reachable Node backend;
they are not an authentication bypass. GitHub Pages does not execute that
backend. The schema finding concerns authenticated edits/restores. No actual
credential exposure was found by the expanded pattern scan.

## Verification

- **78 automated tests passed**, including unfinished chunked uploads, login
  availability with four stalled uploads, save/restore schema rejection,
  deleted historical shell/binary fixtures, and the existing auth/CSRF,
  session-expiry, conflict, snapshot, and rollback tests.
- **47 Firefox checks passed** using isolated copied content, including login,
  editing, saved/draft downloads, backup upload/restore, expired-session
  recovery, and stale-save protection.
- Syntax checks, static build, and whitespace checks passed.
- The expanded scan found no credential-pattern matches in current files,
  the Git index, or locally available historical blobs. The expanded run
  inspected 236 historical blobs, compared with 150 selected historical text
  objects in the preceding check.
- The dependency advisory audit reported **zero known vulnerabilities**.
- Browser checks confirmed that actual website data fingerprints were unchanged
  and reported no unhandled JavaScript exceptions.

These are bounded checks, not a guarantee against all vulnerabilities.
Credential detection remains pattern-based and does not decrypt compressed or
encrypted contents, inspect unfetched history, or audit hosting accounts.
Actual Safari and physical devices were not tested in this pass. Only Firefox
browser regression tests were rerun for these backend/tooling changes.

Restart the local backend to use the request-handling and validation fixes.
Push the changes to activate the expanded scanner in GitHub Actions. An old
backup containing unrecognized root metadata will now be rejected: use the
editor's plain content backup format. Publications must use `conference`,
`journal`, or `bookChapter` as their type.
