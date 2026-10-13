# Melbourne Songs

A songbook for Melbourne church gatherings, as a searchable web app. Editors
add and change songs in the [admin portal](#song-data-and-the-admin-portal);
the site republishes within seconds.

The book began as a LaTeX songbook. Its last LaTeX source is tagged
`latex-final`, and its last printed edition is still served at
`/melbourne-songs.pdf` (see [Web app](#web-app)).

## Structure

```
core/                  # Song model, editor markup, validation and book order (shared TypeScript)
backend/               # Lambdas (seed, publish, admin API) and scripts that drive a deployed stage
web/                   # Public web app and the admin portal (/admin)
web/public/            # Files served as-is at the site root, including the printed editions (PDFs)
infra/                 # AWS CDK app: S3 + CloudFront, DynamoDB, Lambdas, Cognito, HTTP API
data/                  # seed-songbook.json: the book an empty table is seeded from
docs/plans/            # Design of the DynamoDB migration and admin portal
.github/workflows/     # CI: tests and redeploys on every push to master; weekly export to git
```

## Web app

The web app lets people search, browse and read the songs. It loads them from
`/songbook.json`, which a Lambda publishes from DynamoDB whenever an editor
saves a song in the admin portal (see
[Song data and the admin portal](#song-data-and-the-admin-portal)).

- **Hymn numbers are alphabetical positions.** A song's number is its place
  in the book's alphabetical order (titles lowercased, compared by code
  point). Adding, deleting or renaming a song renumbers the songs after it.
- **Get to a hymn by number:** type the number in the `#` box, or just type it
  anywhere on the site. The hymn opens as soon as the number is unambiguous
  ("25" at once; "2" after a one-second pause in case "25" is coming). You
  can also search for `42` or open `/42`.
  Song URLs look like `/songs/42/because-he-lives`. If the book is later
  renumbered, the slug still finds the right hymn.
- **Search** covers titles, first lines, lyrics and authors. It matches as you
  type and tolerates typos.
- **The printed edition** (`web/public/melbourne-songs.pdf`, last revised
  11 April 2026) is the PDF the LaTeX build last published, kept byte for
  byte at its old URL. It doesn't follow later edits, and its numbers stop
  matching the site once a change reorders the book. `web/public/` also holds
  the archived `melbourne-songs-v0.1.pdf`, which keeps its old URL too.

### Develop

Requires Node.js 22+.

```bash
npm install
npm run dev        # http://127.0.0.1:5173; /songbook.json is the frozen seed (or DEV_PROXY_TARGET's book)
npm test           # core, backend (Lambdas), web and CDK tests
npm run typecheck
npm run build      # production build in web/dist
```

The workspaces: `core/` (the song model, editor markup, validation and book
order, shared by everything), `backend/` (the Lambdas and the scripts that
drive a deployed stage), `web/` (the public site and the admin portal) and
`infra/` (the CDK app).

### Deploy

Pushes to `master` that touch `data/`, `core/`, `backend/`, `web/` or
`infra/` run `.github/workflows/web.yml`. It typechecks, tests and builds,
then deploys the **prod** stage with `cdk deploy`, using a GitHub OIDC role
(no stored AWS keys). Pull requests run the same checks without deploying.

The CDK app builds the prod stage (`MelbourneSongsSite`) **only in CI on
master**. Everywhere else, a laptop included, it builds the beta stage
(`MelbourneSongsBeta`), so nothing outside master can deploy production.

One-time setup, already done for this repo (region `ap-southeast-2`):

```bash
aws sso login
npx cdk bootstrap                        # once per account/region
npm run build
cd infra && npx cdk deploy --all         # creates the site and the GitHub deploy role
gh variable set AWS_DEPLOY_ROLE_ARN --body <DeployRoleArn output>
```

The deploy role reuses the account's existing GitHub OIDC provider. In an
account without one, deploy with `-c createGithubOidcProvider=true`.

Deploy beta from a laptop: `npm run deploy:beta` (after `aws sso login`).

### Custom domain

The domain and its certificate are deliberately kept out of the repo. The
CDK app reads them from two settings per stage:

| Setting | Value |
| --- | --- |
| `SITE_DOMAIN_NAME` | Prod hostname(s), comma-separated for more than one, e.g. `songs.example.com,files.example.com` |
| `SITE_CERTIFICATE_ARN` | ACM certificate covering **every** prod name, **in us-east-1** (a CloudFront requirement) |
| `BETA_DOMAIN_NAME`, `BETA_CERTIFICATE_ARN` | The same for the beta stage, e.g. `beta.songs.example.com` |

- **CI:** repository *secrets* (not variables, so they are masked in public logs).
- **Locally:** `infra/.env.local`, which is gitignored:

  ```bash
  SITE_DOMAIN_NAME=songs.example.com,files.example.com
  SITE_CERTIFICATE_ARN=arn:aws:acm:us-east-1:<account>:certificate/<id>
  ```

A deploy without these settings fails rather than detaching the domain from
the live site. To deploy without a custom domain on purpose, set
`SITE_NO_DOMAIN=true`.

To add or move to a new domain:
1. Request an ACM certificate in us-east-1 that covers every name the site
   should keep serving, and validate it through DNS.
2. Update both settings and deploy. CloudFront swaps the certificate in place,
   so the existing names stay up.
3. Point each new name's CNAME at the distribution's `*.cloudfront.net` address (DNS only, not proxied).

## Song data and the admin portal

```
Admin browser (/admin) --ID token--> CloudFront /api/* --> HTTP API (JWT authorizer) --> admin Lambda --> DynamoDB
                                                                                                           | stream
Public browser --> CloudFront --> S3: index.html, assets/, songbook.json <-- publish Lambda <-------------+
```

Each stage (prod, beta) has its own table, user pool, API, Lambdas, bucket
and distribution, all from the same stack class, so beta runs what prod will.
The design and its decisions are in
[docs/plans/dynamodb-admin.md](docs/plans/dynamodb-admin.md).

- **The table** holds the current songs, every saved version, a 30-day copy
  of each deleted song, slug reservations and the book's title. It has
  point-in-time recovery and deletion protection, and is kept if the stack is
  deleted.
- **The publisher** rebuilds `songbook.json` (numbering the songs
  alphabetically) within seconds of a save, and on each deploy before the new
  `index.html` goes live. It refuses to publish an empty or invalid book. A
  site deploy never touches `songbook.json`.
- **The seed** fills an empty table on a stage's first deploy, from
  `data/seed-songbook.json` (the `.tex` as parsed when LaTeX was retired),
  or from `SEED_FILE`: a SeedFile JSON, or a `songbook.json` from the
  export below. It checks every song first, and is a no-op once the table
  holds a book.
- **The weekly export** commits prod's `songbook.json` to the `content`
  branch: see [Export to git](#export-to-git).

### Beta

Beta is a staging sandbox, marked with a Beta badge and kept out of
search engines (`X-Robots-Tag: noindex`). Its settings go in
`infra/.env.local` (see [Custom domain](#custom-domain); without them set
`SITE_NO_DOMAIN=true` to serve on its `*.cloudfront.net` address only).

```bash
npm run deploy:beta                                # build with the Beta badge, then cdk deploy MelbourneSongsBeta
npm run seed -- --stage beta --reset --yes         # discard beta's edits and re-import the frozen seed
npm run check:published -- --stage beta            # is beta's songbook.json exactly the frozen seed?
npm run republish -- --stage beta                  # rebuild songbook.json now
```

`seed` refuses to run against prod, whose table is seeded once by its first
deploy.

| Optional setting | Meaning |
| --- | --- |
| `BETA_AUTH_DOMAIN_PREFIX`, `SITE_AUTH_DOMAIN_PREFIX` | Cognito sign-in domain prefix (default `melbourne-songs-<stage>`); must be unique in the region. Not used with a [sign-in hostname](#sign-in-domain) |
| `SEED_FILE` | Seed the stage from this file instead of `data/seed-songbook.json`: a SeedFile JSON, or a `songbook.json` written by `npm run export` |
| `DEV_PROXY_TARGET` (in `web/.env.local`) | Point `npm run dev` at a deployed stage, e.g. `https://beta.songs.example.com`: the dev server proxies `/songbook.json`, `/admin-config.json` and `/api` to it |

### Editors

Editors sign in at `/admin` on the stage's site. There is no sign-up: add an
editor with the stage's `UserPoolId` (a stack output). Cognito emails them a
temporary password, which they change on first sign-in.

```bash
POOL=<UserPoolId output>
aws cognito-idp admin-create-user --user-pool-id "$POOL" --username editor@example.com \
  --user-attributes Name=email,Value=editor@example.com Name=email_verified,Value=true
aws cognito-idp admin-add-user-to-group --user-pool-id "$POOL" --username editor@example.com --group-name admins
```

Remove one with `aws cognito-idp admin-delete-user`. Passwords need 12 or
more characters; there is no MFA. With beta's `DEV_PROXY_TARGET` set, the
portal also works from `npm run dev` at `http://localhost:5173/admin` (the
beta user pool allows that address; prod's does not).

### Sign-in domain

Managed login is served on the stage's Cognito prefix domain
(`<prefix>.auth.<region>.amazoncognito.com`) unless the stage has its own
sign-in hostname, kept out of the repo like the site's domain:

| Setting | Value |
| --- | --- |
| `SITE_AUTH_DOMAIN_NAME`, `SITE_AUTH_CERTIFICATE_ARN` | Prod's sign-in hostname, e.g. `auth.songs.example.com`, and an ACM certificate for it **in us-east-1** |
| `BETA_AUTH_DOMAIN_NAME`, `BETA_AUTH_CERTIFICATE_ARN` | The same for beta, e.g. `auth.beta.songs.example.com` |

Set both or neither (CI: repository secrets; locally: `infra/.env.local`).
The hostname's parent (`songs.example.com` here) must resolve to an IP
address, which the site's own CNAME already does. To move a stage to its
own hostname:
1. Request and DNS-validate the certificate in us-east-1.
2. Set both settings and deploy. Cognito fronts the hostname with a
   CloudFront distribution of its own, which can take up to an hour to come
   up; the old prefix domain keeps working until the deploy swaps it out.
3. CNAME the hostname (DNS only, not proxied) to the stack's `AuthDomainTarget`
   output. Sign-in on that stage works once it resolves.

The sign-in pages are styled to match the site (stone colours, light or dark
following the browser, the site's icon and title) by
`infra/lib/login-branding.ts`. Cognito lets a style change colours, logos and
layout but not the wording. The logo spells out the title, so update it there
if the book is renamed. To try a change without a deploy, push it straight
to beta with `aws cognito-idp update-managed-login-branding`; the next deploy
replaces whatever is live with what the code says.

### The admin portal

- **Songs:** the book in order, with each song's number, a filter, and
  whether the public site has caught up with the latest edit (with a
  Republish button if a publish is stuck).
- **Editor:** the song's details and lyrics, with a live preview. It shows
  when a title change will renumber the song, refuses to save over someone
  else's newer save (and keeps your text), and warns before you leave with
  unsaved changes. A song's *link name* (slug) is what keeps shared links
  working when numbers change, so change it only if you must.
- **History:** every saved version, how it differs from the current one, and
  Revert (which saves the old content as a new version).
- **Recently deleted:** deleted songs can be restored for 30 days. After
  that, point-in-time recovery (35 days) is the way back.
- **Book:** the book's title.

Lyrics are plain text:

| Write | For |
| --- | --- |
| A blank line | A new verse; verses are numbered for you |
| `{chorus}` as a block's first line | A chorus |
| `{verse*}` | An unnumbered verse (`{part}` / `{part*}`: lettered / unlettered parts) |
| `*words*`, `**words**` | Italic, bold |
| `[G]` | A chord over the text that follows |
| `\*`, `\[`, `\{`, `\\` | A literal `*`, `[`, `{` or `\` |

### Export to git

Once a week (Monday about 03:17 in Melbourne), the Content export workflow
(`.github/workflows/content-export.yml`) commits prod's public `songbook.json`
to the `content` branch, if it has changed since the last export. That
branch holds only the book and a README, so `git log -p content` is the
book's edit history, and the file is a backup outside AWS. The workflow reads
the site's address from the `SITE_DOMAIN_NAME` secret and needs nothing else.
Run it by hand from the Actions tab to export now.

The export refuses an error page, a truncated file or a book the seed would
reject, so every commit on `content` can re-seed a table:

```bash
npm run export -- --stage beta --out .tmp/export       # the same check and file, for any stage
git show origin/content:songbook.json > .tmp/songbook.json
SEED_FILE=.tmp/songbook.json npm run deploy:beta       # seeds a stage whose table is empty
```

Point-in-time recovery (35 days) is still the first way back for prod; the
export covers losing the table or the account.
