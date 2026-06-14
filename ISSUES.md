# Issues

Current reviewed baseline: `main` / `origin/main` at `2cd8ecb`.

## 1. High: Profile-key maintenance jobs are queued as scoped but execute globally

`WebServer` derives a profile scope for `/api/cleanup`, `/api/deduplicate`, and `/api/tags/normalize`, but the cleanup and dedup handlers do not apply that scope to the underlying storage operations.

Evidence:

- `src/services/web-server.ts` derives scoped jobs with `deriveJobScope(principal)`.
- `src/services/api-handlers.ts` `handleCleanup()` calls unscoped `promptRepo.deleteOldPrompts()` and `memoryRepo.listOlderThan()`.
- `src/services/api-handlers.ts` `handleDeduplicate()` calls unscoped `memoryRepo.getAllWithVectors()`.
- `src/services/storage/postgres/memory-repository.ts` implements those methods globally.

Risk:

A profile-scoped API key can trigger cleanup or deduplication that mutates records belonging to other profiles.

Expected fix:

Thread `JobScope` into cleanup/dedup repository queries and deletes, or filter records by profile before mutation. Add behavioral tests proving profile-key jobs only affect that profile.

## 2. High: Docker quickstart fails with default `EXTERNAL_HOST=localhost`

`docker-compose.yml` and `docker-compose.external-db.yml` use `${EXTERNAL_HOST:-localhost}` in port mappings, and `.env.example` sets `EXTERNAL_HOST=localhost`.

Evidence:

`docker compose --env-file .env.example config` fails with `invalid IP address: localhost`. The same command passes with `EXTERNAL_HOST=127.0.0.1`.

Risk:

The documented quickstart can fail before the server starts.

Expected fix:

Use `127.0.0.1` as the default/example host bind value, or omit the host IP from the port mapping and document the exposure tradeoff. Apply the fix to both Compose files and README/.env docs.

## 3. Medium: `DISABLE_CLIENT_AUTH=true` docs conflict with plugin config requirements

README says `apiKey` is required unless client auth is disabled, but the plugin still noops unless `apiKey` is configured.

Evidence:

- `shared/client-config.ts` `isClientConfigured()` requires both `serverUrl` and `apiKey`.
- `plugin/src/plugin.ts` returns a noop plugin when `isClientConfigured()` is false.

Risk:

Users who disable client auth server-side still cannot run the plugin without configuring an API key.

Expected fix:

Either add an explicit unauthenticated client mode so the plugin can omit `Authorization`, or change README/config docs to state that a dummy `apiKey` is still required by the plugin even when server-side client auth is disabled.

## 4. Medium: Docker profile-key docs point to an unmounted `/run/secrets` file

README shows `PROFILE_KEYS_FILE=/run/secrets/opencode-memnet-profile-keys.jsonc`, but Compose only passes the env var. It does not mount that file.

Evidence:

- `README.md` documents `/run/secrets/opencode-memnet-profile-keys.jsonc`.
- `docker-compose.yml` only forwards `PROFILE_KEYS_FILE`.
- `src/services/profile-auth.ts` throws if `PROFILE_KEYS_FILE` points to a missing file.

Risk:

Following the documented Docker profile-key setup causes startup failure.

Expected fix:

Add a Compose `secrets:` entry or read-only bind-mount example, and align README/.env.example with the mounted path.
