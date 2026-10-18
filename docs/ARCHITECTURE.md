# Architecture and persistence

React Native customers and browser staff/riders call an API Gateway HTTP API backed by one Fastify Lambda. Cognito issues access tokens; application code verifies the signature, configured issuer, expiration, token use, client ID and allowed groups. One outlet is configured per backend deployment; this is not a multi-tenant marketplace.

The three DynamoDB tables use `pk`/`sk`, matching the prepared IaC. No DynamoDB `Scan` or GSI is required by this version.

| Table      | Partition examples            | Sort keys and purpose                                                                                              |
| ---------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| core       | `MENU#main`                   | `PRODUCT#sku`, catalogue and inventory                                                                             |
| core       | `CUSTOMER#sub`                | `META` profile/wallet/first-order attribution; `ORDER#id`, `ADDRESS#id`, `BOOKING#id`, `NOTIFICATION#timestamp#id` |
| core       | `ORDER#id`                    | `META`, authoritative order and delivery proof hash                                                                |
| core       | `OUTLET#main`                 | `META` open/closed; `ORDER#id` order pointers                                                                      |
| core       | `RIDER#sub`                   | `META` active registry; `ORDER#id` assignment pointers                                                             |
| core       | `REFERRAL#code`               | `META`, unique code owner                                                                                          |
| core       | `BOOKING#id`                  | `META`, enquiry/confirmation and consent                                                                           |
| core       | `VENUE#main`                  | `BOOKING#id` pointers; `SLOT#epochQuarterHour` reservations                                                        |
| ledger     | `CUSTOMER#sub`                | `ORDER#id#REDEEM`, `ORDER#id#RESTORE`, `REFERRAL#friend`                                                           |
| ledger     | `ORDER#id`                    | `COD_COLLECTION`, amount and collector                                                                             |
| operations | `IDEMPOTENCY#kind#sub`        | `operation#key`, request fingerprint and committed response                                                        |
| operations | `AUDIT#YYYY-MM-DD`            | timestamp/id, actor, entity and action                                                                             |
| operations | `CUSTOMER#sub`                | `OTP#order`, plaintext customer delivery code with logical expiry and cleanup TTL                                  |
| operations | `SUPPORT`, `PRIVACY_REQUESTS` | timestamp/id, staff action queues                                                                                  |

Each read within a business transaction records the expected version. A write replaces that item with version+1 and a matching condition; a read dependency that is not written becomes a condition check. A new record requires absence. One action per key avoids DynamoDB's duplicate-item transaction restriction. Optimistic conflicts retry up to 20 times; exhausted attempts return a retryable conflict. External side effects must never be placed inside the retry callback.

All transaction changes commit together. Checkout includes stock, order, wallet, ledger, first-order marker, list pointers, audit and idempotency result. Collection includes the exact payment amount, collection ledger, order payment state and conditional referral credit. Ledger writes require previously absent records; IAM should continue to deny ledger Update/Delete operations.

Transactions are capped at 100 actions. The API limits baskets to 20 distinct products, quantity 20 each and 10 unique add-ons. DynamoDB item/transaction byte limits remain AWS-enforced; real-service boundary tests are a release gate. Response-replay records have no automatic TTL: reusing a key must not create a second order after TTL cleanup. A retention/archive design is still needed.

Booking confirmation reserves every 15-minute slot covering the event and the configured trailing buffer. Starts/ends must align to quarter hours. Concurrent confirmations contend on the same slot keys; enquiries reserve nothing. Cancellation atomically releases owned slots. Production booking settings are explicit and disabled by default. UTC opening hours currently support one same-day interval; overnight schedules and exception calendars require further work.

Lists use strongly consistent base-table queries with pages of up to 50 items and a string cursor. IDs are opaque, not chronological: order/history lists are not newest-first. Stale rider pointers are filtered against the authoritative assignment. Financial history is append-only and cannot be edited through the API.

The local memory implementation is a deterministic transactional substitute. Passing its concurrency tests does not establish DynamoDB isolation, IAM correctness or AWS behavior; those require the real-service suite in the release gates.

Delivery OTP is random, hashed with an externally stored pepper on the order, expires after 30 minutes and locks after five distinct failed attempts. Its clear value is available only through the authenticated owning customer's endpoint until expiry or terminal order state. It is stored in the operations table to support this in-app handoff; narrow IAM, encryption and log redaction matter. No external message delivery is claimed.

Account deletion immediately blocks this backend's customer operations and creates an erasure review request. Existing financial/order/address/idempotency records and the Cognito account are not automatically erased. Token revocation, retention and complete erasure must be implemented before public launch.
