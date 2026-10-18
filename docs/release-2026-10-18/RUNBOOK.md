# Coordinated deployment and rollback runbook

Candidate identity: `cod-review-20261018.1`, not a production-approved release. FE/core/BE currently declare package version 0.1.0; the mobile workspace declares 1.0.0 while app config declares 0.1.0. Treat the source manifest/hash as candidate identity; align store versions/build numbers deliberately when signing. No release tag or commit has been created in upstream repositories.

## Reconcile source and prepare review branches

All four recovered working trees lack `.git`. Do not initialize an unrelated history and push it over existing work. Obtain access to the four expected repositories or confirm their actual names, clone into **new sibling folders**, inspect every applicable AGENTS.md, `git status --short --branch`, `git remote -v`, `git log -5 --oneline`, fetch and compare current upstream. Preserve any developer changes. The included patches are against the compared Drive/local baseline; run `git apply --check` and review conflicts rather than overwriting files.

Proposed branch in each actual repository: `review/cod-release-2026-10-18`.

Proposed commit subjects (hashes intentionally absent until current history is accessible):

- FE: `fix: keep cash-due orders fresh and prevent stale catalogue saves`
- BE: `fix: enforce rider access, catalogue revisions and explicit booking policy`
- Infra: `fix: connect COD runtime and restrict staff browser CSP`
- Quality: `test: connect local pricing contracts and document COD release gates`

Commands after access is restored, repeated inside each genuine checkout:

```bash
git switch -c review/cod-release-2026-10-18
git apply --check /absolute/path/to/review/patches/brekmate-fe.patch
# Inspect patch and existing work before applying. Use the corresponding patch for each repo.
git apply /absolute/path/to/review/patches/brekmate-fe.patch
git diff --check
git diff --stat
# Stage explicit reviewed source/docs/test paths, inspect `git diff --cached` and secret scan.
# Commit using the corresponding subject above only after reconciliation.
```

Review boundary: no push is authorized in this task. A later approval may authorize `git push -u origin review/cod-release-2026-10-18` in each verified repo and draft review PRs. No force push. A branch-push approval is not an apply/deploy/build-submission approval.

## Local verification and packaging

Keep four genuine checkouts as siblings. Node 24 / npm, Python 3, OpenTofu 1.12.6 and locked AWS provider 6.69.1 are the current baseline.

```bash
# brekmate-be
npm ci
npm run check
npm audit --omit=dev --audit-level=high
python3 scripts/package.py
# brekmate-fe
npm ci
npm run check
npm run test:backend
npx playwright install --with-deps chromium
npm run test:ui
npm audit --audit-level=high
# brekmate-quality
npm run test:local-product
npm run readiness  # expected to remain nonzero until full release acceptance exists
# brekmate-infra
python3 -m unittest discover -s tests -v
python3 scripts/check.py
```

The frontend high-severity audit gate currently fails; browser install and provider validation are blocked here. Resolve before promoting evidence. Run `npm run package` only after final builds; old `artifacts/` archives in the original trees are historical and must not be mistaken for this candidate. The delivered source bundle excludes them. Production/native signing must consume reviewed candidate hashes.

## Configuration contract

| Surface | Public/non-secret configuration | Secrets and owner |
|---|---|---|
| Customer app build | EXPO_PUBLIC_API_ORIGIN, EXPO_PUBLIC_CUSTOMER_POOL_ID, EXPO_PUBLIC_CUSTOMER_CLIENT_ID; APP_VARIANT=staging/production | User tokens handled by Cognito + OS SecureStore; signing credentials supplied through owner-controlled toolchain/build credentials, never EXPO_PUBLIC |
| Staff build | VITE_API_ORIGIN, VITE_STAFF_POOL_ID, VITE_STAFF_CLIENT_ID | Tokens in browser memory; no AWS secret or Cognito client secret in bundle |
| Backend infra bindings | ENVIRONMENT_NAME, CORE_TABLE, LEDGER_TABLE, OPERATIONS_TABLE, CUSTOMER_ISSUER, STAFF_ISSUER, CUSTOMER_CLIENT_ID, STAFF_CLIENT_ID, OTP_SECRET_ARN | `delivery-otp` secret JSON containing random pepper, fetched by exact ARN. Seed outside IaC/state/source; no real value included |
| Backend application | Actual OUTLET_LATITUDE/LONGITUDE, PICKUP_ADDRESS; DELIVERY_RADIUS_KM 2–3; ORDERS_ENABLED=false initially; ZERO_TAX_POLICY_APPROVED=false, REWARD_ROUNDING_POLICY_APPROVED=false, FIRST_ORDER_POLICY_APPROVED=false | Approvals are business gates, not switches to bypass missing policy |
| Venue | BOOKING_ENABLED=false; explicitly reviewed BOOKING_MAX_MINUTES, BOOKING_BUFFER_MINUTES, BOOKING_OPEN_UTC_HOUR, BOOKING_CLOSE_UTC_HOUR required to enable confirmation | No schedule/promotion terms approved by this review |
| Infra/operator | Actual allowed account/region, separate backend state keys, boundary ARN, immutable deployment_label, exact staff HTTPS CORS origins, alarm recipients and cost inputs | Short-lived AWS operator/OIDC credentials; protected state; no long-lived access keys in GitHub |

