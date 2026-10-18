# API integration

Base path `/v1`. Except `/health`, every route requires a verified Cognito **access** token (`Authorization: Bearer ...`). Tokens from customer/staff pools are verified separately. Client-supplied role headers are ignored. Unknown body fields are rejected. JSON body limit: 16 KiB. Errors: `{error, requestId}` without stacks or supplied secrets.

POST mutations and account/address DELETE require `Idempotency-Key` with 8–128 letters, digits, underscores or hyphens. Exceptions: referral code retrieval and reorder quote. Keep a stable key through transport retries; a new user action gets a new key. Reuse with a different normalized request returns 409. Failed OTP attempts consume an attempt once per key. A fresh OTP attempt needs a fresh key.

Money is integer paise. Checkout accepts SKU, quantity and allowed add-on IDs, never trusted prices or balance. Quotes include a signed ten-minute quoteToken which COD checkout must supply; checkout rejects changed or expired quote consent before writes. Accepted idempotent replay survives expiry. A reordered basket uses current prices and can fail if items are unavailable. No online payment or refund endpoint is available.

| Routes                                                 | Intended caller                       | Behavior                                                                       |
| ------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /health`                                          | Public                                | Basic process health; not an AWS dependency readiness check                    |
| `GET /v1/menu`, `GET /v1/venue`                        | Authenticated                         | Paged catalogue and venue proposition                                          |
| `POST /v1/quotes`, `POST /v1/orders`                   | Customer                              | Server pricing; COD checkout                                                   |
| `GET /v1/orders`, `GET /v1/orders/{id}`                | Customer, permitted staff             | Owned order history or staff outlet work list/detail                           |
| `POST /v1/orders/{id}/reorder`                         | Customer                              | Owned order selection and current quote                                        |
| `POST /v1/orders/{id}/status`                          | Customer, permitted staff             | Validated state transition; customer may cancel only while placed              |
| `POST /v1/orders/{id}/assignment`                      | Owner/manager/operator                | Assign registered active rider by verified staff subject ID                    |
| `POST /v1/orders/{id}/otp`                             | Owner/manager/operator                | Generate delivery OTP for a ready order; response does not reveal code         |
| `GET /v1/orders/{id}/otp`                              | Owning customer                       | Retrieve unexpired delivery code privately                                     |
| `POST /v1/orders/{id}/collection`                      | Owner/manager/operator/assigned rider | Collect exact COD amount after delivery                                        |
| `GET /v1/rider/orders`                                 | Rider                                 | Assigned orders; no other rider's list                                         |
| `PUT /v1/staff/riders/{id}`                            | Owner/manager                         | Enable/disable rider registry; identity must already exist in Cognito          |
| `PUT /v1/staff/products`, `PUT /v1/staff/outlet`       | Owner/manager                         | Catalogue/stock management and open/closed state                               |
| `GET/PUT/DELETE /v1/profile`                           | Customer                              | Basic profile/settings; access-disable and erasure review request              |
| `GET /v1/addresses`, `PUT/DELETE /v1/addresses/{id}`   | Customer                              | Own saved delivery addresses                                                   |
| `GET /v1/wallet`                                       | Customer                              | Balance and append-only entry page                                             |
| `POST /v1/referral-code`, `POST /v1/referrals`         | Customer                              | Generate own code / attribute before first created order                       |
| `POST/GET /v1/bookings`, `GET /v1/bookings/{id}`       | Customer; staff read                  | Create enquiry; owned enquiries or permitted staff list/detail                 |
| `POST /v1/bookings/{id}/confirmation`, `/cancellation` | Owner/manager/operator                | Reserve or release venue slots                                                 |
| `POST /v1/bookings/{id}/photo-delivery`                | Owner/manager/operator                | Record manual delivery reference after confirmed event ends and consent exists |
| `GET /v1/notifications`                                | Customer                              | In-app order status feed; no push provider                                     |
| `POST /v1/support`                                     | Customer                              | Open ticket; referenced order must belong to customer                          |
| `GET /v1/staff/operations/{id}`                        | Owner/manager                         | Read `SUPPORT`, `PRIVACY_REQUESTS` or `AUDIT#YYYY-MM-DD` queue                 |

GET lists return `{items, cursor?}`; pass the returned cursor unchanged. A cursor belongs to the same endpoint/identity. Collection rows and opaque IDs are currently key-sorted, not newest-first. Quotes return `{subtotalPaise, deliveryFeePaise, rewardUsedPaise, totalPaise}`.

Order flow: `placed → accepted → preparing → ready → delivered` for pickup, or `ready → out_for_delivery → delivered` for delivery. Rejection is only from placed. Cancellation is from placed/accepted, with customer cancellation limited to placed. Rejection/staff cancellation requires a reason. Delivery dispatch requires an active assigned rider and issued OTP. Delivery completion verifies the OTP; collection is separate. Referral credit waits for both delivery and collected payment.

Kitchen can read outlet orders and move to preparing/ready. A rider can access assigned deliveries and dispatch/complete those orders; only manager/operator can issue delivery OTPs. Kitchen-only order responses exclude the delivery address. The current backend has one configured outlet; location switching/multiple staff outlet memberships require a later authorization design.

`openapi.json` is generated from registered routes and the implemented Zod request schemas. It deliberately does not claim stabilized success-response schemas. Source service return values and these descriptions are the current integration contract. API Gateway routing is separately generated in `integration/api-routes.tfvars.json`.

## COD batch 1

POST /v1/checkouts/reconcile accepts {key,abandon:false} and returns unknown, accepted with orderId, or abandoned. With abandon:true an unaccepted attempt is atomically tombstoned to block late checkout. Customer scope is mandatory. No marker TTL is introduced.

GET /v1/outlet exposes authenticated outlet status/location/pickupAddress. POST /v1/serviceability accepts latitude/longitude. Delivery requires recipientName/phone; floor and landmark are optional. GET /v1/staff/riders lists named dispatch choices. GET /v1/staff/cash/{date} lists paginated collections on an IST collection day. POST /v1/orders/{id}/delivery-issues accepts reason and note and does not create handoff/payment/stock effects. POST /v1/orders/{id}/otp accepts an optional reason; after dispatch renewal requires a reason and an expired/locked code, and remains café-only.
