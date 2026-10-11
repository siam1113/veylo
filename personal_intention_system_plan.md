# Personal Intention System — Product & Build Plan

**Status:** Build-ready planning specification · **Date:** 2026-10-10  
**Platforms:** Responsive web, iOS, Android · **Release target:** Functional V1 on all three, not UI-only mockups.

## 1. Product thesis

A purpose-driven personal intention system: **capture anything → understand it → connect it to what matters → shape it into action → find time → optionally synchronize elsewhere.**

The product is **not** a conventional to-do list, project manager, or calendar replacement. Its primary job is to transform messy, spontaneous thoughts into clear, living intentions and help users act on them. The workspace is unified, adaptive, immersive, and calm. Scheduling is an optional consequence of intention, not the starting point.

### Core principles
- Zero-friction voice and text capture; never require categorization before saving.
- Preserve the original thought alongside AI interpretations; editing is always possible.
- Purpose and intent before deadlines and checkboxes.
- One workspace with adaptive perspectives, not separate silos.
- Suggestions are proactive, explainable, dismissible, and reversible.
- Never create third-party tasks/events or move calendar commitments without explicit approval.
- Visual motion adds meaning, not decoration; accessible reduced-motion mode is first-class.
- Private by default, with transparent permissions and minimal data retention.

## 2. Core domain model

**Intention** is the canonical entity; the type can evolve without losing history.

| Field | Purpose | Required? |
|---|---|---|
| id, owner_id, created_at, updated_at | Identity and audit | Yes |
| raw_capture | Exact typed words or voice transcript | Yes |
| title | Short editable interpretation | Yes, auto-generated initially |
| kind | idea / action / commitment / question / goal / meeting / note | Yes, AI suggestion with fallback `unclassified` |
| intent | What I want to do | Optional |
| purpose | Why it matters | Optional |
| desired_outcome | What success looks like | Optional |
| rough_plan | Lightweight steps or freeform thoughts | Optional |
| horizon | today / week / month / someday / custom | Optional |
| effort_estimate | Estimated minutes | Optional |
| energy_context | Focus, light, collaborative, etc. | Optional |
| status | captured / exploring / ready / planned / active / completed / archived | Yes |
| linked_intentions | Parent purpose, related ideas, dependencies | Optional |
| schedule_blocks | Zero or more proposed/confirmed time blocks | Optional |
| external_links | Provider, external ID, sync state | Optional |
| ai_metadata | Classification confidence, rationale, model version | Internal |

Distinguish **intention**, **activity**, **time block**, **suggestion**, and **external reference** as separate records. A thought can remain an idea forever; an activity can have multiple sessions; a goal can contain many activities. Do not force everything into task semantics.

## 3. Primary user journeys

### A. Instant capture (the critical path)
1. Open app; capture field and mic are immediately available.
2. Speak or type: “Need to talk with Maya about that idea, maybe next week.”
3. Save raw input instantly, even offline.
4. AI suggests: kind = conversation/meeting; title = “Discuss idea with Maya”; horizon = next week.
5. Offer small actions: **Keep**, **Explore**, **Find time**, **Edit**. No mandatory modal.
6. If ignored, retain the item in the unified space.

### B. Clarify an intention
1. Open an intention; its surface expands in place.
2. Optional prompts: “What’s the purpose?”, “What would a good outcome look like?”, “What’s one first step?”
3. AI can propose a rough plan; user approves before replacing any content.
4. The intention remains linked to original capture and related purposes.

### C. Shape a day/week/month/year
1. Switch the same workspace to **Time** perspective.
2. Show free capacity, confirmed commitments, and unscheduled intentions.
3. Drag an intention into a block, or accept a suggested slot.
4. User confirms; optionally publish to Google Calendar or other supported calendar.
5. Show planned vs available capacity without guilt-oriented scores.

### D. Proactive suggestion
1. Detect a relevant unscheduled intention and suitable available window.
2. Present: “You wanted to explore the farmer AI idea. Thursday has 45 free minutes. Reserve it?”
3. Show **why**, source, and proposed action.
4. Accept, change, snooze, dismiss, or mute that suggestion category.
5. Do not schedule or notify repeatedly without consent.

