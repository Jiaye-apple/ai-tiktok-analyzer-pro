# Cloudflare Workers backend and web workbench

This directory contains the public source for the AI TikTok Downloader Pro
backend and multilingual server-rendered website.

## Stack

- Hono and TypeScript on Cloudflare Workers
- D1 for product data, accounts, quotas and tasks
- KV for short-lived state and rate-limit counters
- R2 for generated files and application-owned assets
- Queues and cron triggers for asynchronous processing
- Vectorize and AI-provider fallbacks for creator and content analysis

## Local verification

```bash
npm ci
npm run i18n:check
npm run typecheck
npm run test:unit
```

`wrangler.jsonc` contains local placeholder bindings. Create `.dev.vars` for
your own local credentials and never commit it. Production infrastructure,
resource IDs and deployment secrets are intentionally outside this public
mirror.

The complete repository overview, architecture and SEO matrix are in the
[root README](../README.md).