`application_environment` cannot override infrastructure table/identity bindings. Root runtime wiring owns OTP_SECRET_ARN. Lambda forbids local/test auth overrides. Cloud order creation remains off until policies and live acceptance pass. CSP connection origins are the exact runtime API and regional Cognito origin; actual staff-origin CORS must be explicitly supplied.

## Staging sequence — proposed, no apply executed

1. Verify account with short-lived login and `aws sts get-caller-identity`; inspect Billing/Free Tier/credits and existing resources/state, quotas, cost and alarm recipients. Approve budget and bootstrap plan separately. No deploy role exists yet: the authored GitHub OIDC role is plan-only, bound to exact repositories and protected environment subjects. Do not give it AdministratorAccess or assume it can deploy.
2. On a host where the verified provider starts, run init with backend disabled, validation, mock plans and policy checks for bootstrap, staging and production. Resolve provider signing-key warning under a currently trusted upstream release/key; do not disable verification.
3. Plan bootstrap state bucket/permissions boundary/exact OIDC plan subjects. Review saved plan and hash. Only after separate approval apply bootstrap, back up initial local state, migrate to encrypted/versioned locked S3 state and verify restoration. Never use force-copy or lock=false to silence conflicts.
4. Plan staging foundation with backend/web/worker disabled. This still creates durable tables/identity/secrets/operations resources and incurs costs. State key must be `staging/terraform.tfstate`; production uses its separate root/key. Approve and apply only the reviewed saved plan later.
5. Provision the OTP pepper externally; create customer/staff/rider **test** identities and TOTP with the account owner. Verify actual pickup/location/menu and non-secret settings. Supply the current built Lambda ZIP and the exact route map; runtime nodejs24.x, arm64, handler index.handler. Worker remains disabled.
6. Enable the backend in the **proposed staging plan**, initially keeping orders and venue confirmation disabled. Supply an immutable deployment label/artifact hash. Plan through:

```bash
# Inside brekmate-infra; private inputs outside repo
python3 scripts/plan.py staging \
  --vars /absolute/private/staging.tfvars.json \
  --backend /absolute/private/staging-backend.json
```

This requires AWS CLI/credentials and was not run here. Review `reports/private/staging/review.tfplan` and metadata locally; plans can contain sensitive data and are excluded from deliverables/Git. After an explicit future approval only:

```bash
tofu -chdir=environments/staging apply /absolute/path/to/review.tfplan
```

7. Build staff with actual VITE values. Enable web in another reviewed plan; use output HTTPS origin as API CORS input and verify CSP. Publish **only** `apps/staff/dist` via the guarded `scripts/publish_staff.py` flow after reading its current `--help`/required arguments; no repository/test pages/.env files. Its implementation verifies the target account and derives bucket/distribution from the selected environment state; `--execute` is the explicit write acknowledgement. Do not publish until separately authorized.
   Proposed staff dry-run (after provisioning and configuration, not executed here):

```bash
python3 scripts/publish_staff.py staging --dist ../brekmate-fe/apps/staff/dist --account ACTUAL_12_DIGIT_ACCOUNT
# Only after separate deployment approval, append --execute to the same command.
```

8. Once policy paths are approved, enable synthetic ordering in staging, run acceptance below and backup/rollback drills. Any failures return to local fixes. Production promotion requires fresh production account/state/plan review and candidate hash compatibility; never treat successful staging apply as production approval.

Expected plan shape, **not a real provider plan**: per retained environment three on-demand encrypted/PITR tables, two Cognito pools/public clients and staff groups, three protected secret containers, alarm topic; opt-in runtime adds API Gateway/41 routes/JWT authorizers, Lambda/version/alias/IAM/exact secret permission/log groups/two alarms; opt-in staff adds private versioned S3/CloudFront/OAC/header policy. No real add/change/destroy count is known. Reject protected resource replacement, broad new IAM or unexpected recurring resources. Optional payment-secret containers are not consumed by COD; preserve any existing state until a bounded cost cleanup is reviewed.

## Staging acceptance — must use live identities and persistent store