### E. External work context
1. User connects Jira, Notion, or another provider.
2. Read assigned work, due dates, and relevant context with scoped permissions.
3. Present external items as linked references, not duplicated ownership of the source record.
4. Suggest intentional time blocks for selected external work.
5. On approval, create/update the external event or task; record sync status and handle conflicts.

## 4. Adaptive immersive experience

**One continuous environment, four perspectives:**

| Perspective | Main feeling | Key interactions |
|---|---|---|
| Capture | Blank, welcoming, frictionless | Mic, type, paste, quick add, save |
| Explore | Thoughtful, spacious, connected | Expand living objects, brainstorm, relate, clarify |
| Align | Purpose-led, reflective | Group by goals, see relevance, refine priorities |
| Time | Fluid, grounded in reality | Zoom day/week/month/year, drag, resize, confirm |

These are *lenses on the same objects*, not distinct databases or disorienting page transitions.

### Interaction and motion rules
- Captures appear as softly animated intention objects; animation duration roughly 180–350 ms.
- Focused objects expand without losing spatial context; background elements gently recede.
- Zoom from broad horizon to precise time; preserve position and orientation when possible.
- Use motion to communicate classification, connection, scheduling, and confirmation.
- Avoid continuous particle effects, heavy 3D, excessive parallax, and motion that obscures controls.
- Support keyboard navigation, screen readers, high contrast, large text, and `prefers-reduced-motion`.
- On low-power mobile devices, prioritize smooth performance and reduced visual complexity.

### Essential surfaces
1. **Home / Living Space:** one canvas, immediate capture, contextual intentions, optional assistant insight.
2. **Intention Detail:** title, raw thought, intent, purpose, outcome, rough plan, relationships, time, external links, history.
3. **Time Lens:** day/week/month/year with capacity and scheduling affordances.
4. **AI Conversation:** short contextual clarification and brainstorming; never mandatory.
5. **Suggestion Tray:** ranked nudges with explanations and feedback controls.
6. **Connections:** providers, scopes, sync direction, last sync, disconnect.
7. **Preferences & Privacy:** notifications, AI behavior, voice retention, export/delete, accessibility.

## 5. Proactive intelligence policy

### Pipeline
**Observe permitted signals → detect opportunity → rank relevance → check interruption budget → suggest → learn from feedback.**

Signals: user-authored purpose, recent capture, explicit horizon, unscheduled items, connected calendar availability, work deadlines, previously accepted/dismissed suggestions, user-defined focus hours. Do not infer sensitive personal traits.

### Initial ranking (heuristic, adjustable)
`score = 0.30 purpose_alignment + 0.25 time_fit + 0.20 urgency + 0.15 user_interest + 0.10 feasibility` where components are normalized 0–1. This is a starting hypothesis, not a validated model.

- **≥ 0.80:** show as a timely suggestion, subject to frequency caps.
- **0.60–0.79:** place quietly in suggestion tray.
- **< 0.60:** do not interrupt; available on request.
- No more than two unsolicited nudges/day by default; no duplicate nudge for the same item within seven days unless circumstances materially change.
- Quiet hours, opt-out, and per-category controls; mobile push requires separate opt-in.
- Explain each suggestion: intention, relevant purpose, availability evidence, and confidence/uncertainty.
- Never silently schedule, send messages, modify external tasks, or infer a commitment from vague language.

### AI trust boundaries
- Separate user instructions from imported third-party text; treat imports as untrusted.
- Validate structured model outputs against schemas.
- Require explicit confirmation for all external writes.
- Offer undo and audit logs for user-visible changes.
- If classification is uncertain, retain `unclassified` and ask at most one useful question.
- Fall back to manual capture and scheduling when AI is unavailable.

## 6. Platform architecture

### Selected implementation stack

The project has selected and scaffolded this stack; see [ADR 0001](docs/adr/0001-production-stack.md) for the decision and tradeoffs.

- **Web:** React Router Framework Mode + TypeScript + React, built as a responsive installable PWA.
- **Mobile iOS/Android:** Expo + React Native + TypeScript, with SQLite persistence, secure session storage, speech recognition, and push notifications.
- **API:** Fastify + TypeScript as the shared authenticated boundary for web, mobile, background work, and provider integrations.
- **Database and auth:** Supabase Auth and managed PostgreSQL; Drizzle schema access and versioned SQL migrations live in the repository. Row-level security is enabled, and application data access goes through the API.
- **Background work:** Redis + BullMQ worker for AI interpretation and scheduled push reminders.
- **AI:** server-side OpenAI integration with structured output validation, raw-capture preservation, reversible suggestions, and manual fallback.
- **Integrations:** backend OAuth adapters for Google Calendar, Jira Cloud, and Notion, with encrypted provider credentials and explicit approval for external writes.
- **Offline:** browser IndexedDB and mobile SQLite stores with account-scoped durable outboxes, version-aware sync, and conflict recovery.
- **Deployment:** Render blueprint for web, API, and worker; Expo Application Services (EAS) for native builds and distribution.

