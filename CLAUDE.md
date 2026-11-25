# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Melbourne Songs: a songbook for Melbourne church gatherings, served as a searchable web app with an
admin portal. The songs live in DynamoDB; editors change them in the portal at `/admin`, and a
Lambda republishes `/songbook.json`, which the public site reads. Another Lambda, on the same stream,
remakes the book's PDF at `/melbourne-songs.pdf` after every edit. The book used to
be a LaTeX songbook; its last source is tagged `latex-final`, and its last LaTeX PDF is archived as
`web/public/melbourne-songs-2026-04-11.pdf`. The README covers everything below in more detail, and
`docs/plans/dynamodb-admin.md` has the design and its decisions.

## Commands

Requires Node.js 22+ (npm workspaces).

```bash
npm install
npm run dev          # web app on http://127.0.0.1:5173 (book from data/seed-songbook.json, or DEV_PROXY_TARGET)
npm test             # core, backend, web and infra tests (vitest)
npm run typecheck
npm run build        # web/dist
npm run synth        # CDK synth (beta stage outside CI)
npm run deploy:beta  # build with the Beta badge and deploy MelbourneSongsBeta
```

## Layout

- `core/` - shared song model: types, editor markup (`parseSongText`/`formatSongText`), validation,
  alphabetical order and `buildSongbook` (numbers are derived from that order).
- `backend/` - Lambdas (seed, publish, PDF, admin API) and scripts that drive a deployed stage
  (`npm run seed|republish|check:published|export|pdf`). `npm run pdf -- --out .tmp/x.pdf`
  renders the PDF locally.
- `web/` - React public site and admin portal (`web/src/admin/`). `web/public/` is copied to the
  site root as-is.
- `infra/` - CDK app. `MelbourneSongsSite` (prod) is only built in CI on master; everywhere else
  the app builds `MelbourneSongsBeta`.
- `data/seed-songbook.json` - the book an empty table is seeded from (`SEED_FILE` overrides it).

## Rules

- Keep domain names and certificate ARNs out of git: CI reads them from repository secrets, local
  runs from the gitignored `infra/.env.local`. Use `example.com` in tests and docs.
- Song content is rendered as text by React; never use `dangerouslySetInnerHTML` in `web/src`
  (a test enforces it).
- Preserve the prod stack's logical IDs (an infra test asserts them), so a deploy updates the live
  distribution and bucket in place instead of replacing them.
- A site deploy must never overwrite `songbook.json` or `melbourne-songs.pdf`; only the publisher
  and the PDF Lambda write them.
