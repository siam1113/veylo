# ClearHead

ClearHead is a private intention space: capture a thought quickly, shape it over time, connect it to a purpose, and choose when to make room for it. The production architecture supports responsive web, native iOS and Android, offline capture, cloud sync, AI-assisted interpretation, and user-approved calendar actions.

## Stack

- Web: React Router Framework Mode, React, TypeScript, installable PWA.
- Mobile: Expo Router, React Native, TypeScript, SQLCipher-encrypted SQLite local store with per-account keys in SecureStore.
- API: Fastify, TypeScript, Supabase Auth JWT verification.
- Data: Supabase PostgreSQL, Drizzle schema, checked-in SQL migrations.
- Jobs: BullMQ and Redis-compatible queue for opt-in AI interpretation and opt-in web/mobile snooze reminders.
- Integrations: server-side Google Calendar OAuth with encrypted tokens and approved event writes; Jira Cloud OAuth 2.0 with read-only assigned-issue import; Notion OAuth with user-selected read-only page references.
- Hosting: Render for web, API, and worker; Expo Application Services for iOS and Android builds.

Architecture decisions and integration boundaries are documented in [ADR 0001](docs/adr/0001-production-stack.md) and [the architecture guide](docs/architecture.md).

V1 implementation status and the remaining release gates are tracked in the [acceptance trace](docs/v1-acceptance.md); operational setup and deployment steps are in the [runbook](docs/runbook.md).

## Local setup

Requires Node.js 22.13 or later and npm. Create a Supabase project and Redis-compatible queue, then copy the environment templates:

```sh
cp .env.example .env
cp apps/web/.env.example apps/web/.env
cp apps/mobile/.env.example apps/mobile/.env
npm ci
```

Fill in the API and worker settings in the root `.env`, and the public Supabase/API values in `apps/web/.env` and `apps/mobile/.env`. Get `DATABASE_URL` from your Supabase project’s **Connect** dialog; replace the password placeholder with your database password. If the direct connection is unreachable on your network, select the Session pooler connection. Keep this database URL server-side. Then apply the initial database migration:

```sh
npm run db:migrate
```

Start the API and web app in separate terminals:

```sh
npm run dev:api
npm run dev:web
```

Open `http://localhost:5173`. Start the worker in another terminal when Redis is configured. Add an OpenAI API key to enable AI interpretation and opt-in intention brainstorming:

```sh
npm run dev:worker
```

Install an EAS development build before using the native app. The SQLCipher database and speech-recognition module require native code and do not run in Expo Go. For a physical phone, set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to a hostname the phone can reach. Then run:

```sh
npm run dev:mobile
```

The email provider for Supabase Auth must be enabled. Add `http://localhost:5173/auth/callback` to its allowed redirect URLs. Configure the email template to include Supabase’s one-time token (`{{ .Token }}`); sign-in uses a browser email link on web and an entered one-time code on mobile.

The former static prototype is preserved in [prototype-archive](prototype-archive). Run the active app through the workspace scripts above.

## Google Calendar setup

