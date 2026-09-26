# M5.2 UX, mobile, and reliability implementation plan

## Approved scope

Implement the approved M5.2 polish pass without adding product scope or database migrations. Preserve the M5.1 summary privacy and archive/delete behavior.

## Workstreams

1. Improve mobile trip navigation with a compact primary bar and accessible overflow menu so every trip section remains reachable without horizontal scrolling.
2. Make archive state consistent on the Members surface and harden destructive confirmation buttons against double submission.
3. Add user-safe client error mapping and resilient realtime refresh behavior for reconnect and online recovery without changing the SSE contract.
4. Add focused unit/component coverage plus a mobile/recovery E2E flow, then run M5.1 and realtime regressions and all required gates.

## Verification

Run focused Vitest suites, M5.2 E2E, M5.1 summary E2E, realtime E2E when available, lint, typecheck, full unit tests, build, and `git diff --check`. Commit all M5.2 changes once; do not push or start M5.3.
