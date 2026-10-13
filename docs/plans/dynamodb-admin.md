# Plan: DynamoDB as the songbook's source of truth, plus an admin portal

Status: milestones 1-5 implemented on branch `feat/dynamodb-admin` (cut from `master` at 145326a)
and deployed to beta; see [Implementation notes](#implementation-notes) for where the build
differs from this plan. The cutover ran on 14 October 2026 (Melbourne time); see
[Cutover log](#cutover-log).

## Goal

- Song data lives in DynamoDB and is edited through an authenticated admin portal at `/admin`.
- The public site stays static. Every edit regenerates a `songbook.json` on S3, served through
  CloudFront.
- All of the work happens on this branch and is deployed to a separate **beta** environment on its
  own hostname. Production (master, the LaTeX pipeline, the live domains) is untouched until a
  deliberate cutover.
- The LaTeX/PDF pipeline is retired at cutover.

Not in scope: multiple users or roles, approval workflows, MFA, manual song numbering, real-time
collaborative editing, offline support, and generating a new PDF (see Decisions).

## The data today

Measured by running the existing parser over `melbourne-songs.tex` on this branch:

- 96 songs, numbered 1-96 with no gaps. 130 KB of JSON in total; the largest song is 2.4 KB.
- A song's number is its position in alphabetical order, using `sort_songs.py`'s rule: titles
  lowercased and compared by code point. Curly apostrophes count as `'`, because the .tex uses `'`
  where the parser emits `’`. This rule reproduces all 96 current numbers exactly.
- 345 verses and 69 choruses, and no lettered `section` blocks. Verse labels are always 1..n in
  order, and choruses are never labelled.
- 2,069 lines in 2,072 segments. **There are no chords.** Three segments are italic (all in #61), and
  none are bold.
- Metadata: copyright on 86 songs, author on 72, key on 2, refs on 1, scripture on none.
- The text contains curly quotes and non-breaking spaces (from LaTeX `~`).

So the editor can be a plain textarea with light markup. Chord syntax is supported so the model
stays complete, but no existing song needs it.

## Environments

| | Production | Beta |
|---|---|---|
| Code | `master` | `feat/dynamodb-admin` |
| Stack | `MelbourneSongsSite` (existing) | `MelbourneSongsBeta` (new) |
| Hostnames | the live ones, in `SITE_DOMAIN_NAME` | one beta hostname, in `BETA_DOMAIN_NAME` |
| Certificate | existing (`SITE_CERTIFICATE_ARN`) | new ACM cert in us-east-1 (`BETA_CERTIFICATE_ARN`) |
| Data | `melbourne-songs.tex` until cutover | its own table, a sandbox seeded from the .tex |
| Deployed by | CI on push to master (OIDC role trusts master only) | me, from this machine, after each milestone |

- Prod and beta are built from the **same stack class** with a `stage` prop, so beta runs exactly
  what prod will run after cutover. Each stage has its own bucket, distribution, table, user pool,
  API and Lambdas, and they share nothing.
- **Hostnames and certificate ARNs stay out of git** as they do now: `infra/.env.local` locally, and
  repository secrets if CI ever deploys beta. Docs and tests use example.com.
- **Beta DNS:** request a certificate for the beta hostname, then add its DNS validation CNAME and a
  CNAME for the beta distribution in Cloudflare (DNS only, like the live records). The agent's
  Cloudflare token already has DNS edit on the zone, so I can do both.
- **Guard:** the CDK app only synthesizes the prod stage when it's running in CI on
  `refs/heads/master`, and defaults to beta otherwise. Nothing on this branch can deploy production
  by accident.
- **Beta is marked as beta.** Its distribution adds `X-Robots-Tag: noindex, nofollow`, so search
  engines don't index a duplicate site, and the app shows a small "Beta" badge (build-time
  `VITE_STAGE`).
- **Staying current:** master is merged into the branch periodically (merge commits, never rebase
  plus force-push). To pull new `.tex` edits into beta, `npm run seed -- --stage beta --reset --yes`
  re-imports the .tex and discards beta edits. It refuses to run against prod.

## Architecture (per stage)

```
Admin browser (/admin) --JWT--> CloudFront /api/* --> HTTP API (JWT authorizer) --> admin Lambda --> DynamoDB
                                                                                                       |
                                                                                            stream (KEYS_ONLY)
                                                                                                       v
Public browser --> CloudFront --> S3: index.html, assets/, songbook.json <-- publish Lambda + invalidation
```

- The stateful resources (the table and the user pool) get `RemovalPolicy.RETAIN` plus deletion
  protection in both stages. A stack delete or a bad refactor can't take the data with it, and
  tearing down beta's data is a manual step. The site bucket stays `DESTROY` because everything in
  it can be regenerated.
- **The prod refactor keeps existing logical IDs.** The new stack class extends today's `SiteStack`
  and keeps the construct IDs `SiteBucket`, `Distribution`, `SecurityHeaders` and `SpaRouting`.
  At cutover CloudFormation then updates the live distribution in place instead of replacing it,
  which would drop the domain aliases. An infra test asserts that the prod template still contains
  master's logical IDs for those resources.
- Before the first beta deploy, confirm the CDK bootstrap execution policy allows DynamoDB, Lambda,
  API Gateway and Cognito.

## Data model: one table per stage

String `pk`/`sk`, on-demand billing, point-in-time recovery on, deletion protection on, TTL on the
`expiresAt` attribute, and a `KEYS_ONLY` stream (the publisher rebuilds the whole book, so it only
needs to know that something changed).

| Item | pk | sk | Attributes |
|---|---|---|---|
| Book metadata | `BOOK` | `META` | `title`, `released?`, `updatedAt`, `publishedAt`, `publishedHash`, `seededFrom` |
| Current song | `SONG` | `<id>` | `Song` fields except `number`, plus `version`, `updatedAt`, `updatedBy` |
| Song history | `HIST#<id>` | `v000003` | full snapshot of that version, `action`, `changedAt`, `changedBy` |
| Recently deleted | `DELETED` | `<id>` | last snapshot, `deletedAt`, `deletedBy`, `expiresAt` (30 days) |
| Slug reservation | `SLUG` | `amazing-grace` | `id` |

- **Songs are keyed by a stable `id`** (`crypto.randomUUID()`, generated on create), not by number.
  Numbers are derived at publish time (see `core`), so adding, deleting or renaming a song shifts
  the numbers after it.
- Listing all songs is one Query (`pk = SONG`). A song's history is one Query. No GSIs are needed,
  and a single partition holding a few hundred 2 KB items is well within limits.
- Song fields are stored as native DynamoDB maps and lists through the DocumentClient
  (`removeUndefinedValues: true`). `firstLine` is derived on the server and can't be edited.

Invariants, each enforced in one `TransactWriteItems` call:

- **Create:** put `SONG/<id>` and `SLUG/<slug>`, each on condition `attribute_not_exists`, and put
  `HIST v1`. Two songs can never share a slug.
- **Update:** update `SONG/<id>` on condition `version = :expected`, returning 409 if it doesn't
  match. Put `HIST v(n+1)` on condition `attribute_not_exists`. If the slug changed, put the new
  `SLUG` (conditional) and delete the old one.
- **Delete (hard):** delete `SONG/<id>` on condition `version = :expected`, delete its `SLUG`, and
  put a `DELETED/<id>` safety copy that DynamoDB's TTL removes after 30 days. The song's `HIST#<id>`
  items are then batch-deleted. The song disappears from the public book on the next publish, and
  every later song moves up one number. Restoring from `DELETED` creates the song again with a new
  history (action `restore`), as long as its slug is still free.
- **Revert:** an update whose content is copied from an older `HIST` item. History is append-only
  while the song exists.

Slugs are generated from the title on create, using the existing `slugify` with a `-2` suffix on
collision. A slug stays fixed when the title changes unless it's explicitly regenerated in the
editor. Because numbers now shift, the slug is what keeps shared links stable: `resolveSong` already
prefers the slug over the number. The short form `/42` always opens whatever is #42 at the time.

## Shared code: a new `core` workspace

Move from `web/parser/` into `core/src/`: `types.ts`, `slugify`, and the first-line derivation.
Add:

- `markup.ts`: `parseSongText(text) -> Section[]` and `formatSongText(sections) -> string`.
- `validate.ts`: `validateSong(input) -> FieldError[]`, including the size limits below.
- `order.ts`: `songOrderKey(title)`, which lowercases the title, maps curly apostrophes to `'`, and
  compares by code point. The admin portal uses the same function to show current numbers.
- `book.ts`: `buildSongbook(meta, songs) -> Songbook`. It sorts by `songOrderKey`, assigns
  `number` 1..n, and adds `schemaVersion` and `updatedAt`. Two identical titles are tie-broken by
  slug.

**Acceptance:** `buildSongbook` over the 96 parsed songs, with their numbers stripped, gives every
song back its current number.

The web app (public and admin), the Lambdas and the seed scripts all import it as a workspace
package of TS source. Vite and esbuild bundle it, and tsx runs it.

### Editor markup

```
Amazing grace! How sweet the sound
That saved a wretch like me!

{chorus}
Who saved us from eternal loss? *(Who but God's Son upon the cross?)*
In heaven interceding!

Through many dangers, toils and snares
```

- One or more blank lines separate blocks. A block is a numbered verse unless its first line is a
  header.
- A header is a line on its own at the start of a block (case-insensitive): `{chorus}`, `{verse}`
  (the default), `{verse*}` (unnumbered), `{part}` (a lettered section) or `{part*}`.
- Labels are never typed. Verses are numbered 1..n and parts lettered a, b, c in order, which matches
  every existing song.
- Inline markup: `*italic*`, `**bold**`, and `[G]` for a chord on the next character (ChordPro
  style). A backslash escapes `*`, `[`, `{` and `\`.
- Adjacent segments with identical formatting are merged, so parse -> format -> parse is stable.
  Curly quotes and non-breaking spaces pass through untouched.

**Acceptance:** for all 96 songs, `parseSongText(formatSongText(song.sections))` deep-equals
`song.sections`.

### Validation limits

- Title 1-200 characters, at most 50 sections, at most 40 lines per section, at most 500 characters
  per line, at most 10 refs, and at most 50 KB per item.
- Control characters other than newline are rejected.
- Whitespace is normalized only where the round-trip test shows the existing data is already
  normalized.
- Song content is rendered by React as text. Keep it that way: a test fails if
  `dangerouslySetInnerHTML` appears in `web/src`.

## Backend: a new `backend` workspace

Handlers live in `backend/src/` and tests in `backend/test/`. The dependencies are
`@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-s3`,
`@aws-sdk/client-cloudfront` and `aws-sdk-client-mock` (dev), all pinned to exact versions. All
Lambdas run on Node.js 22 on arm64 and are bundled with `NodejsFunction`. `esbuild` (pinned) is added
to the infra devDependencies so bundling never falls back to Docker, which isn't running locally.

### Seed Lambda (replaces a hand-run migration)

- A CDK `Trigger` runs it on every deploy, before the publisher. It only acts when `BOOK/META` is
  absent; otherwise it's a no-op.
- It reads a seed `Songbook` JSON shipped as a deploy asset, given to the CDK app as `SEED_FILE`:
  - **Beta, and prod until LaTeX is retired:** generated at synth time by the existing parser from
    `melbourne-songs.tex`. It goes into `cdk.out`, not git.
  - **After retirement:** the frozen snapshot committed at cutover (see below).
- Before writing anything, it validates every song, checks the markup round trip, and checks that
  the derived numbers match the seed's numbers. Then it writes `META` (`seededFrom` = source and git
  SHA). Each song gets a new `id` and becomes one conditional transaction: `SONG`, `HIST v1`
  (action `import`) and `SLUG`. A rerun is a no-op.
- `npm run seed -- --stage beta --reset --yes` (beta only) empties the beta table and re-runs the
  seed, so beta can pick up `.tex` edits made on master.
- After the first beta deploy, a check fetches `/songbook.json` from beta and asserts that it
  deep-equals the parser output, ignoring the added `schemaVersion`/`updatedAt`.

### Publish Lambda

- **Triggers:**
  - The table stream, with batch size 100 and a 5 s batching window, so a burst of saves produces
    one publish. It has 3 retries and an SQS on-failure destination.
  - A CDK `Trigger` after the seed, which runs on every deploy.
  - `POST /api/admin/publish`.
- **What it does:**
  1. Query `SONG` and get `META`.
  2. Run `buildSongbook`, then validate.
  3. **Refuse to publish if there are zero songs.** This guards against an empty or
     half-seeded table.
  4. Put `songbook.json` with `Content-Type: application/json` and
     `Cache-Control: public, max-age=0, must-revalidate`.
  5. Invalidate `/songbook.json` and record `publishedAt` and `publishedHash` on `META`.
- Reserved concurrency is 1, so publishes never race.
- **IAM:** GetItem/Query/UpdateItem on the table, `s3:PutObject` on `<bucket>/songbook.json` only,
  and `cloudfront:CreateInvalidation` on this distribution.
- **Deploy order:** assets, then seed, then publish, then `DeployPages`. A new `index.html` that
  fetches `songbook.json` is never live before the JSON exists, which is what makes the prod
  cutover zero-downtime.
- The `DeployPages` bucket deployment adds `songbook.json` to its `exclude` list, so a site deploy
  can never overwrite live data.

### Admin API

An HTTP API with one Lambda. All routes live under `/api/admin`.

| Route | Purpose |
|---|---|
| `GET /songs` | List: id, derived number, title, version, updatedAt |
| `GET /songs/{id}` | Current song and its version |
| `POST /songs` | Create; returns the new id |
| `PUT /songs/{id}` | Update; the body carries `expectedVersion`, and a mismatch returns 409 |
| `DELETE /songs/{id}?expectedVersion=n` | Hard delete; a mismatch returns 409 |
| `GET /deleted` | Songs deleted in the last 30 days |
| `POST /deleted/{id}/restore` | Re-create a deleted song; returns 409 if its slug is taken |
| `GET /songs/{id}/history` | List of versions |
| `GET /songs/{id}/history/{version}` | One snapshot |
| `POST /songs/{id}/revert` | Body `{ version }` |
| `PUT /book` | Title, released |
| `POST /publish` | Force a republish |

- Every route has the Cognito JWT authorizer, and an infra test fails if any route lacks it. The
  Lambda also requires `admins` in `cognito:groups`.
- Stage throttling (about 5 rps, burst 10) caps both abuse and cost.
- Responses:
  - 400 with the field errors from `validateSong`.
  - 404.
  - 409 with the current version, for a conflict.
  - 500, logged without the request body.
- The Lambda role gets GetItem/Query/UpdateItem/TransactWriteItems/BatchWriteItem on this stage's
  table only.

### CloudFront

- Add a behaviour for `/api/*` that points at the HTTP API origin, with `CachingDisabled`,
  `AllViewerExceptHostHeader` and all methods allowed. Because it's the same origin as the app, no
  CORS is needed and CSP `connect-src 'self'` covers it.
- Add `connect-src 'self' https://<cognito domain>` to the CSP for the PKCE token exchange. The rest
  of the CSP is unchanged.
- The SPA routing function is unchanged. `/admin/...` has no dot, so it is served `index.html`, and
  `/songbook.json` passes through.
- Early in milestone 3, check with curl on beta, with and without a token, that CloudFront forwards
  the `Authorization` header to API Gateway under these managed policies. If it doesn't, the
  fallback is a JWT authorizer identity source on a custom header (`X-Admin-Token`).

### Auth (Cognito, one user pool per stage)

- **User pool:**
  - Self sign-up off; users are created by an admin only.
  - Email sign-in. **MFA off.**
  - Password policy: at least 12 characters.
  - Cognito's built-in lockout after repeated failed sign-ins applies.
  - Deletion protection on, and `RETAIN`.
  - One group, `admins`.
- **App client:**
  - Public, with no secret. Authorization code + PKCE, scopes `openid email`.
  - Callback `https://<each stage hostname>/admin/callback`, logout
    `https://<each stage hostname>/admin`. These URLs are built from the domain env vars at synth
    time, so no hostname ends up in git.
  - Access token valid for 1 h, refresh token for 1 day.
- The Cognito domain prefix is per stage and comes from an env var (`ADMIN_AUTH_DOMAIN_PREFIX`).
  Managed login is used.
- In the browser, `oidc-client-ts`, pinned, is loaded only in the admin chunk, and tokens are kept in
  sessionStorage. The alternative is about 100 lines of hand-rolled PKCE, but auth code is not worth
  owning.
- The admin user is created once per stage with `aws cognito-idp admin-create-user` and
  `admin-add-user-to-group`, documented in the README. The first login forces a password change.
- With MFA off, the password is the only factor. The blast radius is song content, which history and
  PITR can recover. If you later want something stronger with no prompts, managed login supports
  passkeys.

## Frontend

### Public app

- `web/src/lib/data.ts` replaces `virtual:songbook` with `loadSongbook()`. It fetches
  `/songbook.json`, caches the promise and checks `schemaVersion`.
- A root route loader awaits it. Components read the data through `useSongIndex()`, built on
  `useRouteLoaderData`, instead of the module-level `index`/`search`. This touches `IndexPage`,
  `SongPage`, `NotFound`/`NumberRedirect`, `NumberJump` and `Layout`.
- `web/index.html` gets `<link rel="preload" href="/songbook.json" as="fetch" crossorigin>`, so the
  JSON downloads in parallel with the JS.
- Add a loading fallback, and an error screen with a retry button.
- In `Layout`, the "released ..." text becomes "updated <date>" from `updatedAt` (Decision 4), and
  the "Beta" badge shows when `VITE_STAGE=beta`.
- In dev, the Vite server proxies `/songbook.json` (and later `/api`) to beta, using
  `DEV_PROXY_TARGET` from `.env.local`. The tests use a fixture JSON.

### Admin portal

The portal lives at `/admin` as a lazy-loaded route chunk, with `noindex` and no link from the public
pages.

1. **Login, callback and logout.**
2. **Song list:** current number, title and last edited, with a filter box and a "New song" button.
   A **Recently deleted** tab lists the last 30 days of deletions, each with a Restore button.
3. **Editor:**
   - Metadata fields: title, slug (with a regenerate button), key, author, copyright (with a
     "Public Domain" quick-fill), scripture and a refs list.
   - When a title edit changes the song's position, the editor shows it: "will move from #42 to
     #57".
   - Delete asks for confirmation and says how many songs will move up a number.
   - A lyrics textarea in the markup above, with a live preview beside it using the existing
     `SongLyrics` component (stacked on mobile).
   - Inline validation errors.
   - A Save button that is disabled when nothing has changed, and a warning before navigating away
     with unsaved changes.
   - On a 409: the message "changed elsewhere", a reload button, and your unsaved text kept in a side
     panel.
4. **History:** the list of versions, a preview of any version, a line diff of its markup against the
   current version (a small built-in LCS, no dependency), and a Revert button.
5. **Book settings:** title.
6. **Publish status:** `publishedAt` compared with the latest `updatedAt`, so a stuck publish is
   visible, plus a Republish button.

The portal uses the same Tailwind setup and theme as the public app.

## Milestones (all on this branch, each deployed to beta)

| # | Scope | Result on beta | Effort |
|---|---|---|---|
| 1 | `core` workspace: model, markup, validator, `buildSongbook`; round-trip tests over all 96 songs | none (code only) | 2-3 h |
| 2 | Stage-aware stack (prod logical IDs preserved, prod guard), beta cert + DNS, table, seed + publish Lambdas, public app reads `/songbook.json` | the beta hostname serves the current songbook from DynamoDB, identical to prod | 4-5 h |
| 3 | Cognito, admin API, `/api/*` behaviour, admin list/editor/preview | `/admin` on beta: log in, edit, see it published | ~1 day |
| 4 | History, diff, revert, publish status, book settings, README | full admin portal on beta | 2-3 h |
| 5 (optional) | Weekly GitHub Action committing prod's public `songbook.json` to a `content` branch (git-diff history and an off-AWS backup); enabled at cutover | none | 1 h |

About 1.5-2 days of my work in total. Master doesn't change at any point.

A draft PR from this branch, titled "do not merge until cutover", gives CI checks (typecheck, tests,
build, synth) on every push without deploying anything. The OIDC deploy role only trusts master.

## Cutover to production (only when you decide)

1. **Prod data source (Decision 6): decided, the latest `.tex` on master;** beta stays a sandbox and
   its data is not promoted. (The alternative was beta's data exported with
   `npm run export -- --stage beta --out <dir>`, whose `songbook.json` is accepted as `SEED_FILE`.)
2. **Freeze the seed:** commit it as `data/seed-songbook.json`. It also becomes the round-trip test
   fixture once the parser is gone.
3. **Retire LaTeX in the same final commits:**
   - Tag master's head as `latex-final`.
   - Keep the PDF that is live today at its current URL, `/melbourne-songs.pdf`, on every site
     hostname (Decision 1). Download it from prod right before the final commit and commit those
     exact bytes as `web/public/melbourne-songs.pdf`. Record its sha256 in the commit message. Don't
     use the root `melbourne-songs.pdf` in git: it's a different, older file (on 2026-10-12 the live
     file's sha256 began `eaa94bf9` and the committed one `8f2eb7e2`).
   - Link it as "Printed edition (<its Last Revised date>)", currently 11 April 2026, with a note
     that later changes aren't in it. Its numbers stop matching the site after the first add,
     delete or rename that changes the order.
   - Remove the TeX steps from `.github/workflows/web.yml`, along with `web/parser/` (whatever
     didn't move to `core`), the Vite plugin, `melbourne-songs.tex`/`.pdf` and the LaTeX package
     files (Decision 3).
   - Update README, CLAUDE.md and the workflow `paths` filter.
4. **Rehearse:** deploy beta with `--reset` and the frozen seed, and check it end to end, including
   that beta's `/melbourne-songs.pdf` has the recorded sha256. Add the
   `SITE_AUTH_DOMAIN_NAME` and `SITE_AUTH_CERTIFICATE_ARN` repository secrets (prod's sign-in
   hostname and its already-issued certificate).
5. **Merge.** Master CI then deploys prod in place:
   - The distribution and bucket are updated, not replaced.
   - The seed runs into the new empty prod table, and the publisher writes `songbook.json`, all
     before the new `index.html` goes live.
   - Then CNAME prod's sign-in hostname (DNS only) to the deploy's `AuthDomainTarget` output.
     Until it resolves only the admin sign-in is down; the public site is unaffected.
6. **Create the prod admin user,** then smoke-test prod. The smoke test includes
   `/melbourne-songs.pdf` on each hostname: it returns 200 `application/pdf` with the recorded
   sha256. Also check that `/melbourne-songs-v0.1.pdf` still loads.
7. **Run the Content export workflow once by hand** (Actions tab) and check that the `content`
   branch now holds prod's `songbook.json`. From then on it runs weekly.

Afterwards, beta can stay as a staging environment or be torn down (the table and user pool are
retained and need deleting by hand).

### Cutover log

14 October 2026, Melbourne time.

- **Steps 2-3:** the seed is `melbourne-songs.tex@28e3f5e` (96 songs), frozen as
  `data/seed-songbook.json`. Master's head at the time, 145326a, is tagged `latex-final`. The live
  PDF's sha256 is `eaa94bf91886a1823b01ad6dedd3949bbec10307014fdfe91e92dde54eaf1072`, the same on
  both prod hostnames, and it is committed as `web/public/melbourne-songs.pdf`.
- **Step 4:** beta was redeployed and re-seeded with `--reset` from the frozen seed. These checks
  passed:
  - `check:published`.
  - The PDF hash on beta, and `/melbourne-songs-v0.1.pdf` returning 200.
  - Sign-in on the custom domain without touching `amazoncognito.com`.
  - The API smoke test: create, update, 409 on a stale save, 400 on invalid input, history, revert,
    delete, restore, republish, and 401 without a token.
  - The portal end to end in WebKit.

  The test user was deleted and beta re-seeded again afterwards. `cdk diff` against prod updates
  the distribution and response-headers policy in place, leaves the bucket alone, and only adds
  resources. The `SITE_AUTH_*` secrets were added.
- **Steps 5-7:** the PR was merged, then the CI deploy, the sign-in CNAME, the prod editor, the
  smoke test and the first export followed.

**Later, not part of the cutover: redirect the PDF URL to the site.** At some point after the
cutover, `/melbourne-songs.pdf` is to redirect to the songs site's home page. When that happens:

- Do it in the routing CloudFront function, so the redirect is returned before the request reaches
  the bucket. Deleting the file alone isn't enough: `DeployPages` runs with `prune: false`, so the
  old object would stay in the bucket and keep being served.
- `Location: /` keeps a visitor on whichever hostname they used. To send everyone to the songs
  hostname, the function needs that absolute URL. Build it at synth time from `SITE_DOMAIN_NAME`, so
  no hostname is committed to git.
- Remove the footer link in `web/src/components/Layout.tsx` and the `<noscript>` link in
  `web/index.html` in the same change.
- Start with a 302. Browsers cache a 301 indefinitely, so switch to 301 only once it's final. The
  PDF is served with `max-age=0`, so a redirect takes effect as soon as it's deployed.

## Testing

- **core:**
  - The round trip over all 96 songs.
  - Markup edge cases: escapes, headers, chords, empty blocks, non-breaking spaces.
  - Validator limits.
  - `buildSongbook` reproduces all 96 current numbers, renumbers after a delete or rename, and
    breaks ties by slug.
- **backend** (vitest + `aws-sdk-client-mock`):
  - Seeding is a no-op when `META` exists, and seeds fully when it doesn't.
  - Create writes a new id, and a slug collision returns 409.
  - A stale `expectedVersion` on update or delete returns 409.
  - Delete removes the song, its slug and its history, and leaves a `DELETED` copy with a 30-day
    `expiresAt`.
  - Restore re-creates the song, or returns 409 if its slug has been taken since.
  - Revert writes the right history.
  - The group check works.
  - The publisher refuses an empty book, and writes the right key and headers.
- **infra** (`infra/test/stacks.test.ts`):
  - The prod template keeps master's logical IDs for the bucket, distribution, headers policy and
    routing function.
  - The prod stage can't be synthesized outside CI on master.
  - The table has PITR, deletion protection, TTL on `expiresAt`, and `RETAIN`.
  - The user pool has self sign-up off.
  - Every route has an authorizer.
  - `/api/*` uses `CachingDisabled`.
  - The publisher's S3 permission is limited to `songbook.json`.
  - `songbook.json` is excluded from `DeployPages`.
  - Beta sends `X-Robots-Tag`.
  - No hostname or ARN literals appear, as now (example.com in tests).
- **Beta smoke checklist after each deploy:**
  - `/songbook.json` returns 200 with 96 songs.
  - `/api/admin/songs` returns 401 without a token and 200 with one.
  - After editing a test song, the public JSON updates within about 30 s, and a revert works.

## Security

The new surface is the admin API and Cognito, in each stage. Controls:

- A JWT authorizer on every route, plus a group check.
- Self sign-up off, a 12-character minimum password, and Cognito's built-in lockout. MFA is off by
  choice.
- Same origin, so no CORS.
- Throttling.
- Validation and size limits.
- A least-privilege role per Lambda, scoped to its own stage.
- Content rendered as text.
- Append-only history and PITR for recovery.
- A prod-deploy guard on the branch.
- Hostnames and ARNs kept in secrets and env files, as today.

WAF isn't included because it adds a monthly cost per distribution. It can be added later.

## Cost

Beta roughly doubles a bill that is already cents a month: two small distributions, on-demand
DynamoDB, Lambda and HTTP API at this volume, Cognito within its free tier, and invalidations within
the 1,000 free paths a month. PITR is billed on table size, which is under 1 MB per table. Check the
[AWS pricing calculator](https://calculator.aws/) for real numbers.

## Decisions needed

Defaults are in bold.

1. **PDF after retirement:** **freeze the live PDF as a legacy download** / drop it / add a print
   stylesheet later. Decided (2026-10-12): freeze it, keep serving the exact live file at
   `/melbourne-songs.pdf`, and redirect that URL to the site later (see the end of the cutover
   section).
2. **Safety copy of a hard-deleted song:** **keep it for 30 days, restorable from the admin
   portal** / purge everything immediately (point-in-time recovery is then the only way back, for
   35 days).
3. **LaTeX package files at cutover:** **delete them from master after tagging `latex-final`** /
   move them to `legacy/`.
4. **Date shown on the site:** **an automatic "updated" date from the latest edit** / a manually
   edited "released" date.
5. **Where the admin portal lives:** **`/admin` on each stage's hostnames** / a separate hostname.
6. **Prod data at cutover:** **seed from the latest `.tex` on master (beta is a sandbox)** / promote
   beta's data. Decided (2026-10-10): seed from the `.tex`.
7. **Beta deploys:** **from my machine** / a CI job on this branch. The CI job needs a second OIDC
   role trusting the branch, and that role would be as powerful as master's, because both act
   through the CDK bootstrap roles.
8. **Git backup export (milestone 5):** **yes** / no. Decided: yes, weekly rather than nightly.
9. **Local admin dev against beta's API** (adds a `localhost` callback URL to the beta pool only):
   **yes** / no.

## Risks

- **CloudFront might not forward `Authorization`:** checked on beta in milestone 3, with the
  custom-header fallback above.
- **The round trip might not be lossless for some song:** milestone 1's tests catch this before any
  data moves. The fix is in the formatter, or in normalizing the data.
- **Numbers shift:** anyone using a number from the old PDF, or a `/42` short link, gets whatever is
  #42 now. Full `/songs/<number>/<slug>` links keep working through the slug.
- **The prod cutover might replace the distribution:** prevented by preserving logical IDs (an infra
  test asserts it) and rehearsed with a `cdk diff` against prod before merging.
- **The branch drifts from master during a long beta:** handled by periodic merges from master and
  the beta re-seed.
- **A publish failure might go unnoticed:** covered by the on-failure queue, plus the publish status
  in the admin portal.
- **Git as the review step is lost:** replaced by per-edit history with revert, PITR, and optionally
  the git export.

## Implementation notes

What the build does differently from the plan above, and why. The decisions all took their
defaults, except that the git export (Decision 8) runs weekly.

- **Publish status lives in `BOOK/PUBLISH`, not on `META`.** The stream triggers a publish on `META`
  changes (book title, and every edit bumps `META.updatedAt`), so the publisher writing its own
  status there would trigger itself. The stream's event filter passes only `SONG` and `BOOK/META`.
  A stream-triggered publish also skips a book whose hash is unchanged; deploy, API and script
  publishes always write.
- **The seed and publish triggers run on a stage's first deploy and whenever their code changes,**
  which is what CDK `Trigger` offers, rather than on every deploy. The seed is a no-op after the
  first run anyway, and a bundle change (core included) republishes. `npm run seed` and
  `npm run republish` run them on demand.
- **The seed writes `META` last** and resumes an interrupted run (a song whose slug is already
  reserved was imported). The publisher publishes nothing until `META` exists, so it never sees a
  half-seeded table. `--reset` deletes `META` first for the same reason.
- **The portal calls the API with the ID token,** not the access token: Cognito's access token has
  no email, and `updatedBy`/`changedBy` should name the editor. The HTTP API authorizer checks
  its audience (the portal's client ID) and issuer; the Lambda checks the `admins` group.
- **CloudFront forwards `Authorization`** under `CachingDisabled` + `AllViewerExceptHostHeader`
  (checked on beta), so the `X-Admin-Token` fallback was not needed.
- **API additions:** `GET /book` (book title and publish status, for the Book page), an optional
  `{ slug }` body on restore for when the old slug has been taken, and revert keeps the song's
  current slug (links stay stable). The contract is in `core/src/api.ts`.
- **The portal's sign-in settings** (user pool, client, Cognito domain) are written to
  `/admin-config.json` by the pages deployment at deploy time, so the build needs no stack outputs.
  oidc-client-ts gets explicit endpoints, so no discovery request is needed and the CSP adds only
  the Cognito domain to `connect-src`.
- **The Cognito domain prefix defaults to `melbourne-songs-<stage>`**, overridable with
  `SITE_AUTH_DOMAIN_PREFIX` / `BETA_AUTH_DOMAIN_PREFIX`. User pools use the Essentials feature
  plan, which managed login needs.
- **Each stage can sign in on its own hostname instead** (added after milestone 5):
  `SITE_AUTH_DOMAIN_NAME` + `SITE_AUTH_CERTIFICATE_ARN` (`BETA_*` for beta), a us-east-1
  certificate per stage. The custom domain replaces the prefix domain; the issuer, and so the
  API's JWT authorizer, is unchanged. Its DNS CNAME target is the `AuthDomainTarget` output, which
  only exists after the deploy that creates the domain.
- **Markup detail:** a chord with no text yet (`[G]` before another chord or at the end of a line)
  carries no formatting, and a bare chord followed by plain text takes that text. This makes
  every canonical line round-trip; `validateSong` rejects lyrics that are not in canonical form,
  and `normalizeSongInput` produces it.
- **Generated slugs are capped at 80 characters**, cut at a word boundary.
- **The git export runs weekly** (Mondays about 03:17 Melbourne time), not nightly, by choice
  (Decision 8). It fetches prod's public `songbook.json` through the site (address from the existing
  `SITE_DOMAIN_NAME` secret, masked in the logs), so it needs no AWS role. `npm run export` does
  the fetch and check: it refuses an error page, a truncated file or a book the seed's own check
  rejects, and pretty-prints the book so diffs show changed lines. The workflow commits only when
  the file changed, to an orphan `content` branch holding just the book and a README.
- **`SEED_FILE` also accepts a published `songbook.json`** (wrapped as a SeedFile at synth), so an
  export restores with one setting. This replaces the `seed:export` script the cutover section
  mentioned: `npm run export -- --stage beta` is that script.
- **The Vite plugin is gone, but `npm run dev` still has a book:** without a `DEV_PROXY_TARGET`,
  a small dev-only middleware in `web/vite.config.ts` serves the frozen seed as `/songbook.json`.
  The printed PDF is served from `web/public/` like any other static file.
