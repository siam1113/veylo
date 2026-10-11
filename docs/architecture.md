# Application architecture

## Runtime shape

```text
React Router PWA ─┐
                  ├─ bearer session → Fastify API → Drizzle → Supabase PostgreSQL
Expo mobile ──────┘                         │
                                             ├─ BullMQ / Redis → background worker → OpenAI / Expo Push
                                             └─ provider adapters → Google Calendar / Jira Cloud / Notion
```

The web and mobile clients share the intention vocabulary and API contracts. Each client owns its local persistence implementation. Browser storage keys and mobile SQLite databases are scoped by the authenticated Supabase user ID. A token refresh keeps the active workspace mounted; an account change clears visible account state before the new user’s local store loads. Data left under the static prototype’s unscoped browser key stays separate until the signed-in user explicitly imports it into their account. The API is the only component allowed to write provider tokens or call third-party APIs with a user’s credentials.

Web capture confirms the account-scoped localStorage write before updating the visible list or clearing the capture field. If browser storage rejects the write, the draft remains in the field for retry. The IndexedDB outbox is written asynchronously for offline replay; if that write fails, the next client startup can recover the latest snapshot from the localStorage copy.

Web and mobile API requests have a 30-second timeout that covers response-body parsing as well as connection setup. A caller-provided abort signal can cancel a request without disabling this deadline. Sync failures leave durable local outboxes intact for retry; interactive actions surface the timeout so the user can retry.

The installable web client caches its application shell for offline navigation. Content-hashed build assets use cache-first delivery; mutable public assets such as the design CSS use network-first delivery with the last cached response as the offline fallback, so a deployment updates installed PWAs without requiring users to clear their cache.

The API bounds Supabase Auth user-token validation to 20 seconds. If Auth is unreachable or slow, the API denies the request instead of waiting indefinitely; no request is authorized from an unverified token.

Account exports include the server’s account records plus a device-cache section containing unsynced local intentions and outbox state. If the API cannot be reached, web and mobile can still export their local cache, labeled `device-only`; the UI tells the user to reconnect for server-only history. Provider tokens and push credentials are excluded from both export sources.

Intention revision history is stored separately as append-only metadata. A PostgreSQL trigger records the action, intention version, timestamp, and changed field names whenever a persisted intention version advances, regardless of whether the change came from sync, an API edit, or background AI work. It does not copy prior field values. The API filters each read by the authenticated owner, the history is included in account export, and deletion clears earlier entries before writing a redacted marker.

The web and mobile Supabase clients also bound their Auth requests to 20 seconds, so sending an email link, exchanging its callback code, or entering a one-time code returns control to the sign-in screen when Auth is unreachable.

Fastify exposes Prometheus text metrics at `/metrics`, protected by the server-only `METRICS_TOKEN` request header. Metrics use route templates rather than raw URLs and include request counts, response-time buckets, process uptime, and memory. The worker emits structured completion/failure events and one-minute BullMQ queue-depth snapshots to service logs; job identifiers and intention content are excluded.

Authenticated web and mobile render boundaries can report a technical error category and SHA-256 fingerprint to `/v1/telemetry/client-errors`. The API schema rejects arbitrary fields and logs no message, stack, route, or intention data. The first-run privacy overview discloses this report. Reports are available in service logs; a hosted client-error dashboard and alerting rule still require operator configuration.

On first authenticated use, each client presents a short privacy overview and records completion in account-scoped local storage (browser localStorage for web; SQLite metadata on mobile). It explains local-first capture, optional AI and provider connections, user-approved calendar writes, and export/deletion controls. This local marker does not affect account sync or data retention.

