# Application Service - Missing Features

Gaps between the current implementation and a spec-compliant Matrix Application Service API homeserver.

## 1. Retry Scheduler

`TransactionSenderService.retryPending()` implements exponential backoff logic but has no caller. A periodic job (e.g. every 30-60s) must invoke it so that failed transactions are retried automatically.

**Files:** `transaction-sender.service.ts`

## 2. State-Aware Event Routing

`EventRouterService` routes events to all namespace-matching ASes without checking their state. When an AS is marked "down", the homeserver should queue events instead of attempting delivery, and resume when the AS recovers.

**Files:** `event-router.service.ts`, `appservice-state.repository.ts`

## 3. Transaction Event Body Persistence

Transactions only store `eventIds`, not the full event JSON. When `retryPending()` retries a failed transaction it sends `{ events: [] }`. Full event bodies must be persisted so retries deliver the actual events.

**Files:** `transaction-sender.service.ts`, `appservice-txn.repository.ts`, `appservice.model.ts`

## 4. Event Stream Position Tracking

`AppServiceState.streamOrdering` is initialized to 0 but never updated after successful delivery. This position must be incremented so the homeserver can resume from where it left off after a crash or AS downtime.

**Files:** `appservice-state.repository.ts`, `event-router.service.ts`

## 5. Ephemeral Event Stream Tracking

`readReceiptStreamId`, `presenceStreamId`, and `toDeviceStreamId` in `AppServiceState` are initialized to 0 but never read or updated. Ephemeral events (typing, presence, read receipts) are fire-and-forget. Per-AS stream cursors are needed so missed ephemeral events can be replayed.

**Files:** `appservice-state.repository.ts`, `event-router.service.ts`

## 6. Catch-Up / Replay on Recovery

When an AS transitions from "down" to "up", there is no mechanism to replay events missed during downtime. This requires working stream position tracking (#4, #5) and persisted event bodies (#3).

## 7. Rate Limiting Enforcement

`AppServiceRegistration.rateLimited` is stored but never checked. Middleware or routing logic should enforce rate limits on requests from ASes that have this flag set to `true`.

**Files:** `appservice.model.ts`, homeserver middleware

## 8. Lazy Loading (Namespace Guard Integration)

`NamespaceGuardService.lazyCreateUser()` and `lazyCreateRoomAlias()` are implemented but not wired into the homeserver controllers. When a request targets an unknown user or alias that falls in an AS exclusive namespace, the homeserver should query the bridge to lazily create the resource.

**Files:** `namespace-guard.service.ts`, homeserver `register.controller.ts`, `directory.controller.ts`
