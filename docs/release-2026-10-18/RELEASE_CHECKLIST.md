# Release checklist and decisions

Candidate `cod-review-20261018.1`: **local review completed with release blockers; not cleared for staging deployment or production release**.

## Completed in this review

- [x] Preserve original source, inspect accessible current source and mobile instructions; compare271 Drive text files before edits.
- [x] Reproduce core tests using clean lockfile installs; current compatible FE/BE stock-edit contract and runtime/route wiring.
- [x] Fix delivered cash-due polling, rider suspension enforcement, stock edit races, implicit booking policy activation and missing staff CSP.
- [x] Record actual unit/component/contract/pricing/IaC outcomes, fresh audits, source manifests, patches, cost assumptions and rollback path.
- [x] Keep COD scope; correct stale prepaid scope text; do not enable cloud resources, online payments or paid services.

## Before any staging apply/deployment

- [ ] Restore GitHub access/confirm exact repo names; compare actual HEAD/dirty status/AGENTS and integrate without overwriting newer source. Pin compatible commits and CI action revisions, run actual CI. Local snapshot hashes are not upstream commit hashes.
- [ ] Resolve provider plugin/signature issues on a suitable host; pass init/schema/mock-plan checks for all roots. Obtain actual AWS account/Billing/Free Tier/quotas/state inputs and a real reviewed provider plan. No destruction count or cost cap is known now.
- [ ] Resolve frontend high-severity dependency gate, including precise shipped/tooling exposure and supported remediation. No blanket audit suppression or force downgrade.
- [ ] Get a functioning browser installation and pass staff browser flows plus CSP/header acceptance. Current local browser launch is blocked.
- [ ] Approve bootstrap/staging cost and saved-plan hash separately; configure real origins, outlet, pickup address, alarms/recipient confirmations, secret provisioning and test identities. Keep ordering and booking confirmation disabled until their policies/acceptance are cleared.

A tightly limited staging foundation can be considered after the account/plan prerequisites; it is not approved by this source review. A public app deployment is not currently cleared.

## Business decisions — block only their affected paths

| Decision | Current behavior / affected path |
|---|---|
| Tax and invoices | Pricing is tax-free, no tax/receipt policy invented. Public ordering remains disabled pending approved implementation/operating rules. |
| Reward fractional rounding | Floor20% allowance to whole paise is implemented as a proposal. Redemption/total acceptance requires approval or change. |
| Referral first-order/pickup/cancellation | Current first-created-order binds eligibility; unsuccessful first order prevents later rewards; pickup currently qualifies after delivered/collected. Referral paths need an explicit decision; do not describe as confirmed. |
| Cash exceptions/refunds/reward reversal | No final failed-delivery, prepared-food disposal/restock, cash refund, spent-referral reversal or saved shift settlement flow. A cash comparison alone is insufficient. |
| Venue | Confirm exact capacity, hours, schedule/15-minute slots, durations/buffers, exceptions and cancellation/no-show terms. Confirmation disabled; enquiries are pending only. |
| Introductory decoration | Duration/inclusions/terms unconfirmed; staff must confirm. No invented offer end date/minimum order. |
| Photos/privacy | Manual email/WhatsApp with consent, no marketing rights assumed. Approve retention/deletion/access process and real contacts. |

## Before public COD pilot / production

- [ ] Complete ordinary basket persistence and safe restoration; approved product/venue information and actual support contact.
- [ ] Implement immediate general staff revocation or approve and enforce a documented token-validity policy; live retained-token disable/group-change checks required.
- [ ] Complete scoped abuse protection, support response, privacy/retention/erasure operations and approved customer-facing policies.
- [ ] Implement agreed COD exception, refund/settlement/reward rules and associated focused tests.
- [ ] Pass live Cognito/API Gateway/DynamoDB/Secrets Manager/IAM/CORS/CSP integration, transactional concurrency, API/schema compatibility and expected-volume tests.
- [ ] Verify Android+iOS permissions/lifecycle/navigation/accessibility/persistence on physical devices; complete native E2E flows with real test auth. Native exports do not count.
- [ ] Approve signing identifiers, app branding, EAS/toolchain costs; generate signed preview APK, then appropriate internal iOS/TestFlight build. Inspect actual account/store requirements, privacy listings and data-safety forms.
- [ ] Rehearse alert delivery, consistent multi-table restore, state recovery and rollback with assigned operator/RPO/RTO.
- [ ] Review fresh production plan/account/state/artifact hashes and costs; obtain distinct production/app-store release approval.

## Exact next approval boundary

First restore source access and reconcile these patches with actual upstream history. The next proposed approval is **push reviewed changes on `review/cod-release-2026-10-18` to the four verified repositories and open review PRs**, after showing resulting commit hashes and diff/check evidence. No deployment, infrastructure apply, paid build or store submission is included. Current blockers mean production/staging-deployment approval should not be requested yet.