Web and mobile Time perspectives support day, week, month, and year views. Calendar free/busy is fetched on request for the selected day or week; results are shown only for the exact range that was checked and cleared when the account changes or the user disconnects Google. When fresh availability is loaded, both clients can suggest the first 15-minute-aligned opening between 9am and 5pm local time, accounting for saved Veylo blocks and Google busy windows. The suggested time is only placed in the editor; the user confirms it before saving, and separately approves any Calendar event write. Month and year remain overviews. Web motion honors both `prefers-reduced-motion` and the account preference; native motion honors the operating-system setting and the account preference. Web dialogs have accessible names, keep keyboard focus inside while open, close with Escape, and restore focus when dismissed; intention detail fields connect each visible label to its text area.

## Core records

- **Intention:** the user-owned thought, retaining exact `rawCapture` alongside editable interpretation and lifecycle status.
- **Time block:** one planned session for an intention. Scheduling never changes the intention’s ownership or source.
- **Relationship:** a directed relation between two intentions, such as `supports`, `related`, or `depends_on`.
- **Integration:** one provider connection per account, including encrypted tokens, approved scopes, and last sync time.
- **Suggestion:** a reversible prompt with its rationale and user feedback state.
- **User preferences:** account-scoped motion, suggestion, AI, and quiet-hour controls. Web changes are stored locally first and replayed from the IndexedDB outbox when connectivity returns.
- **Client ID:** stable UUID created on a device and used for idempotent replay after offline saves.

Time-block, calendar-availability, and quiet-hour timezone values are validated with the server runtime’s `Intl.DateTimeFormat` timezone database before use. This rejects unknown zones before they reach Google Calendar or reminder scheduling.

Capture validation rejects whitespace-only input and preserves nonblank text exactly, up to 8,000 characters. Migration `0010_reject_blank_captures.sql` adds the nonblank invariant at the database boundary, and migration `0013_expand_raw_capture_limit.sql` updates the matching database length check. This keeps long dictation intact while still bounding payload size.

Account deletion in the web client pauses new local edits and requests, waits for startup, any in-flight API requests, an active sync, and queued local writes to finish, asks the API to delete the Supabase user (which cascades owned rows), then removes that account’s browser outboxes and local cache. The native client pauses new writes and sync attempts, waits for queued preference writes, preference sync, incremental pulls, and any direct capture save to settle before asking the API to delete the user. After server deletion it stops new local access, waits for the pull queue, and uses per-user SQLite read/write barriers to drain operations that were already underway. It then securely clears the tables, checkpoints the WAL, closes and deletes that account’s SQLite database file, and signs out locally. If local file deletion fails, the UI reports that device cleanup remains incomplete; if server deletion fails, local account data stays available so sync can resume.

The shared domain package ranks suggestion candidates with the initial V1 heuristic: 0.30 purpose alignment, 0.25 timeframe fit, 0.20 urgency, 0.15 recent attention, and 0.10 feasibility. It suppresses scores below 0.60 and explains the strongest user-authored signal. The score is a starting rule, not a validated prediction; it does not claim calendar availability or schedule anything.

## Save and synchronization path

