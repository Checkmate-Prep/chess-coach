# External services

Every outside service Checkmate Prep depends on: what it is for, where its secret lives and how to rotate it. This page never holds a secret, a login or an account name. Those are in the password manager and in the private plan on Drive (linked from issue #65). Where the repo doesn't say, the entry says **to confirm**.

Secrets live in **GitHub → Settings → Environments** (`dev`, `test`, `production`). Each environment holds its own copy, and the deploy workflow (`.github/workflows/deploy.yml`) reads them from the environment it deploys to. The Worker's own secrets are uploaded by that deploy as Worker secrets, so rotating one means changing the GitHub secret and deploying again (push to `main` for production; **Actions → Deploy to Cloudflare → Run workflow** for the others). Locally, the same values go in `.dev.vars` (gitignored). The values in `wrangler.toml` (Auth0 domain, client id and audience) are public, not secrets.

## At a glance

| Service | Used for | Secret or credential | Where it lives |
| --- | --- | --- | --- |
| Cloudflare | Worker, D1, R2, KV, Workflows, Analytics Engine, DNS, domain, Email Routing | `CLOUDFLARE_API_TOKEN`; `CLOUDFLARE_ACCOUNT_ID` (a variable, not secret) | GitHub Environments `dev`, `test`, `production` |
| Anthropic API | AI game plans (Claude) | `ANTHROPIC_API_KEY` | GitHub Environments, uploaded to the Worker |
| Auth0 | Sign-in, one tenant shared by all environments | `AUTH0_MGMT_CLIENT_SECRET` (Management API); `AUTH0_MGMT_CLIENT_ID` is a variable | GitHub Environments, uploaded to the Worker |
| ntfy.sh | Phone notification on a new sign-up | `NTFY_TOPIC` (the topic name is the secret) | GitHub Environment `production`, then stored in the Auth0 Action |
| Email provider for sign-in codes | Sends the emailed one-time codes | To confirm | To confirm |
| GitHub (Pages, Actions) | Hosts the repo and CI, serves `app/` at the github.io address, runs the deploys | None of its own (uses the environments above) | n/a |
| Google (sign-in, Fonts, Play Console) | Google sign-in through Auth0, fonts, the Android listing | Google OAuth client id and secret (Auth0 connection); upload keystore for Android | Auth0 dashboard; password manager |
| Apple Developer Program | The planned iOS app | App Store signing and API keys, when they exist | To confirm (not set up yet) |
| chess.com public API | Games of the players being prepared | None (public, no key) | n/a |

## Cloudflare

Hosts everything server-side. One Worker per environment (`chess-coach-dev`, `chess-coach-test`, `chess-coach`), defined in `wrangler.toml`.

| Piece | What it is for |
| --- | --- |
| Workers + static assets | Serve `app/` and the `/api` routes (`worker/index.js`) |
| D1 | Synced documents and analysis results per account (`worker/sync.js`, `worker/results.js`), AI job rows |
| R2 | The shared game store, `chess-coach-games-dev`, `-test`, `-prod`; files expire after 180 days (`ops/r2/games-lifecycle.json`) |
| KV (`PREP`) | AI plan cache (30 days), the per-IP daily counter (2 days), the game store's deny-list |
| Workflows | `PrepWorkflow`, so an AI plan finishes even if the app closes (`worker/prep.js`) |
| Analytics Engine | Usage stats, kept 3 months (`worker/events.js`); must be enabled once per account |
| Rate limiting | `BURST`, `AI_BURST`, `GAMES_BURST` bindings |
| DNS and Registrar | checkmateprep.com, including the `login` CNAME for Auth0 (proxy off) |
| Email Routing | Forwards `privacy@checkmateprep.com` and other role addresses to a mailbox; to confirm the full list of addresses |

- **Secrets:** `CLOUDFLARE_API_TOKEN` (secret) and `CLOUDFLARE_ACCOUNT_ID` (variable) in each GitHub Environment. The token comes from the "Edit Cloudflare Workers" template with D1 and R2 edit access, and the zone for checkmateprep.com.
- **Rotate:** create a new API token in the Cloudflare dashboard (**My Profile → API Tokens**), put it in the `CLOUDFLARE_API_TOKEN` secret of each environment, run a deploy to check, then delete the old token. A separate read-only token (Account Analytics: Read) is used by `npm run stats`; it is passed on the command line and not stored in GitHub.
- **Moving accounts:** see "Moving production to the project Cloudflare account" in the README, and issue #62. All environments must stay in the account that holds the checkmateprep.com zone.

## Anthropic API

Writes the AI game plans (`worker/prep.js`, instructions in `worker/prompt.js`). The Worker sends the usernames and statistics from the user's games and nothing else; the privacy page says so.

- **Secret:** `ANTHROPIC_API_KEY`, one key per environment, each from its own workspace in the Anthropic Console with a spend limit. The spend limit is the real cost backstop.
- **Where:** GitHub Environments `dev`, `test`, `production`. The deploy uploads it as a Worker secret. Without it the Worker still deploys and the app hides AI prep.
- **Rotate:** create a new key in the same workspace, replace the GitHub secret in that environment, deploy, check `/api/health` answers `{"ai":true}`, then revoke the old key in the Console.

## Auth0

One tenant (US region) for all environments, with one API and two Single Page Applications ("Checkmate Prep" for production, "Checkmate Prep - non prod" for dev, test and local). Sign-in is at `login.checkmateprep.com`, the tenant's custom domain.

- **Public values:** `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE` in `wrangler.toml`. Not secret.
- **Machine-to-Machine app "Deploy actions":** used by the deploy script (`ops/auth0/deploy-actions.mjs`: the sign-up Action, the login page favicon) and by the Worker to delete a user with their account (`worker/account.js`). Both call the Management API on the tenant domain, not the custom domain.
  - **Secret:** `AUTH0_MGMT_CLIENT_SECRET`; `AUTH0_MGMT_CLIENT_ID` is a variable (a secret of that name also works).
  - **Where:** GitHub Environment `production` (required for the Action deploy); `dev` and `test` only if account deletion should be testable there.
  - **Rotate:** in Auth0, **Applications → Deploy actions → Settings → Rotate** the client secret, update the GitHub secret, deploy (the deploy also uploads it to the Worker). Until the new secret is deployed, account deletion fails with a 502 and the Action deploy step fails.
- **Google connection:** a Google OAuth client id and secret live in the Auth0 dashboard (**Authentication → Social → Google**). Rotating means creating a new secret in Google Cloud and pasting it there. Tracked in issue #60.
- **Sign-up Action:** the code is in the repo (`ops/auth0/notify-signup.js`); the topic is the only secret it holds, set by the deploy script.

## ntfy.sh (sign-up notification)

The Auth0 Action posts "New Checkmate Prep account" to a topic on the public ntfy.sh server the first time someone signs in to production. The message contains the new user's email address and how they signed in, so ntfy.sh is a processor of that address (named on the privacy page).

- **Secret:** `NTFY_TOPIC`, a long random topic name. Anyone who knows it can read the notifications.
- **Where:** GitHub Environment `production`. The deploy script copies it into the Auth0 Action's secrets.
- **Rotate:** make a new topic (`openssl rand -hex 16`), subscribe to it in the ntfy app, update the `NTFY_TOPIC` secret, then redeploy the Action by hand with `--force` (`npm run auth0:deploy -- --force`, with the three Auth0/ntfy variables set; see the README): the script skips an Action whose code hasn't changed, so a plain deploy would not pick up the new topic. Unsubscribe from the old topic.

## Email provider for sign-in codes

Auth0's passwordless login emails a one-time code. The README says Auth0's built-in sender is for testing only and that production should use a dedicated provider (Resend or Amazon SES), sending from an address on checkmateprep.com, with the provider's SPF and DKIM records in Cloudflare DNS.

- **Which provider is in use, and where its API key lives: to confirm.** The repo holds no code or workflow for it, so the key is most likely set in the Auth0 dashboard (**Branding → Email Provider**) rather than in GitHub.
- **Rotate (once confirmed):** create a new key at the provider, paste it in Auth0's Email Provider settings, send a test email from there, then revoke the old key.
- Mail to `privacy@checkmateprep.com` and the other role addresses is separate: Cloudflare Email Routing receives it (see above).

## GitHub

- **Repository and Actions:** CI (`test.yml`), deploys to Cloudflare (`deploy.yml`) and the GitHub Pages deploy (`pages.yml`).
- **GitHub Pages:** serves `app/` at https://checkmate-prep.github.io/chess-coach/ as a static copy with no accounts and no AI prep. It is not the product address; checkmateprep.com is.
- **Secrets:** none of its own. The environment secrets above are the only ones. The Pages deploy uses GitHub's built-in OIDC token (`id-token: write`).
- **Rotate:** nothing to rotate. Review who has access to the repository and the environments when someone joins or leaves (issue #63).

## Google

- **Google Fonts:** the pages load fonts from fonts.googleapis.com. No key. Named on the privacy page.
- **Google sign-in:** see Auth0 above.
- **Google Play Console:** the Android app (`com.checkmateprep.app`), published as a Trusted Web Activity; the account is an organisation account. The upload keystore and its passwords are in a password manager, outside the repo. `worker/assetlinks.js` holds the two public SHA-256 fingerprints (Play app signing key and upload key); they are not secret.
  - **Rotate:** Play lets you request an upload key reset in the Console (**App integrity**). After a reset, add the new fingerprint to `worker/assetlinks.js`, deploy, and keep the old one until the old key is gone.
- Details of the store plan: `docs/app-stores.md`.

## Apple

Apple Developer Program enrolment for the iOS app is in review (see `docs/app-stores.md` and issues #53 to #56). Nothing is deployed yet. When it is, the signing certificates, provisioning profiles and any App Store Connect API key need an entry here: where they live and how to renew. Sign in with Apple will also need a key in Auth0 (issue #55). To confirm until then.

## chess.com public API

`api.chess.com/pub/player/...` gives public games and archives. Called from the browser (`app/chesscom.js`) and from the Worker for the shared game store (`worker/games.js`, with a user agent). No key and no account, so nothing to rotate. A player who asks to be removed goes on the game store's deny-list (`npm run forget-player`).

## Not services

- **Stockfish, chess.js, Auth0 SPA SDK:** vendored in `app/vendor/`. Nothing external at runtime. Licences in `COPYING.txt`.
- **Native Stockfish (pipeline only):** downloaded into `bin/` on a Mac. Not part of the deployed product.

## To confirm

- The email provider for sign-in codes, and where its key lives.
- The full list of role addresses on Cloudflare Email Routing and the mailbox they go to.
- The Apple items above, once the enrolment is accepted.
- Who else holds access to each service (issue #63).