This architecture is implemented as a baseline, but the release gates in [the operations runbook](docs/runbook.md) remain open until dependencies are installed, builds pass, configured services are exercised, and device QA is complete.

### Repository layout
```text
apps/
  web/                 # React Router responsive PWA
  mobile/              # Expo iOS + Android
  api/                 # Fastify auth boundary, intentions, suggestions, integrations
  worker/              # BullMQ AI and notification jobs
packages/
  domain/              # Shared schemas and domain rules
  db/                  # Drizzle schema and SQL migrations
docs/                  # Architecture decision, architecture guide, operations runbook
render.yaml            # Web, API, worker, and Redis deployment blueprint
```

### Key services
- Capture Service: accepts raw input, saves before processing.
- Interpretation Service: extracts suggested kind/title/horizon; never discards raw input.
- Intention Service: relationships, lifecycle, revision history.
- Capacity Service: merges busy windows and user constraints without assuming all free time is usable.
- Suggestion Service: ranks, explains, caps, and tracks feedback.
- Integration Service: read/import, approve/write, sync state, reconnect and reconciliation.
- Notification Service: opt-in mobile/web nudges and quiet hours.

### Minimum API contracts
```text
POST   /captures
GET    /intentions?kind=&status=&horizon=
GET    /intentions/:id
PATCH  /intentions/:id
POST   /intentions/:id/relationships
POST   /intentions/:id/brainstorm
GET    /time/availability?from=&to=
POST   /time-blocks/propose
POST   /time-blocks/:id/confirm
GET    /suggestions
POST   /suggestions/:id/feedback
GET    /integrations
POST   /integrations/:provider/connect
POST   /integrations/:provider/sync
POST   /external-actions/:id/approve
```

## 7. Integrations and ownership

**V1 launch priorities:** Google Calendar read + user-approved event creation; Jira read-only assigned issues; Notion read-only selected pages/databases. Expand writes later based on validated demand and provider permissions.

- Calendar busy/free information must respect private event visibility; do not expose titles when only free/busy permission is granted.
- Keep local intention records authoritative for purpose/intent; external systems remain authoritative for their native tasks/events.
- Track mapping: local ID ↔ provider ↔ remote ID ↔ sync version ↔ last outcome.
- Handle OAuth expiry, provider downtime, deletion, duplicate creation, timezone/DST, recurring events, and conflicting edits.
- User can disconnect and choose whether to remove cached provider content.

## 8. V1 scope and acceptance criteria

### Must ship — web + iOS + Android
- Sign in, onboarding, basic privacy controls.
- Fast text capture and tap-to-record voice transcription (not an always-listening microphone).
- Offline capture with eventual synchronization.
- AI-assisted classification and title cleanup, with edit and undo.
- Unified workspace with Capture, Explore, Align, Time perspectives.
- Expandable intention details with optional intent/purpose/outcome/plan.
- Goal/intention relationships and related-items display.
- Day/week time-blocking; month/year as functional overview/zoom, not full-feature parity with day/week.
- Suggestion tray with rationale, accept, dismiss, snooze; push notifications opt-in.
- Google Calendar connection and approved event creation.
- Accessible motion system and reduced-motion setting.
- Basic export/delete account, logging, error recovery.

### Phase 1.1 — after initial release
- Jira and Notion import; richer two-way adapters only when permissions and sync semantics are proven.
- Better brainstorm mode, suggestions based on long-term patterns, recurring intention sessions.
- Native widgets, Siri/Android shortcuts where platform capabilities permit.

### Explicit non-goals for V1
- Full Jira/Notion replacement; team project management; automatic external writes; always-on background microphone; autonomous messaging; complex habit streaks; elaborate 3D world; unrestricted AI agents.