1. Web capture waits for the account-scoped IndexedDB snapshot transaction before confirming the save; localStorage is a best-effort startup cache. Other web edits update the visible state and best-effort cache immediately while serializing durable IndexedDB writes before scheduling a network flush. Startup merges the latest committed IndexedDB state again inside its serialized first write, so a capture made while IndexedDB is opening cannot be replaced by an older initialization snapshot. A flush waits for pending snapshot writes and preserves edits made while a request is in flight. Mobile commits captures and sync queues to account-scoped SQLCipher-encrypted SQLite before attempting a network request. Its random per-account database key is stored in SecureStore; startup migrates a pre-SQLCipher Veylo database into the encrypted database and verifies every copied row in the migration transaction before removing the old file; any mismatch rolls back the copy and retains the plaintext source for recovery. Account deletion removes both database files and the local key. Intention and time-block outboxes are split into serialized JSON batches of at most 48 KiB and 100 rows, so a long-offline backlog can sync under the API’s request-size and array limits; a single maximum-sized intention remains valid under the 256 KiB API body limit. Web preferences and mobile preferences each have a durable local outbox; an in-flight response cannot clear a newer preference update.
2. A stable client ID makes retries safe. The API’s `(owner_id, client_id)` unique key prevents duplicate intentions; a retry that collides with a deletion tombstone returns a conflict instead of presenting the redacted row as a successful save.
3. The API validates the Supabase access token, scopes reads and writes by its user ID, and returns a server version. Web and native requests also check that the active Supabase session belongs to the user ID whose local outbox or action they serve. Native API calls require an expected user ID, including filtered error telemetry, so a new call site cannot silently skip the account check. A disposed web sync client cannot start later requests after an account switch; native requests reject a stale account ID before sending data.
4. Incremental pulls pin their next-sync cursor before reading changed rows and query with a 60-second overlap. This catches equal-millisecond writes and short transactions that began before the pull but committed after its query snapshot; replay is idempotent. Web advances its local cursor only after the merged snapshot commits to IndexedDB; mobile serializes pulls and commits its cursor to SQLite after merging. Offline edits carry their expected server version, and web keeps a pending local edit when its timestamp ties a pulled row. The API recognizes a version change caused only by an AI title/type/horizon suggestion while an intention remains captured or exploring, so that response does not create a false offline conflict. Other stale edits preserve the user’s offline text in a separate copy instead of overwriting either version.
5. The AI worker uses the provider interface in `apps/worker/src/interpretation.ts` to send the unchanged capture as untrusted input with a strict JSON schema, then validates the returned title, kind, optional horizon, confidence, and rationale with the shared domain schema. Mock-adapter tests cover the request payload, response validation, and error propagation to the worker's queue retry policy. A credentialed model-evaluation command covers messy and ambiguous dictation, multiple thoughts, Bangla/English code-switching, invented deadlines, vague names, and prompt injection. API state tests cover undo eligibility, preserving the prior horizon, legacy metadata compatibility, and rejecting stale offline snapshots after a later edit. It can refine title, kind, and horizon only while the intention is still at the version it received; it never edits the raw capture or replaces a later user edit. Horizon suggestions remain null unless the captured text clearly states a timeframe, and undo restores the prior value.
6. AI metadata records the before/after title, type, and horizon, confidence, rationale, model, processing time, and undo time. The clients show the rationale and offer a version-checked undo only while those suggested fields are still current. Undo restores the prior title, type, and horizon, preserves the raw capture, and records the action in the metadata.
7. Intention brainstorming uses the same explicit AI preference. The API stores the user message and a pending reply in an owner- and intention-scoped table before enqueueing a BullMQ job. An intention-scoped PostgreSQL advisory lock prevents concurrent turns from different devices, while a row lock rechecks that the intention is still active and prevents a brainstorm save from racing with bulk deletion; clients wait for the current reply before sending another. The worker rechecks consent and intention state, reads up to 24 recent messages, and stores a short reply without changing intention fields or external services. A stable client request ID makes retries after failed or ambiguous responses idempotent; queue failures remain visible and retryable. Sending a new message requires a connection. Conversation text is included in account export and erased by “Delete all intentions.”
8. Suggestion feedback is written to the local durable store before the UI changes; web updates are serialized so rapid choices cannot replace one another. Offline feedback is replayed in batches, and a response for an older batch cannot clear a newer local choice. If a snooze expires before reconnect, the API saves it as `open` and returns that normalized state so one stale item cannot block the rest of the outbox.
9. Relationship creates and deletes enter the web IndexedDB or mobile SQLite outbox before the UI changes. Creates replay after intention snapshots so both client IDs exist on the server; deletes replay by the owner-scoped client-ID pair and relation type, making retries idempotent. Relationship writes lock both parent intentions in a stable order, and time-block writes lock their parent, so offline replays cannot recreate related or schedule data while an intention is being deleted. Native time-block removals also enter a SQLite outbox and replay after their intention is synced; server tombstones cannot be cleared by a delayed create retry. Server results are merged with pending local operations until the outbox drains.

