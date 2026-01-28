# Zap

Zap is a Twitch clip automation tool: a Fastify-powered dashboard for managing connected channels and a bot worker that lets moderators generate clips directly from chat.

## Features
- Twitch OAuth onboarding plus persistent channel/token storage
- Fastify dashboard (health, channel detail, clip log, test clip button)
- Worker bot using `tmi.js` that listens for `!clip` from mods/broadcaster
- Shared clip creation service with Helix, polling, cooldowns, and error logging
- Prisma for SQLite (local) with optional Postgres via Docker Compose

## Getting started
1. **Prepare Twitch credentials**
   - Register a Twitch app and copy the Client ID and Secret.
   - Set the redirect URI (default `http://localhost:3000/auth/twitch/callback`).
   - Ensure the bot account has `clips:edit` + `user:read:email` scopes for OAuth.
2. **Bootstrap the repo**
   ```bash
   pnpm install
   cp .env.example .env # fill values
   pnpm db:migrate     # apply Prisma schema
   ```
3. **Run the dashboard**
   ```bash
   pnpm dev:web
   ```
   - Visit `http://localhost:3000`, connect a channel, authorize Twitch, and verify channel info.
4. **Start the bot worker**
   ```bash
   pnpm dev:bot
   ```
   - The worker joins every channel in the database and responds to `!clip` per cooldown.

## Environment
| Variable | Notes |
| --- | --- |
| `TWITCH_CLIENT_ID` | Twitch app client ID |
| `TWITCH_CLIENT_SECRET` | Twitch app secret |
| `TWITCH_REDIRECT_URI` | Callback URI (default above) |
| `WEB_PORT` | Port for Fastify dashboard (default 3000) |
| `SESSION_SECRET` | Random secret for session cookies |
| `BOT_USERNAME` | Lower-case login of your Twitch bot |
| `BOT_OAUTH_TOKEN` | Full IRC token (`oauth:...`) |
| `BOT_CHANNELS` | Comma separated list of login names (fallback to DB) |
| `DATABASE_URL` | Prisma database URL (`file:./dev.db` for SQLite) |

## Authentication and sessions
- The dashboard stores only one broadcaster at a time using the streamer's Twitch OAuth and a secure session cookie. `SESSION_SECRET` is hashed to 32 bytes for signing, so generate a long random string (for example, `openssl rand -hex 32`) before you deploy. When a streamer signs in via `/auth/twitch`, the session value is set and the page renders that streamer’s clips. Hit `/logout` or the “Log out” button in the header to clear the current session and authenticate with a different Twitch account.
- Since the focus is on one channel per session, the welcome screen is now the landing spot for new or logged-out visitors, and the clip timeline stays read-only (clips can only be requested from Twitch chat with `!clip`).

## Database
- Prisma schema lives in `prisma/`.
- Run `pnpm db:migrate` after env setup to create SQLite or Postgres schema.
- Docker Compose (optional Postgres) is available at `docker-compose.yml`.

## Production deployment
1. Set the environment variables above (`TWITCH_CLIENT_ID`, `BOT_*`, `SESSION_SECRET`, etc.) and make sure `NODE_ENV=production` when you ship the server.
2. Run `pnpm --filter web build` (or `pnpm build` at the root) so the Fastify dashboard is compiled to `apps/web/dist`.
3. Start the service with `NODE_ENV=production pnpm --filter web start` (or wrap it in your process manager). The secure session cookie requires HTTPS, and the server marks cookies as `Secure` automatically when `NODE_ENV=production`.
4. Reverse proxy the dashboard behind HTTPS (nginx, Caddy, Cloudflare, etc.) and point your Twitch panel or overlay to that URL.
5. Connect the bot account (e.g., `theofficalzapbot` or whichever login hosts clips) via `.env`, launch `pnpm dev:bot`, and invite mods to ask for clips with `!clip`. Each streamer that visits the dashboard can sign in, see their own timeline, and sign out when they want to view another channel’s history.

## Troubleshooting
- **Token scopes**: If clip creation fails, ensure the OAuth scope `clips:edit` is granted when connecting the channel.
- **Bot auth**: `BOT_OAUTH_TOKEN` must include the `oauth:` prefix and come from https://twitchapps.com/tmi/ or `twitch token generator`.
- **Cooldown**: Clips are rate limited per channel (default 30s) to avoid Twitch rate limits.
