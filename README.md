# BrekMate backend — implemented core, v0.1

This folder contains executable TypeScript backend source, tests, a locked dependency tree, API contracts, an AWS Lambda build, and a patch for the previously prepared OpenTofu project. It is a development baseline, not a production release approval. No AWS services were deployed and no real customer messages or payments were sent.

## Start locally

Use Node 24 and Python 3. From this folder:

```bash
npm ci
npm run check
npm run dev
```

The development server binds only to `127.0.0.1:3000`, uses volatile memory, and has two explicit fixture tokens: `Bearer local-customer` and `Bearer local-manager`. It loses data on restart. Those tokens and the local entry point are excluded from the Lambda bundle. Local sample coordinates, opening hours and policy values are test fixtures.

```bash
curl http://127.0.0.1:3000/health
curl -H 'Authorization: Bearer local-customer' http://127.0.0.1:3000/v1/menu
# First POST the same basket to /v1/quotes and copy quoteToken.
curl -X POST http://127.0.0.1:3000/v1/orders \
  -H 'Authorization: Bearer local-customer' \
  -H 'Idempotency-Key: example-order-001' \
  -H 'Content-Type: application/json' \
  -d '{"lines":[{"sku":"meal","quantity":1,"addons":[]}],"fulfilment":"pickup","useRewards":false,"payment":"COD","quoteToken":"COPY_FROM_POST_V1_QUOTES"}'
```

## Implemented

- Pure vegetarian catalogue with categories, add-ons, stock and outlet availability management.
- Server-priced basket quotes and COD pickup/delivery orders; configurable 2–3 km straight-line delivery radius.
- Strictly-above-₹99 free delivery; otherwise ₹20 for delivery, pickup free. Rewards capped at 20% of item subtotal and available balance.
- Atomic stock reservations, reward debits/restores, append-only monetary ledger and durable idempotency records.
- Order ownership, customer cancellation before acceptance, staff status transitions and reason recording.
- Registered rider assignment, per-order delivery OTP, attempt limits/expiry, COD collection and referral credit after delivery plus collection.
- Profiles, saved address creation/update/removal, history, server-repriced reorder, wallet history and referral attribution.
- Celebration enquiries, capacity validation, staff confirmation, non-overlapping slot reservations, staff cancellation and manual photo-delivery recording with consent.
- Order status notifications in an authenticated in-app feed, support ticket creation, staff operations/audit reads and an account access-disable/erasure-review workflow.
- Separate customer/staff Cognito JWT verification, role checks, in-process HTTP tests and an optimistic transactional DynamoDB adapter using three existing tables without scans.

## Explicitly unfinished release work

Online UPI/card gateway checkout, signed payment webhooks, reconciliation and refunds are **not implemented**. `ONLINE` checkout returns `503 online_payment_unavailable`. There is no refund endpoint and cancellation is allowed only in the implemented pre-delivery state machine. Push/email/SMS/WhatsApp delivery providers, automated photo sharing, full privacy erasure, Cognito signup UI/phone OTP, advanced reports, risk controls and load/disaster-recovery validation remain open. See `docs/RELEASE_GATES.md` for the concrete backlog and policies needing decisions.

Customer authentication uses the previously proposed Cognito email/SRP setup; the mobile app must integrate that provider. Delivery OTP is an order verification code shown privately to the authenticated customer in-app. It is not login OTP.

## Files

`src/` holds business services, request schemas, pricing, authentication and storage. `test/` contains domain, concurrent-operation, HTTP and security tests. `docs/openapi.json` and `docs/API.md` describe the implemented API. `integration/` contains the exact route map and a reviewable IaC patch. `adapters/quality.mjs` connects the earlier test workspace to the shipped pricing code.

```bash
npm run package
```

This creates `artifacts/brekmate-lambda.zip` with `index.mjs` at its root and `artifacts/BrekMate_Backend_Source.zip`. The Lambda runtime is `nodejs24.x`, architecture `arm64`, handler `index.handler`. Read `integration/README.md` before enabling any cloud resources.

## Coordinated review — 18 October 2026

Current findings, checks and release blockers: [release review](docs/release-2026-10-18/RELEASE_CHECKLIST.md). This review supersedes historical passing counts; no deployment or production approval is granted.