## Integration boundary

Google, Jira, and Notion authorization use API callbacks and short-lived signed state. Each state is stored only as a SHA-256 hash in PostgreSQL. The provider callback forwards its temporary authorization code and state to the configured Veylo client in the URL fragment, without exchanging the code; fragments are not sent in subsequent HTTP requests. The client submits both to an authenticated completion endpoint; the API requires the signed state owner to match the current Supabase user before consuming state and exchanging the code. This prevents a callback completed in a different or signed-out Veylo account from attaching its provider grant to the initiating account. Completion deletes state atomically, so the code cannot be exchanged twice; expired rows are pruned when a new connection starts. Redirects set `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and clients remove the fragment after completion. Access and refresh tokens are encrypted with AES-256-GCM using an environment-only key. Notion requests, including OAuth exchange, search, and revoke, send the pinned `Notion-Version` header through one shared header builder, as required by [Notion’s token API reference](https://developers.notion.com/reference/refresh-a-token). Free/busy responses do not include event titles. Event creation uses a stable event ID derived from the Veylo time-block ID, and the API records the provider ID and URL for retries. The interface asks for confirmation before that API call. A provider 401 triggers one token refresh and request retry for Google Calendar, Jira, and Notion; a failed refresh requires the user to reconnect. Google disconnect clears Veylo’s token copy even if remote revocation cannot be confirmed, and logs only the response status. Provider HTTP requests use a shared 20-second timeout so an outage returns control to the client instead of leaving a request open indefinitely.
Jira Cloud reads only assigned issue references with a bounded field list; descriptions and other freeform body content are not imported. The API validates Jira’s HTTPS site URL and constructs issue links from the site origin and encoded issue key. The query and mapper have provider-contract tests without requiring an Atlassian account.

The Time perspective refreshes free/busy for the visible day or week when requested. Web and mobile hide results when navigation changes the visible range, so an unchecked day is never presented as having no calendar conflicts. Month and year views remain intention-capacity overviews; detailed calendar availability is limited to day and week ranges.

Google Calendar free/busy requests include only the chosen time range, timezone, and primary calendar. The API response mapper returns only valid start/end boundaries, stripping any unexpected provider fields before the response reaches a client. Approved event payloads use a stable ID derived from the Veylo time block and include the selected timezone plus user-authored title, intent, and purpose. Free/busy privacy and event payload/idempotency contracts have account-free tests.

Provider errors do not invalidate an intention save. The API's BullMQ producer disables ioredis' offline command queue and allows one retry; the worker keeps its reconnecting connection. AI job enqueue runs in the background, and queue writes have a three-second deadline; a missing or slow queue leaves the capture saved and editable. Snooze enqueue also has that deadline but returns a retryable error so the clients retain the feedback in their local outbox. A timed-out Redis operation can still complete later, so reminder IDs are stable and worker delivery claims deduplicate retries. OpenAI requests time out after 30 seconds. The SDK's automatic retries are disabled so the interpretation job's four exponential-backoff attempts are the single retry policy. Jira Cloud is an on-demand, read-only assigned-issue view; Veylo does not copy Jira issues into its intention records. Notion uses its OAuth page picker and exposes selected page titles and links on demand; Veylo does not fetch or copy page contents.

Web and mobile snooze reminders use the same Redis queue. If a user opted into push but Redis rejects a delayed job, the API returns 503 and both clients retain the snooze in their local feedback outbox for retry. Web retries failed syncs with exponential backoff capped at one minute and retries immediately on reconnect or window focus; mobile retries pending work every 30 seconds while foregrounded and on resume. At send time, the worker verifies the owner’s current snooze state, that the snooze is due, the active intention, and opt-in, then atomically claims the suggestion reminder before sending generic text to Expo devices and encrypted browser subscriptions. Claims have a 15-minute recovery lease and a unique key; only the current claimant can mark delivery handled or release its claim. Expo requests have a 30-second total timeout; Web Push uses a 30-second socket inactivity timeout. A per-snooze handled marker coordinates duplicate queue jobs; changing the snooze date starts a new reminder lifecycle. Failed delivery to every destination releases the claim for queue retry; a partial success marks the reminder handled to avoid repeatedly notifying devices that already received it. Delivery is at-least-once across a process crash after provider acceptance but before the database records completion. When account quiet hours apply, the worker defers the job until the configured end time in the account timezone. Unit coverage checks same-day, overnight, and daylight-saving-gap boundaries. Changing quiet-hour settings rechecks reminders that are already due. Web Push subscriptions are encrypted with AES-256-GCM in Postgres; a SHA-256 hash supports lookup and endpoint removal without storing the raw endpoint as an index. API and worker share `PUSH_SUBSCRIPTION_ENCRYPTION_KEY`. Browser delivery uses VAPID; Expo delivery requires an EAS project and platform credentials. Scheduled daily digests are not implemented.

## Security and operations

- Supabase publishable keys can appear in clients; Supabase secret keys, OAuth client secrets, OpenAI keys, and token-encryption keys stay server-side. The API accepts the legacy `SUPABASE_SERVICE_ROLE_KEY` only as a migration fallback. Application and migration-tracking tables have row-level security enabled without direct `anon` or `authenticated` policies; browser and native product data flows through the owner-scoped Fastify API. Keep the API database credential server-only and do not add client table policies without a separate security review.
- API payloads are schema-validated, body size is limited, CORS is restricted to the configured web origin, and request logs redact authorization headers, metrics tokens, and request URLs. OAuth callback query strings contain one-time authorization codes and signed state, so URLs are excluded from logs.
- Web and native route render failures show branded retry screens and send a privacy-filtered fingerprint to the API when the user is signed in. API request failures are logged by Fastify with authorization and metrics tokens redacted and request URLs omitted; alert delivery still needs deployment setup.
- Cross-origin browser requests allow the methods used by the sync client, including `PUT` for preferences and suggestion feedback.
- Redis is configured as a job queue, not a cache. Render deployment sets the queue eviction policy to `noeviction` and persistence on.
- Account deletion relies on owner-scoped records and database cascade constraints. After the server confirms deletion, clients clear the per-account local database/outbox and sign out locally even if device cleanup fails; the UI reports when cached data needs manual removal. Google disconnect attempts provider revocation and always clears Veylo’s encrypted token copy; Jira and Notion disconnect clear Veylo’s token copies, and their provider grants can be revoked from the user’s Atlassian or Notion settings.
- “Delete all intentions” erases capture text, derived details, schedule values, provider event mappings, relationships, and suggestion feedback. Minimal intention/time-block tombstones remain to propagate deletion to devices that reconnect later. Google Calendar events already created by the user remain in Google and are called out before deletion.
- Database changes are versioned SQL files under `packages/db/migrations/`; `npm run db:migrate` applies each file once and records it. The Drizzle schema mirrors the migration ownership foreign keys to Supabase `auth.users`, account-delete cascades, same-owner intention relationships, time blocks, brainstorming messages, intention revision history, one-time OAuth state, and domain checks. Update it alongside a new numbered SQL migration when changing the database contract.

## API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Runtime health check |
| `GET` | `/ready` | Database readiness check used by deployment health probes |
| `GET` | `/v1/intentions` | List current user’s intentions |
| `GET` | `/v1/account/export` | Export account-owned records and provider connection metadata, excluding OAuth tokens and push secrets |
| `DELETE` | `/v1/account` | Delete provider token and Supabase account data |
| `GET` | `/v1/intentions/:id` | Intention with time blocks and relationships |
| `GET` | `/v1/intentions/:id/history` | Latest 100 owner-scoped intention revision metadata entries |
| `GET` | `/v1/intentions/:id/brainstorm` | Read the latest 40 owner-scoped conversation messages |
| `POST` | `/v1/intentions/:id/brainstorm` | Save an idempotent user message and queue an opt-in AI reply (30 requests per 10 minutes) |
| `POST` | `/v1/captures` | Idempotently save a raw capture |
| `PATCH` | `/v1/intentions/:id` | Version-checked edit |
| `DELETE` | `/v1/intentions/:id` | Archive one intention |
| `DELETE` | `/v1/intentions` | Delete all current-user intentions |
| `GET` | `/v1/sync?since=` | Download changes since an ISO timestamp |
| `POST` | `/v1/sync/push` | Replay offline intention snapshots |
| `POST` | `/v1/sync/blocks` | Replay offline time-block changes |
| `POST` | `/v1/intentions/:id/time-blocks` | Create a planned session |
| `POST` | `/v1/intentions/:id/relationships` | Link two intentions |
| `POST` | `/v1/intentions/:id/interpretation/undo` | Restore the pre-AI title, type, and horizon if the AI suggestion is still current |
| `GET` | `/v1/relationships` | List the current user’s intention links |
| `POST` | `/v1/relationships` | Create a link between two synced intentions |
| `DELETE` | `/v1/relationships/:id` | Remove an intention link |
| `DELETE` | `/v1/relationships` | Idempotently remove a link by its two intention client IDs and relation type |
| `GET` | `/v1/preferences` | Read account preferences |
| `PUT` | `/v1/preferences` | Update preferences and enqueue opted-in AI work |
| `GET` | `/v1/suggestion-feedback` | Read stored states for intention suggestions |
| `PUT` | `/v1/suggestion-feedback` | Save or replay suggestion feedback idempotently |
| `POST` | `/v1/notifications/device` | Register a native Expo push token and opt in to snooze reminders |
| `DELETE` | `/v1/notifications/device` | Remove registered push devices and opt out |
| `GET` | `/v1/notifications/web/config` | Read the public VAPID key and current browser subscription state |
| `POST` | `/v1/notifications/web` | Store an encrypted browser subscription and opt in |
| `DELETE` | `/v1/notifications/web` | Remove one browser subscription |
| `POST` | `/v1/telemetry/client-errors` | Accept a privacy-filtered render-error fingerprint |
| `GET` | `/v1/integrations` | Read provider connection state |
| `POST` | `/v1/integrations/google/connect` | Begin Google authorization |
| `GET` | `/v1/integrations/google/callback` | Forward Google’s temporary code and state to the client fragment |
| `POST` | `/v1/integrations/google/complete` | Exchange Google callback code for the signed-in state owner |
| `POST` | `/v1/integrations/jira/connect` | Begin Atlassian OAuth 2.0 authorization |
| `GET` | `/v1/integrations/jira/callback` | Forward Jira’s temporary code and state to the client fragment |
| `POST` | `/v1/integrations/jira/complete` | Exchange Jira callback code for the signed-in state owner |
| `GET` | `/v1/integrations/jira/issues` | Fetch the current user’s assigned Jira issues on demand |
| `DELETE` | `/v1/integrations/jira` | Clear Veylo’s Jira token copy |
| `POST` | `/v1/integrations/notion/connect` | Begin Notion public connection authorization |
| `GET` | `/v1/integrations/notion/callback` | Forward Notion’s temporary code and state to the client fragment |
| `POST` | `/v1/integrations/notion/complete` | Exchange Notion callback code for the signed-in state owner |
| `GET` | `/v1/integrations/notion/pages` | List selected page and database references on demand |
| `DELETE` | `/v1/integrations/notion` | Clear Veylo’s Notion token copy |
| `POST` | `/v1/integrations/google/availability` | Read free/busy windows |
| `POST` | `/v1/integrations/google/events` | Create a user-approved event |
| `DELETE` | `/v1/integrations/google` | Revoke and disconnect Google |