- Customer signup/confirmation/SRP/reset, refresh after expiry, logout; wrong issuer/client/token-use/signature/expired JWT; staff forced-password/TOTP, group downgrade/disable/revocation using retained old token; active/deactivated rider checks. Existing injected-identity tests do not prove this.
- Exact-origin CORS/CSP/TLS from hosted staff; verify CSP header exists and all asset/API/Cognito calls work without console policy errors. Non-owned customer IDs and unrelated rider order access must fail.
- Native denied/approximate/slow location, manual fallback, keyboard/back navigation, Maps return, screen readers/large fonts, AppState resume/background, crash/restart, offline retry and maximum journal payloads on Android/iPhone physical devices.
- Server fees at ₹98.99, ₹99.00 and ₹99.01; pickup free; rewards <=balance/20%; approved rounding/tax/receipts. Stale stock/prices/rewards, expired/tampered quote and changed address must reject without mutation.
- Double tap, response lost after acceptance, same-key retry, changed payload, reconciliation/abandon racing delayed checkout and app kill/restart. Confirm exactly one order/reservation/debit in DynamoDB; retain abandonment markers for late requests.
- Two customers competing for last stock; staff edit after reservation; two staff saves same revision; stale edit must 409. Reassignment/suspension while rider is dispatching/collecting. OTP wrong attempts, expiry, renewal reason/roles and no code disclosure to riders/logs.
- Delivery/pickup become delivered with cash due; staff/rider collect once; customer foreground timer and resume show collection without app restart. Verify collection-date index across IST midnight and exact immutable cash ledger totals. Comparison is not shift settlement.
- Referral only under approved first-order/pickup/cancellation policy, after delivery+collection and subtotal strictly >₹99; replay/concurrent collection cannot double-credit. Resolve cash refusal/final failed delivery/refund boundaries before public pilot.
- Venue enquiries clearly pending; staff confirmation only after approved schedule/capacity/slot/promotion rules; collisions; free venue/camera/no minimum food; consent/contact validation and manual photo process.
- Support follow-up, access disable, retention/erasure handling, billing alarms and operator runbook rehearsed. Record live IDs privately, scrub all evidence and never place customer PII/tokens/OTP in reports.

## Signed Android and internal iOS path

No APK/AAB/IPA or physical-device session exists here. Expo JS/Hermes export is not installable. EAS configuration already has `preview` with internal distribution + Android APK, and production app-bundle output. App identifiers use `.staging` and `.dev` suffixes; approve ownership/branding before signing. EAS project association/account/quota/signing credentials are not configured or verified.

After separate build-cost/credential approval, from `brekmate-fe/apps/mobile`, set actual public staging values, associate the owner-controlled EAS project and use the current documented CLI:

```bash
npx eas-cli@latest build --platform android --profile preview
# Signed APK from the preview build: install on authorized Android test devices.
npx eas-cli@latest build --platform ios --profile testflight
# Choose only an internal TestFlight group after Apple/App Store Connect setup:
npx eas-cli@latest submit --platform ios --id REVIEWED_BUILD_ID
```

Commands above are a future path, **not authorized execution now**; `REVIEWED_BUILD_ID` must be the explicitly verified build. The prepared `testflight` profile uses store distribution, the preview EAS environment and staging APP_VARIANT, retaining `.staging` and its API. The production profile requires production public configuration. The existing preview profile is ad hoc/internal distribution, not automatically a TestFlight artifact. An Apple Developer account, App Store Connect record, signing/profile access and internal testers are required. EAS can build iOS remotely; local iOS builds require the user's Mac/Xcode. Neither is available/verified here. Do not enable automatic submissions or paid services.

## Monitoring, recovery and rollback

Review Lambda errors/throttles, API 5xx/latency, DynamoDB conflicts/throttles, cash-due aging, unexpected reward/stock events and billing. Existing IaC creates Lambda errors/throttle alarms; API business/latency/collection-age alerts are still missing. SNS email subscriptions must be confirmed and alarm delivery tested. Set alert owner, polling/on-call process and approved recovery targets before launch.

For a regression, stop new orders using a reviewed ORDERS_ENABLED=false configuration deployment and/or privileged outlet close; do not modify data directly or mark unpaid orders collected. Keep existing customers/staff able to reconcile. Roll Lambda back by rebuilding a new reviewed IaC plan pointing to the previous verified artifact/hash and promoting its published version/live alias; do not race an ad hoc update-function-code command against IaC. Publish the prior approved staff bundle and invalidate only reviewed paths. Installed native apps cannot be instantly recalled: preserve API compatibility, use store rollback/update processes and keep ordering disabled if necessary. No EAS Update/OTA channel is configured or authorized.

Product revision is additive in menu responses, required for **existing** product saves. Deploy backend and staff together with a controlled staff-write pause; old clients fail closed rather than silently changing stock. No destructive migration is supplied. Existing versioned product rows need no backfill; inspect legacy imported row shape before enabling staff writes. QuoteToken requirements from the earlier COD batch still require matching customer/backend versions. Secret rotation invalidates outstanding quotes/OTPs; coordinate pause/reissue/recovery.

Cash-date indexing covers new collections only; historical backfill requires its own plan/reconciliation. New named-rider directory entries may require reviewed re-registration. Address recipient contacts must be collected when legacy addresses lack them. No TTL is added to idempotency abandonment markers.

Restore rehearsal: restore CORE/LEDGER/OPERATIONS from a mutually reviewed PITR time into **new** isolated tables; verify ledger/balance/stock/idempotency/order indexes together, reconcile any external cash actions, then plan guarded binding changes. Independent table PITR is not automatically a cross-table consistent restore; establish an operational write freeze/validation procedure and explicit RPO/RTO. Review state object version restore separately. Do not overwrite live tables, destroy durable roots, or blanket-delete state/customer data as a rollback.
