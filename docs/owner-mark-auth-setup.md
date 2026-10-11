# KEIBA LABO — owner mark-save authentication release checklist

Status: **not live unless both service configurations and a real authenticated D1 write/readback have been verified**.

This is an operator runbook. Never commit passwords, write tokens, API tokens, GitHub secret values, or browser cookies. Do not paste any of them into a chat, pull request or build log. Use a password manager and each provider's secret-entry form.

## Current known blocker

The Vercel connector returned **HTTP 403** on a request to create the production secret for `sekainobancyou-8945/keiba-lab-apl`: the connector is not authorized to write environment variables under that scope. The Git integration and production deployment can still succeed; that **does not** prove the environment-variable permissions are granted. Reconnect/re-authorize the Vercel integration for the owning team/scope, or enter values in the Vercel dashboard directly. Do not silently fall back to a different project or account.

## Step 1 — GitHub deploy credentials (API repository)

In **flare225/keiba-lab-api → Settings → Secrets and variables → Actions**, add repository secrets:

| Key | Value | Why |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Privileged Cloudflare API token with only the Workers deployment scopes needed for this account | Permits GitHub Actions to publish the Worker |
| `CLOUDFLARE_ACCOUNT_ID` | The account ID that owns the existing Worker and D1 database | Selects the correct Cloudflare account |

Do not put these in Vercel or client JavaScript. The existing `.github/workflows/publish-worker.yml` **fails visibly** if either is missing; it must not be considered deployed simply because source or Node tests passed.

Before publishing, review that `wrangler.jsonc` targets the existing Worker `keiba-lab-api` and D1 binding `DB`. Avoid creating a new database. Release and check that the live Worker version is actually the intended one; running tests on a branch does not deploy it.

## Step 2 — Shared Worker write token

Generate one cryptographically random token with at least 32 bytes of entropy in a private password manager. Store the *same exact value* in both server providers:

- Cloudflare Worker `keiba-lab-api` production secret: `USER_MARK_WRITE_TOKEN` (via the Worker settings secret editor or private `wrangler secret put USER_MARK_WRITE_TOKEN`).
- Vercel `keiba-lab-apl` production sensitive/encrypted environment variable: `LABO_MARK_DB_WRITE_TOKEN`.

Do not print the value in a CI step. Do not expose it under a `NEXT_PUBLIC_*` name. A GitHub deploy token and this mark-writing bearer token serve **different purposes** and must not be reused.

The Worker GET `/v1/lab/user-mark-capabilities` can say `writeReady: true` when its token is configured; this **does not** establish that the Vercel token matches it.

## Step 3 — Vercel-only owner login configuration

In `sekainobancyou-8945/keiba-lab-apl` → **Settings → Environment Variables**, add sensitive production-only values:

| Variable | Requirements | Owner access |
|---|---|---|
| `LABO_MARK_OWNER_PASSPHRASE` | Secret owner phrase >= 24 characters. Choose and keep it privately. | Required to log in from the LABO UI |
| `LABO_MARK_SESSION_SECRET` | Distinct cryptographically random >= 32 characters. Do **not** reuse owner passphrase or token. | Never entered in the browser |
| `LABO_MARK_DB_WRITE_TOKEN` | Exactly the same as Worker `USER_MARK_WRITE_TOKEN`; >= 24 characters | Never entered in the browser |

**All 3 are required** for `/v1/lab/user-mark-session` to return `configured: true`; one or two alone do not enable saving. Environment changes must be included in a fresh production deployment. Store the password in your password manager before saving it; ChatGPT cannot reconstruct it later.

## Step 4 — Readiness checks (do not touch D1)

Run GitHub Actions **Verify owner mark-save auth readiness (no DB reads)** at:

https://github.com/flare225/keiba-lab-api/actions/workflows/owner-mark-auth-readiness.yml

The job performs exactly two unauthenticated GET requests:

- `https://keiba-lab-apl.vercel.app/v1/lab/user-mark-session`: must return `ok: true`, `configured: true`, `authenticated: false`.
- `https://keiba-lab-api.sekai-no-bancyou.workers.dev/v1/lab/user-mark-capabilities`: must return `ok: true`, `writeReady: true`.

A failed check prints the **missing setting category**, not any actual secret. The check does **not** verify token parity or a D1 write.

## Step 5 — Authorized real save/readback (only after steps 1–4)

1. Open the production LABO on `https://keiba-lab-apl.vercel.app/`, in a browser with official roster data verified for the selected race.
2. Log in using only your private **owner passphrase**, not the Cloudflare API token or server-to-server write token.
3. Choose an appropriate test race and phase **with full understanding of the existing race records and timestamps**. Do not pretend a post-race entry was made before the start. Saving is a real immutable revision, not a throwaway test.
4. Use **DBへ保存**, then confirm `db-written-readback-verified` and the same race/phase, horse names, numbers, marks, track condition and revision ID via the readback.
5. Reload the page and use **DB保存状態を確認**, then **DB保存済み印を復元**; verify exact match with the original revision.
6. Only when the real write and reload-readback succeed call formal mark persistence operational. `preRaceLock` and automatic training remain distinct.

Do not enable anonymous writes or embed secrets into the client as a workaround. Cloudflare free-tier D1 daily read limits can block successful checks even with correct credentials; do not retry in a tight loop.

**Operator ownership**: Connecting the target Vercel team scope and entering protected credentials in Cloudflare/GitHub/Vercel requires provider-authorized account access. The assistant can ship source and check read-only health, but cannot grant itself access.
