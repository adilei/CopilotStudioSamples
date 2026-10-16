# Authenticated WhatsApp relay for Copilot Studio

A TypeScript sample connecting Meta's WhatsApp Cloud API directly to a **published Copilot Studio GHCP-harness / agentic-loop agent**, with Microsoft 365 Agents SDK user authorization. One Node.js process, an in-memory queue, and no application database, external broker, disk token cache, or file storage. No LangGraph or additional LLM is involved.

> [!WARNING]
> Experimental, local-first sample. Automated tests exercise the real SDK authorization logic with a simulated token service, HTTP webhooks, GHCP SSE fixtures, and Meta media fixtures. The initial text-link sign-in flow and multi-turn text replies have been exercised end-to-end locally with WhatsApp, Azure Bot OAuth, and a published GHCP agent. **The updated Sign in button, disabled startup greeting, and remaining live acceptance checks still need validation.** In particular, GHCP acceptance of incoming inline attachments is provisional; verify it with your agent before claiming image/document/audio/video input support. The endpoint is temporary and may change.

## How it works

1. Meta verifies `GET /webhook` using your verification token. For `POST /webhook`, the server verifies `X-Hub-Signature-256` over the **raw request body**, then validates the receiving WABA and business phone number.
2. The entire batch is admitted to a bounded memory queue before returning HTTP 200. Full queues return 503, allowing Meta to retry. Acknowledgment means **accepted in memory**, not durably saved or answered.
3. Workers serialize messages per sender and run different senders concurrently. Sender keys are scoped to the configured WABA and receiving number. Delivery statuses are tracked separately, never sent to the agent as prompts.
4. The custom `WhatsAppAdapter` creates SDK activities from verified events. `AgentApplication.authorization` uses an Azure Bot OAuth connection to obtain a **delegated user token**.
5. If authentication is needed, an SDK OAuth card becomes a native WhatsApp **Sign in** URL button (`cta_url`). The SDK-generated link is preserved in the button, not displayed in the message body. The worker returns while the user signs in. The six-digit verification code arrives through the normal Meta webhook; the SDK validates it and resumes the original activity. The relay never implements OAuth code redemption itself.
6. With that user's current token, the relay starts or continues a GHCP conversation and consumes its SSE stream. Completed text and files go out through separate Meta API requests. The webhook response is never the agent's answer.

Conversation creation uses `emitStartConversationEvent: false` to avoid a separate startup greeting before the reply to the user's original message. Greetings in ordinary agent replies are not filtered.

`/health` is a basic liveness endpoint. There is no public Bot Connector `/api/messages` endpoint, no `/subscribe` call, and no standard/classic Copilot Studio runtime fallback.

### Authentication boundaries

The bot's app credentials authenticate the relay **to the Azure Bot token service**. They do not replace the WhatsApp user's identity when invoking Copilot Studio. Each session has a random SDK user/conversation identity, isolated SDK `MemoryStorage`, and a separate GHCP conversation. Every authorized turn requests the current delegated token from the SDK.

Sign-in is bound to the sender and current session, expires after 10 minutes, and permits one code submission before a rejected flow must be restarted. An unsolicited or stale six-digit message is not forwarded to the agent. While sign-in is pending, other requests receive a reminder rather than replace the original request. Six-digit-only prompts are reserved for sign-in.

| Command | Effect |
| --- | --- |
| `--reset` | Starts a new GHCP conversation on the next request. Preserves the current sign-in unless a sign-in flow was pending; a pending flow is discarded. |
| `--signout` | Calls SDK sign-out for the current Azure Bot OAuth connection and clears the local session. Does not sign out the browser globally or erase remote conversation history. |

**The Azure Bot OAuth service caches tokens externally.** That managed service is an explicit exception to the relay's memory-only design. Restarting the relay loses its correlation to previous tokens; provider sessions/cookies and remote retention do not disappear.

## Local prerequisites

You need a **Meta developer account and app**, but you do **not** need to deploy the relay application to Azure to test it. Existing/provisioned Azure Bot and Entra OAuth resources are required; application hosting can remain on your laptop behind an HTTPS tunnel.

### 1. Meta test resources