1. Enable the Google Calendar API and configure the OAuth consent screen.
2. Create a Google OAuth web client. Set its redirect URI to `http://localhost:4100/v1/integrations/google/callback` for local development. Add the deployed API callback URI for production.
3. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `OAUTH_STATE_SECRET`, `TOKEN_ENCRYPTION_KEY`, and `MOBILE_REDIRECT_URI` to the API environment. Generate the secrets with `openssl rand -hex 32`. The API derives its AES-256 key from the token-encryption secret, so deployment platforms can supply their own generated secret value.
4. Connect from ClearHead’s **Connections** view. ClearHead requests Google’s `calendar.freebusy` and `calendar.events.owned` scopes: the first reads availability, and the second allows event creation on calendars the user owns. The API saves the connection only when both scopes are granted, stores tokens encrypted, and creates an event only after the user approves a saved time block. See [Google’s Calendar scope reference](https://developers.google.com/workspace/calendar/api/auth) for the current permission descriptions.

Provider callbacks return through the API, which forwards the temporary authorization code to the web or mobile client in a URL fragment. Finish the flow in the same signed-in ClearHead account that started it; the API will reject completion from a different account.

Never put the Supabase secret key, OAuth client secret, OpenAI API key, Expo push access token, VAPID private key, push-subscription encryption key, or token-encryption key in `VITE_*` or `EXPO_PUBLIC_*` variables. ClearHead uses the Supabase secret key only for explicit account deletion. The API still accepts the legacy `SUPABASE_SERVICE_ROLE_KEY` during migration; [Supabase is deprecating its legacy API keys by the end of 2026](https://supabase.com/docs/guides/getting-started/api-keys), so new deployments should use `SUPABASE_SECRET_KEY`.

## Jira Cloud setup

Create an Atlassian OAuth 2.0 (3LO) app using [Atlassian’s OAuth guide](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/), enable the Jira API with `read:jira-work`, and add `JIRA_CLIENT_ID`, `JIRA_CLIENT_SECRET`, and the API callback URL as its callback. Use `http://localhost:4100/v1/integrations/jira/callback` locally and the deployed callback in production. ClearHead stores rotating tokens encrypted on the API, selects the first Jira site returned by Atlassian, and reads assigned issues only when the user refreshes the Connections view. Disconnecting clears ClearHead’s token copy; users can revoke the grant in their Atlassian account settings. Jira issue data remains owned by Jira and is not copied into intentions.

## Notion setup

Create a public Notion connection using [Notion’s OAuth guide](https://developers.notion.com/guides/get-started/authorization) and configure its OAuth redirect URI as `http://localhost:4100/v1/integrations/notion/callback` locally and the deployed API callback in production. Set `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, and `NOTION_REDIRECT_URI` in the API environment. The authorization picker lets each user choose which pages and databases to share; ClearHead lists page or database titles, links, and edit dates on demand using the [Notion search endpoint](https://developers.notion.com/reference/post-search), 100 references per page with cursor-based **Load more**, and does not copy their contents. Requests pin `Notion-Version` to `2026-03-11`; review the search response contract before upgrading that version. OAuth access and rotating refresh tokens are encrypted server-side. Disconnect clears ClearHead’s token copy; users can remove the public connection from their Notion settings as well.

## Data and sync behavior

Every capture is saved to the client’s durable local store first. Web confirms a capture after its account-scoped IndexedDB transaction; localStorage is a best-effort startup cache. Mobile commits intentions, time blocks, and sync queues to SQLCipher-encrypted SQLite using a key protected by the iOS Keychain or Android Keystore through SecureStore. The store migrates an existing plaintext ClearHead database before removing it. Android device backup is disabled; unsynced captures remain on the device until they sync or are exported. When signed in and online, clients send idempotent snapshots to the API. The API scopes each query to the verified Supabase user and uses version checks to catch simultaneous edits. If an offline edit conflicts with a newer server version, web preserves the edit as an “offline copy” and keeps the newer server version too.

The original capture text is retained exactly as entered or transcribed, up to 8,000 characters. Web dictation appends to typed text, and voice capture explains when it reaches the limit. Shared validation and a Postgres check reject blank-only or oversized input without trimming saved text. Shared-domain tests cover capture validation, exact-range free/busy cache matching, free-slot selection, IANA timezone validation, suggestion ranking/feedback limits, and UTF-8-aware sync batching using Node’s built-in test runner: `npm run test -w @clearhead/domain`.

Thoughts stored by the earlier static prototype stay under their original browser key until a signed-in user chooses **Import into this account**. Import gives each thought and planned time a new account-scoped ID and removes the unscoped copy only after the local account save succeeds. Old Google Calendar event links are not transferred; those events remain in Google and can be reviewed separately.

Raw capture text is retained when AI suggests a title, kind, or explicit horizon. The worker checks each structured interpretation against a shared runtime schema before saving it. AI suggestions include a rationale and can be undone while the suggestion remains unchanged; an undo restores the prior title, type, and horizon and records the action. If Redis or the AI provider is unavailable, capture and manual editing still work. Google, Jira, and Notion content belongs to its source system; ClearHead’s local intention is not silently written back to those providers.

Account exports combine server records with a device-cache section for local edits and outboxes. If the server cannot be reached, the app can export that device’s cache and labels the file `device-only` so the user knows it does not include server-only history.

## Build and release

GitHub Actions installs from the committed root lockfile with `npm ci`, then runs workspace typechecks, shared-domain behavior tests, API and worker suites, focused AI/Google Calendar/Jira contracts, a fresh PostgreSQL migration/ownership check, API and browser integration flows, and production builds on pushes and pull requests through `.github/workflows/verify.yml`.

```sh
npm run build
npm run typecheck
npm run test -w @clearhead/domain
npm run test -w @clearhead/api
npm run test -w @clearhead/worker
npm run test:contracts
npm run test:db -w @clearhead/db # point DATABASE_URL at a disposable Postgres database; set CLEARHEAD_DB_TESTS=1
```

Render service configuration is in `render.yaml`. The web app is published as a static React Router SPA from `apps/web/build/client`, with a route rewrite for direct navigation to app paths; the API and worker run as Node services. Fill the prompted external service credentials before deploying. Native application signing and store submission use the EAS profiles in `apps/mobile/eas.json`; Apple and Google developer accounts and signing credentials are required for store releases.

`npm run build -w @clearhead/mobile` creates Expo platform bundles; it does not produce signed store binaries. Use EAS with the development, preview, or production profile to build installable iOS and Android packages. Set `EXPO_PUBLIC_EAS_PROJECT_ID` in `apps/mobile/.env`, link the EAS project, and configure Apple/FCM credentials for remote notifications. The EAS development profile uses the configured `expo-dev-client` launcher; mobile speech recognition and push notifications also use native modules in `apps/mobile/app.json`, so use an EAS development build instead of Expo Go. ClearHead stores the transcript; the operating-system speech provider may process the audio. Windows is currently delivered as an installable web app through Edge.

Windows users can install the web app from Edge as a PWA. A packaged Windows desktop executable is not part of the current release target.

## Current implementation note

The web experience renders Space, Explore, Align, Time, Suggestions, and Connections as React Router UI, using the original ClearHead palette and layout. First sign-in shows a privacy overview once per account on each browser. Time includes day, week, month, and year views; Google free/busy can be refreshed for the visible day or week; ClearHead can suggest a 15-minute-aligned opening between 9am and 5pm using that data and existing blocks, then asks the user to confirm before saving. Web motion respects operating-system and account reduced-motion settings, and the theme increases contrast when the operating system requests it. Intention detail includes opt-in contextual brainstorming using the saved conversation, while leaving the thought unchanged until the user edits it. The Align view supports owner-scoped links between synced intentions, and suggestions are ranked with the shared explainable heuristic; accept, dismiss, and snooze feedback syncs across devices with an offline outbox. The TypeScript sync client provides user-scoped IndexedDB outbox storage for intentions, time blocks, preferences, relationships, and suggestion feedback, with cross-device merge and offline conflict copies. Its service worker caches the app shell and static assets while leaving API and auth callback responses uncached.

The native app currently supports email-code auth, local-first text and voice capture, a per-account privacy overview on first sign-in, Space/Explore/Align/Time/Suggestions/Connections perspectives, edits, cross-device sync, cached synced relationships, an offline-capable ranked suggestion tray, status changes, planned time blocks with day/week/month/year navigation, Google free/busy refresh for the visible day or week, suggested openings that are reviewed before saving, and separately approved event creation, Jira Cloud connection and read-only assigned-issue refresh, Notion connection and read-only selected-page/database references, AI interpretation and per-intention brainstorming preferences, reduced motion, opt-in snooze reminders, quiet hours, data export, sign-out, and account deletion. Native controls now expose screen-reader roles and labels, but VoiceOver/TalkBack QA remains a release check. Relationship edits are written to the local outbox and replayed after their intentions sync; the mobile app retries pending work while active and on resume. Web and native snooze reminders use opt-in push registrations and generic reminder text. Quiet hours can defer reminders until 8am in the account’s selected local timezone. Web push needs VAPID keys and the shared subscription-encryption key described in the runbook; native push needs an EAS project ID and Apple/FCM credentials. Reminders require Redis and a running worker and are checked against the current snooze state and account preference before sending. Scheduled daily digests remain unimplemented. Google, Jira, and Notion OAuth, AI interpretation, hosted services, and native store builds require external credentials. A clean Node.js 22 Linux container passed the workspace typecheck and production build, including iOS and Android bundles, plus the PostgreSQL migration and API integration checks and the browser online/offline capture flow. This is not a deployed production service: real Supabase/provider credentials, hosted release setup, device QA, and the remaining release gates are documented in the runbook.

See [the operations runbook](docs/runbook.md) for environment setup, deployment steps, and current integration coverage.
