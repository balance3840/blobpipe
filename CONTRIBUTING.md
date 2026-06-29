# Contributing to blobpipe

## Prerequisites

- Node.js >= 18.17
- pnpm >= 9 (`npm install -g pnpm`)
- Docker (for emulator tests only)

## Local setup

```bash
git clone https://github.com/your-org/blobpipe
cd blobpipe
pnpm install
```

## Project layout

```
packages/
  core/          # StorageDriver interface, StorageClient, middleware types, errors
  s3/            # S3Driver
  gcs/           # GcsDriver
  azure-blob/    # AzureBlobDriver
  local/         # LocalDriver
  memory/        # MemoryDriver (no-network, for tests)
tests/
  unit/          # Pure unit tests, no I/O
  integration/   # Tests against real cloud (skipped without credentials)
  emulator/      # Tests against local emulators via Docker
  helpers/       # Shared driver contract suite
```

## Running tests

```bash
# Unit + integration (integration tests skip automatically without credentials)
pnpm test

# Watch mode
pnpm test --watch

# Emulator tests (requires Docker)
docker compose -f docker-compose.emulators.yml up -d
pnpm test:emulators
docker compose -f docker-compose.emulators.yml down
```

## Emulators

| Provider | Emulator | Port |
|---|---|---|
| S3 | Localstack | 4566 |
| Azure Blob | Azurite | 10000 |
| GCS | fake-gcs-server | 4443 |

## Type checking

```bash
pnpm typecheck
```

## Building

```bash
pnpm build   # tsup — emits dist/ in each package with ESM + CJS + .d.ts
```

## Adding a new driver

1. Create `packages/<name>/` and copy the structure from `packages/memory/`.
2. Implement `StorageDriver` from `@restrella/blobpipe`.
3. Wire it as a subpath export in the root `package.json` (`"blobpipe/<name>": ...`).
4. Add the contract test: `testDriverContract('<name>', () => new YourDriver(…))`.
5. If the provider has an emulator, add `tests/emulator/<name>.test.ts`.

## Changesets

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning.

Before opening a PR with a user-facing change:

```bash
pnpm changeset          # follow the interactive prompt
```

Choose the affected packages and bump type:
- `patch` — bug fix, no API change
- `minor` — new feature, backwards-compatible
- `major` — breaking change

The CI release workflow automatically publishes when a changeset PR is merged to `main`.

## Middleware guidelines

- Middleware runs **only on `put()`**. Read/stat/delete/list operations bypass the pipeline.
- Always call `await next()` unless the middleware intentionally short-circuits.
- Throw `MiddlewareRejectionError` for deliberate rejections (wrong type, file too large). Use `StorageError` subclasses only for storage-layer errors.
- Never mutate `ctx.options` in place — spread into a new object: `ctx.options = { ...ctx.options, contentType: detected }`.

## Code style

- TypeScript strict mode with `exactOptionalPropertyTypes: true`. Use `...(value !== undefined && { key: value })` spreads rather than assigning `undefined` to optional properties.
- No default exports.
- ESM-only source; tsup produces both ESM and CJS dist outputs.
- Comments only when the *why* is non-obvious. No `// what this does` comments.