Follow [Meta's WhatsApp setup guide](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started):

- Register as a Meta developer and create an app with the WhatsApp use case and its business portfolio.
- Use the test WABA/business number, add and verify your personal WhatsApp number as an allowed test recipient, and obtain a test access token with the required WhatsApp messaging permissions.
- Record the **phone number ID** and **WABA ID**, not their display names or phone-number strings. Obtain the Meta app secret for signature verification.
- Choose a long random webhook verification token. It is separate from both the app secret and access token.
- Select the Graph API version enabled for your app. `.env.example` shows `v25.0`; update it deliberately if necessary.

Development access tokens expire. Production setup uses appropriately managed credentials, approved business resources, and applicable Meta review/verification requirements.

### 2. Azure Bot / Entra OAuth configuration

Use an existing configuration or create these resources manually:

- A single-tenant Azure Bot registration with its bot identity app ID, tenant ID, and client secret.
- An Entra **confidential web application** for delegated sign-in (which can be separate from the bot identity). Add the Web redirect URI `https://token.botframework.com/.auth/web/redirect`.
- Give the sign-in application the Power Platform API delegated permission **`CopilotStudio.Copilots.Invoke`**, and obtain tenant consent as required.
- On the Azure Bot resource, add an OAuth connection using **Azure Active Directory v2**, that sign-in application's ID/secret and tenant. For the commercial production endpoint, request `openid profile offline_access https://api.powerplatform.com/CopilotStudio.Copilots.Invoke`. Put the OAuth connection's exact name in `BOT_OAUTH_CONNECTION`.
- Use the portal's connection test. The user must also have access to the published agent. Target environments may require the caller app to be allowed by the Power Platform gateway; permission consent alone does not override that restriction.

This sample uses the public-cloud Azure Bot token service. Sovereign-cloud OAuth is not implemented. For a non-production GHCP ring, obtain the correct delegated audience/scope and allowlisting from that service owner rather than copying the production scope.

The browser redirect is handled by **Microsoft's token service**, not an Azure-hosted copy of this relay. The user brings the verification code back over WhatsApp, so there is no local browser OAuth callback to expose and no requirement to deploy App Service first.

### 3. Published GHCP agent

Use a GHCP-harness / CLI-authored agent (recognizer `CLIAgentRecognizer` or `CLICopilotRecognizer`), publish it separately, and obtain its explicit authenticated **bot base URL**. Do not configure a classic/standard agent URL.

The current public endpoint shape is:

```text
https://<environment-host>/copilotstudio/agenticruntime/3p/dataverse-backed/authenticated/bots/<schema>?api-version=1
```

Set `GHCP_DIRECT_CONNECT_URL` to the full URL **including the API version, without `/conversations`**. No endpoint is guessed or discovered by this sample. `GHCP_CLOUD` records/validates the chosen ring; it does not automatically reconfigure the Azure Bot OAuth connection's scope.

For production/First Release, the environment hostname uses the lowercase environment GUID without dashes, split after its first 30 characters:

```text
<first-30-hex>.<last-2-hex>.environment.api.powerplatform.com
```

Test/Preprod/Dev use a 31/1 split and their ring-specific Power Platform API suffix. A portal's `preview` hostname still denotes production First Release, not Test. If the temporary endpoint changes, update the URL and revalidate the contract in `src/ghcp.ts`.

## Run locally

Use Node.js 22.17+ (22.x) or 24.x:

```bash
cd WhatsAppRelaySample
npm ci
cp .env.example .env
# Fill .env locally. Never commit it or paste its secrets into logs.
npm test
npm start
```

The server binds to **127.0.0.1:3978** by default. In another terminal, use an HTTPS tunnel, for example:

```bash
devtunnel host -p 3978 --allow-anonymous
```

In the Meta app, set the callback to `https://<tunnel-host>/webhook` and enter the exact `META_VERIFY_TOKEN`. Subscribe the app/WABA to **messages** webhooks, including incoming messages and delivery statuses. Reconfigure the callback if the tunnel URL changes. Do not enable request-body inspection or verbose SDK/HTTP diagnostics with real conversations; these can expose codes, sign-in URLs, tokens, and message contents.

Only the sample's two HTTP routes are exposed through the tunnel. Keep the host and tunnel running for the entire test. `npm start` uses the compiled output; run `npm run build` after edits.

### Live acceptance checklist (partially completed)

| Check | Expected result |
| --- | --- |
| First WhatsApp text | A native Sign in button arrives without a raw link in the message body; no agent call before authorization. |
| Tap Sign in, browser sign-in, then six-digit code | Original request, not the code, reaches the agent under that user's delegated identity. |
| Follow-up text | Same remote conversation; current user token fetched again. |
| Second WhatsApp user | Separate auth and conversation; the first user's code/token cannot authorize them. |
| Wrong/expired code, `--signout`, restart | No stale prompt replay or authenticated reuse across the new session. |
| Image, document, audio, video input | Verify the actual agent can ingest the inline attachment, not merely acknowledge the caption. Test all four separately. |
| Agent-generated files | Supported inline files upload to Meta and arrive as the correct message type. Test all four categories separately. |
| Slow answer | Read/typing indicator appears; no token-by-token messages, tool traces, or reasoning text. |
| Duplicate webhook and batched delivery | Duplicates do not re-execute during the dedup window; all admitted messages are processed. |
| Saturation, 401/403/429, disconnect, timeout | Explicit safe failure/backpressure; no automatic re-execution of uncertain tool actions. |
| Status notifications | Accepted sends are distinguished from later delivered/read/failed statuses. |

Use test data and harmless agent tools. A successful Meta HTTP send is not proof of WhatsApp delivery. Do not move to an Azure application deployment until these live checks pass. No resource provisioning, publishing, tunnel startup, or real message sending is performed by `npm test`.

## Attachments, typing, and streaming

**Incoming media:** the webhook supplies a Meta media ID. After sign-in, the relay fetches metadata and downloads the bytes with its Meta access token. It validates size, MIME family, basic file signatures, and the supplied hash, then constructs an SDK attachment containing a base64 data URL. It never gives the agent a Meta credential or an inaccessible private Meta URL.

**Important contract limitation:** the plugin demonstrates text input and outgoing inline attachments. It does not establish that every GHCP harness accepts incoming `Activity.attachments` data URLs or can interpret audio/video. This sample implements that input representation for validation, not a claim that the runtime supports every modality. An agent may reject or ignore an attachment; a successful HTTP response is not sufficient proof. There is no fallback transcription, vision model, or transcoding.

**Outgoing media:** completed message attachments can use inline base64 data URLs, or public/signed HTTPS URLs from exact administrator-configured `GHCP_FILE_ORIGINS`. URL downloads prohibit redirects and never forward the user's bearer token. Other authenticated file endpoints and arbitrary cards are rejected explicitly. Bytes are uploaded to Meta first, then sent by media ID.

| Category | Accepted MIME types | Sample size cap |
| --- | --- | --- |
| Image | JPEG, PNG | 5 MiB |
| Document | PDF, plain text, legacy Word/Excel/PowerPoint, OOXML Word/Excel/PowerPoint | 16 MiB |
| Audio | AAC, AMR, MP3, MP4 audio, OGG/Opus | 16 MiB |
| Video | MP4, 3GPP | 16 MiB |

The document limit is intentionally lower than Meta's maximum. Basic signatures are not malware scanning or full codec validation: Meta's codec, track, and format constraints still apply. Up to four outgoing files are allowed per turn. Files remain in memory in the relay, but **Meta retains uploaded media** under its own policies (normally up to 30 days). The sample does not implement remote media deletion.

**Typing:** the relay uses Meta's native read + typing endpoint, at most once every 25 seconds during active work. It stops refreshing on a final message, failure, or completion, and does not keep typing while waiting for user sign-in. Meta clears the indicator on a response or after its timeout; there is no explicit typing-off request.

**Streaming:** GHCP SSE is internal to the relay. Only final `message` activities and supported attachments are forwarded, in order. Typing text, informative updates, thought entities, and tool events are not displayed. There is no "longest partial answer" fallback. Text is split into at most 32 WhatsApp messages/files per turn without splitting Unicode codepoints. Previously sent final messages cannot be rolled back if a later file or stream fails.

The SDK's current `CopilotStudioClient` public streaming API does not expose per-turn cancellation. `src/ghcp.ts` therefore uses native fetch/SSE with SDK `ExecuteTurnRequest` and `Activity` types, bounded response reads, and abort signals. SDK authorization still owns user sign-in. Conversation IDs come from `x-ms-conversationid` or activities, are checked for consistency, and are never sent as an empty `activity.conversation.id`.

## Limits and failure semantics

Defaults are centralized in `src/config.ts`:

| Boundary | Default |
| --- | --- |
| Webhook body / simultaneous HTTP connections | 256 KiB / 64 |
| Queue including active work / per-sender backlog | 100 / 8 |
| Queue workers / sessions | 4 / 100 |
| Idle session / pending sign-in lifetime | 30 minutes / 10 minutes |
| Deduplication / outbound tracking | 1 hour; at most 10,000 entries each |
| File/stream working-memory reservations | 512 MiB total; conservative 256 MiB reservation per agent turn |
| SSE wire bytes | 32 MiB per response |
| Relay turn / individual Meta and token-service HTTP request | 120 seconds / 20 seconds |
| Graceful shutdown drain | 25 seconds |
| Free-form service window | 24 hours from the latest received user-message timestamp |

For Meta and token-service HTTP calls, the earlier of the individual request deadline and turn/shutdown cancellation wins.

Reservations limit concurrent agent turns to two even though the queue has four workers. Additional work can receive an explicit busy reply; this is not an RSS guarantee or a durable delayed retry. Node/SDK objects and HTTP buffers also consume memory. SDK-internal Entra **bot credential bootstrap** follows the SDK's own network policy and is not fully cancellable by the relay's turn signal; shutdown still has a hard drain deadline.

The queue only stores metadata and message text, never downloaded files. Idle sessions are swept periodically when not busy. Received sender order across different delayed/retried webhooks is not guaranteed.

No agent turn or Meta send is blindly retried. Interrupted GHCP conversations become uncertain and require `--reset` before another request. Reset starts a new conversation; it does **not** prove the previous remote action did not happen. Worker failures are logged with safe codes and reported to the user when possible; failed work remains deduplicated to avoid automatic repeats.

On shutdown, new admission stops and accepted work has up to 25 seconds to drain. Remaining work is aborted/abandoned and logged. A crash or restart loses all state and can lose events already acknowledged to Meta. Meta cannot infer this loss from an earlier HTTP 200. Deduplication is shorter than Meta's webhook retry horizon, so old retries or restarts can cause repeat processing.

## Production requirements, intentionally not included

| Area | What a production deployment needs |
| --- | --- |
| Durable ingestion | A broker such as Azure Service Bus; acknowledge only after durable acceptance; handle batch retries and poison events. |
| Coordination | Distributed per-conversation ordering/leases, lock renewal, fair scheduling and backpressure, shared expiring session/auth correlation. Sticky sessions alone are insufficient. |
| Recovery | Durable deduplication and checkpoints, idempotent tools, an outbox/send ledger, classified retries/backoff, dead letters, and reconciliation of uncertain remote outcomes. A queue cannot guarantee exactly-once side effects across services. |
| Identity and secrets | Reviewed delegated-user access, appropriate SDK token storage, secret rotation, secret manager, access reviews, and managed identity for host resources where supported. |
| Media | Content scanning, MIME/codec validation, outbound URL/DNS/network controls, bounded streaming/storage, deletion/retention policies, and confirmed runtime attachment contracts. |
| WhatsApp operations | Production business/number onboarding, API version management, rate limits, consent/opt-out, templates outside the 24-hour window, delivery monitoring, and applicable WhatsApp business/AI-use policies. |
| Hosting and observability | A long-running host, health/readiness and safe correlation, queue-age/delivery/auth metrics, alerts, capacity planning, coordinated deployments, and tested recovery. Do not rely on background work after a serverless invocation ends. |
| Privacy | Review data transfers and retention across Meta, Azure Bot OAuth, Entra, Copilot Studio, tools, browsers, and host logs. Memory-only relay state is not end-to-end zero retention. |

Deploying this unchanged to App Service does **not** make it production-ready. It supports one process/instance only and binds to localhost for local testing; cloud hosting needs an appropriate network listener/proxy plus the production controls above.

## Source layout and references

`server.ts` owns signed webhooks; `queue.ts` owns admission/order/deduplication; `adapter.ts` bridges the SDK transport; `relay.ts` coordinates sessions/auth/output; `ghcp.ts` isolates the temporary runtime contract; `meta.ts` and `media.ts` handle the channel and bounded files. Tests use Node's built-in test runner.

Direct Meta avoids a dependency on ACS Advanced Messaging for WhatsApp, which Microsoft lists for retirement on **September 30, 2028**. Azure can still host a production relay after its reliability requirements are addressed.

- [Meta setup](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
- [Meta webhooks](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint)
- [Meta media](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/media)
- [Meta typing indicators](https://developers.facebook.com/documentation/business-messaging/whatsapp/typing-indicators)
- [Meta URL buttons](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/interactive-cta-url-messages)
- [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy)
- [Microsoft 365 Agents SDK](https://github.com/microsoft/Agents-for-js)
- [ACS retirement guidance](https://learn.microsoft.com/en-us/azure/communication-services/acs-retirement-and-breaking-changes-guide)