### Definition of done
- A new user can capture a messy spoken thought and see a saved, editable intention in under 15 seconds under normal conditions (product target; test empirically).
- Captures survive loss of connectivity and app restart.
- AI errors never prevent saving raw content.
- Scheduling requires confirmation and cannot double-create events on retry.
- Core paths work with screen reader and reduced motion.
- iOS and Android builds pass real-device QA and store policy checks.
- Integrations can be disconnected; imported content is not confused with locally owned tasks.

## 9. Delivery roadmap (illustrative 16-week plan)

| Weeks | Focus | Exit artifact |
|---|---|---|
| 1–2 | User journeys, clickable motion prototype, schema, security review | Validated interaction specification |
| 3–4 | Monorepo, auth, database, shared tokens, capture API | Capture saved end-to-end |
| 5–6 | Web/mobile capture, voice, offline queue, AI classification | Fast capture across platforms |
| 7–8 | Unified workspace, living detail, purpose relationships | Explore/Align functional |
| 9–10 | Time lens, manual blocks, capacity logic | Plan and move blocks |
| 11–12 | Google Calendar OAuth and approved sync; suggestion ranking | Connected scheduling + nudges |
| 13–14 | Accessibility, security, reliability, native notifications | Release candidate |
| 15–16 | Beta, usability testing, analytics, fixes, store submissions | Public V1 if quality gates pass |

**Staffing caveat:** 16 weeks assumes a small experienced cross-functional team. A solo developer should plan staged releases or a longer timeline, particularly for native app store readiness and robust integrations.

## 10. Engineering and quality strategy

- Unit-test domain transitions, scoring, capacity arithmetic, timezone handling, and schema validation.
- Contract-test adapters against mocked provider APIs; integration-test OAuth, token refresh, retries, and idempotency.
- End-to-end test web via Playwright; mobile via Maestro/Detox as appropriate.
- Maintain a red-team suite for prompt injection in imported notes/issues, sensitive data leakage, and unintended external writes.
- AI eval set: messy dictation, ambiguous goals, multiple intents in one utterance, Bangla/English code-switching, hallucinated deadlines, vague names.
- Track p50/p95 capture latency, transcription error rate, extraction edit rate, sync error rate, crash-free sessions, suggestion acceptance/dismissal, and retention.
- Never optimize for number of tasks created or time blocked alone; measure perceived clarity and meaningful follow-through.

## 11. Success metrics and product validation

**North-star candidate:** Weekly users who report increased clarity *and* complete at least one self-chosen meaningful action. Validate whether this is measurable and useful.

Supporting metrics:
- Time to first saved capture; % of captures requiring correction.
- % of intentions revisited, clarified, or scheduled within seven days.
- Suggestion usefulness rating and opt-out rate.
- Time-block acceptance and actual follow-through (self-reported, not assumed from elapsed calendar time).
- Seven-day/four-week retention; accessibility and performance metrics.

Run five to ten moderated usability sessions before hardening the spatial interface. Test whether users can instantly understand how to capture, find, and schedule something. If immersion hurts discoverability, simplify it.

## 12. Key product decisions to settle

1. **Brand/name:** working title “Personal Intention System”; final name pending.
2. **Visual metaphor:** living constellation, flowing field, or spatial desk — prototype at least two and test clarity.
3. **Voice privacy:** default transcription handling, raw audio retention (prefer discard after transcription), on-device vs cloud options.
4. **AI initiative:** exact opt-in defaults for notifications and assistant-triggered suggestions.
5. **Collaboration:** explicitly defer shared intentions until individual value is proven.
6. **Monetization:** free capture/core organization; possible paid advanced intelligence and integrations, after testing.

## 13. Agent implementation brief

Build a production-quality V1 of the Personal Intention System according to this document. Begin with architecture decisions and a thin vertical slice: **capture → persist → classify → display → edit** across web and mobile. Use strict TypeScript, migrations, testable service boundaries, accessible components, shared domain schemas, and feature flags. Preserve original input and require explicit approval for external writes. Do not invent provider API capabilities. Implement each phase behind automated tests and demoable acceptance criteria. Favor predictable, useful interaction over decorative complexity. Record architecture decisions, trade-offs, unresolved questions, and deployment instructions in the repository.

**First milestone demo:** On web and a real phone, speak a rough idea, see it appear in the living space, expand it, add a purpose, and save it — even when AI classification fails.
