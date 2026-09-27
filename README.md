# Melbourne Songs

A LaTeX songbook for Melbourne church gatherings.

## Build

```bash
pdflatex melbourne-songs.tex
```

## Generate Indexes

```bash
./mksbtdx melbourne-songs    # Title/first-line index
./mksbkdx melbourne-songs    # Key index
./mksbadx melbourne-songs    # Artist index
```

Then recompile to include the indexes.

## Adding Songs

Add songs before `\end{document}` in `melbourne-songs.tex` using:

```latex
\begin{song}{Title}{}
  {\SBPubDom}
  {Author}
  {}
  {}

  \begin{SBVerse}
    Lyrics here...
  \end{SBVerse}

  \begin{SBOpGroup}
    Chorus/refrain here...
  \end{SBOpGroup}
\end{song}
```

## Structure

```
melbourne-songs.tex    # Main songbook source (source of truth for the PDF and the web app)
melbourne-songs.pdf    # Compiled output
songbook.sty           # LaTeX style (required)
web/                   # Web app, generated from melbourne-songs.tex at build time
infra/                 # AWS CDK app that hosts the web app (S3 + CloudFront)
.github/workflows/     # CI: rebuilds and redeploys the web app on every push to master
samples/               # Original Songbook 4.3 examples
contrib/               # Utilities (chord diagrams, transposition)
```

Built using the [Songbook 4.3](http://www.rath.ca/Misc/Songbook/) LaTeX package.

## Web app

The web app lets people search, browse and read the songs. It has no song
data of its own: at build time `web/parser/` reads `melbourne-songs.tex`, so
editing the `.tex` file and pushing to `master` updates the site.

- **Hymn numbers match the PDF.** A song's number is its position among the
  `\begin{song}` blocks that are not commented out, the same counter
  `songbook.sty` prints. Songs excluded with `\begin{song}[N]` still use up a
  number, as they do in the PDF.
- **Get to a hymn by number:** type the number in the `#` box, or just type it
  anywhere on the site. The hymn opens as soon as the number is unambiguous
  ("25" at once; "2" after a one-second pause in case "25" is coming). You
  can also search for `42` or open `/42`.
  Song URLs look like `/songs/42/because-he-lives`. If the book is later
  renumbered, the slug still finds the right hymn.
- **Search** covers titles, first lines, lyrics and authors. It matches as you
  type and tolerates typos.
- The **PDF** download serves the committed `melbourne-songs.pdf`, so commit
  the recompiled PDF along with `.tex` changes. `web/public/` holds files
  published as-is at the site root, such as the archived
  `melbourne-songs-v0.1.pdf`, which keeps its old URL.

The parser understands the environments and commands this songbook uses
(`SBVerse`, `SBOpGroup`, `SBChorus`, `SBSection`, `\textit`, `\Ch`, `\SBRef`,
TeX quotes and dashes, accents, `\WBColBrk`, ...). Anything else **fails the
build with a line number**, e.g.
`melbourne-songs.tex:1234: unsupported command \foo`, rather than publishing
garbled lyrics. To support a new construct, add it to `web/parser/latex.ts`
(lyrics) or `web/parser/parse.ts` (between verses).

### Develop

Requires Node.js 22+.

```bash
npm install
npm run dev        # http://127.0.0.1:5173, reloads when melbourne-songs.tex changes
npm run parse      # check the .tex parses; `npm run parse -- out.json` dumps the data
npm test           # parser, search and CDK tests
npm run build      # production build in web/dist
```

### Deploy

Pushes to `master` that touch the songbook, `web/` or `infra/` run
`.github/workflows/web.yml`. It parses, tests and builds, then deploys with
`cdk deploy`, using a GitHub OIDC role (no stored AWS keys). Pull requests
run the same checks without deploying.

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

Manual deploy from a laptop: `npm run deploy` (after `aws sso login`).

### Custom domain

The domain and its certificate are deliberately kept out of the repo. The
CDK app reads them from two settings:

| Setting | Value |
| --- | --- |
| `SITE_DOMAIN_NAME` | e.g. `songs.example.com` |
| `SITE_CERTIFICATE_ARN` | ACM certificate for that name, **in us-east-1** (a CloudFront requirement) |

- **CI:** repository *secrets* (not variables, so they are masked in public logs).
- **Locally:** `infra/.env.local`, which is gitignored:

  ```bash
  SITE_DOMAIN_NAME=songs.example.com
  SITE_CERTIFICATE_ARN=arn:aws:acm:us-east-1:<account>:certificate/<id>
  ```

A deploy without these settings fails rather than detaching the domain from
the live site. To deploy without a custom domain on purpose, set
`SITE_NO_DOMAIN=true`.

To move to a new domain:
1. Request an ACM certificate for it in us-east-1 and validate it through DNS.
2. Update both settings and deploy.
3. Point the new name's CNAME at the distribution's `*.cloudfront.net` address (DNS only, not proxied).
