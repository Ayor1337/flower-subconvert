# Repository Guidelines

## Project Structure & Module Organization

The React/Vite interface lives in `src/` (`App.jsx`, `Flag.jsx`, and `styles.css`). Cloudflare Worker code is isolated under `src/worker/`; `worker.js` is the stable deployment entry and should remain a thin re-export. Subscription parsing, protocol serialization, authentication, upstream requests, and response handling each have focused modules. `test-worker.mjs` exercises the Worker end to end, with sanitized input in `test/fixtures/`. Policy source is stored in `clash-policy.yaml`; `build-worker.mjs` generates `src/worker/config.generated.js`. Research notes belong in `doc/`.

## Build, Test, and Development Commands

- `npm install` installs the Node.js 20.19+ dependencies.
- `npm run dev` starts Vite on port 5173.
- `npm run test:worker` runs the fast Worker integration suite.
- `npm test` runs Worker tests, regenerates policy configuration, and performs a production Vite build.
- `npm run deploy` deploys the Worker and static assets through Wrangler.

Run `npm test` before submitting any change that affects subscriptions, policy generation, or deployment behavior.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, double-quoted strings, semicolons, and trailing commas in multiline structures. Prefer small, single-purpose modules and named exports for reusable helpers. Use `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for generated/configuration constants, and descriptive kebab-case documentation filenames. No formatter or linter is configured; match nearby code and run `git diff --check` before committing.

## Testing Guidelines

Tests use `node:assert/strict` rather than a separate framework. Add regression coverage to `test-worker.mjs` and keep fixtures synthetic—never copy production credentials. For subscription formats, decode the response and assert raw URI fields, percent encoding, skip counts, headers, and status codes. Preserve coverage for default Clash behavior when changing another target.

## Commit & Pull Request Guidelines

Use Conventional Commits, for example `fix(subscription): 修复节点参数编码`. Nontrivial commits should include `- ` body bullets describing behavior and motivation. Pull requests should summarize user-visible changes, list verification commands, link related issues, and include screenshots for UI changes or redacted decoded examples for subscription changes.

## Security & Configuration Tips

Keep passwords, UUIDs, short tokens, Cloudflare credentials, and real upstream snapshots out of Git. Local secrets belong in Wrangler-managed configuration or ignored `*.local` files. Treat generated subscription output and diagnostic logs as sensitive, and redact them before sharing.
