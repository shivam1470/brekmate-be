# Current verification evidence

18 October 2026, Node v24.19.0. Counts below are from this review's logs, not copied historical passes. Suite counts overlap conceptual scenarios and must not be summed into “all features tested.” Source manifest records candidate identity. Raw logs are synthetic/local; no real customer identities or credentials were used.

| Command / check | Actual result | Layer / limitation |
|---|---|---|
| FE `npm ci` | Exit 0; 1,514 packages installed | Lockfile clean install; deprecation warnings retained |
| BE `npm ci` | Exit 0; 91 packages installed | Lockfile clean install |
| BE `npm run check` after clean install | Pass; 98 tests, typecheck, 41-route contract generation, Lambda/pricing build | In-memory transactional service, HTTP injected identities; Dynamo adapter command construction tests, not live DynamoDB |
| FE `npm run check` after clean install | Pass; lint, root/mobile typechecks, 50 unit/staff checks, 12 native component checks, staff production build, Android/iOS Hermes exports, fixture-boundary scan | Native component transport/OS mocked; exports are not APK/IPA; production-origin values not supplied, setup gates preserved |
| FE `npm run test:backend` | Seven contracts pass | Actual frontend client + Fastify/service in process, fixture auth + MemoryStore; includes product revision round trip |
| Quality `npm run test:local-product` | Nine catalogue/generator checks + 37,296 pricing contracts pass | Adapter imports real newly built BE pricing.mjs; 36,864 generated combinations +432 legacy boundaries; not 37k device journeys and not business-policy approval |
| IaC `python3 -m unittest discover -s tests -v` | 25 pass | Source/plan-policy fixtures and cross-repo route parity; not provider validation |
| IaC `tofu fmt -recursive -check` | Exit 0 | CLI1.12.6 checksum-verified; JSON/HCL formatting only |
| IaC `TOFU_BIN=... python3 scripts/check.py` | Blocked at AWS provider schema startup in bootstrap | Initial incomplete download files caused checksum mismatch; removed only temporary incomplete files. Re-init progressed; provider failed plugin handshake. No signature/checksum bypass. Staging/production schema validation and mock plans were not reached. |
| Real `tofu plan` | Not run | No AWS CLI/account credentials/allowed account inputs. No add/change/destroy counts claimed. |
| FE `npm run test:ui` | Five tests blocked/fail at missing browser launcher | Chromium install returned corrupt/truncated ZIPs. No browser scenario pass in this review. Prior five passing claims are not reused. |
| FE `npm audit --json` | 30 high,18 moderate,0 critical (48 propagated entries) | Gate remains open; three root advisories; no compatible patched root releases found in current registry checks |
| BE `npm audit --json` | 0 findings | Registry audit only; no guarantee of absence of vulnerabilities |
| Current-source secret pattern scan | 315 text files scanned;0 high-confidence AWS/GitHub-token/private-key pattern hits | Limited pattern scan excludes dependencies/builds/provider caches. No upstream history available; cannot claim full secret clearance. Build fixture-boundary scan is separate. |
| Quality `npm run readiness` | Exit1 by design | Its generic foundation report still says zero product executions; use this measured report for current arithmetic evidence. No false full-release readiness was set. |
| BE `python3 scripts/package.py` | Exit0; current Lambda ZIP produced | No upload or deployment; SHA recorded in artifacts/checksums.json and release manifest |
| Signed/device/live tests | Not run | No APK/AAB/IPA, TestFlight, emulator/device, Cognito/JWKS service, AWS transaction races, restore, load or real GitHub Actions execution verified |

## TDD evidence for meaningful fixes

- `polling-red.log`: delivery and pickup delivered/unpaid tests failed because no15s interval existed. `polling-green.log` passes the initial four focused cases; `native-final.log` and final clean-check run add timer/background/resume coverage (six new polling/terminal cases;12 native cases total). An intermediate test incorrectly used Jest's property replacement against Expo's mocked function; the mock setup was corrected and final suite rerun. No intermediate failure is presented as product evidence.
- `rider-red.log`: three tests failed with missing expected rejection for inactive riders; `rider-green.log` passes. Final98-test suite includes them. Active rider is included in transactional reads so a competing deactivation conflicts/retries before mutation/replay.
- `stock-red.log`: unversioned stale save was accepted; new revision contract was missing. `stock-green.log` passes three fresh/stale/concurrent cases. Existing reprice tests now explicitly submit the latest version; frontend staff and cross-repo contract checks cover the new field/error message.
- `booking-config-red.log`: four missing explicit settings failed expected-rejection checks. `booking-config-green.log` passes all six policy-configuration cases. No schedule value was invented.
- IaC `infra-integration-red.log`: missing runtime variable, OTP-secret wiring and route example. `infra-integration-green.log` passes24 checks after integration. `infra-csp-red.log` fails for missing CSP; `infra-csp-green.log` and final suite pass25 checks after exact-origin CSP. Provider/live verification remains blocked.

Early quality invocation used the wrong environment variable name for the legacy pricing adapter and intentionally failed. The new `test:local-product` command builds the actual backend and supplies both canonical adapter variables, removing this manual setup ambiguity. The current run has no skipped or failed arithmetic vectors.

## Evidence locations in the delivered source bundle

- FE/BE: `docs/release-2026-10-18/` logs plus repo-local six review records.
- Quality/infra: same review folder with the applicable evidence copies.
- Central `review/evidence/`: raw audits, source comparison, regional prices, IaC/provider/browser limitations and source-only secret-scan summary.
- `review/patches/`: changes against the compared baseline, to check against actual upstream after access is restored.

Prepared an explicit `testflight` store-distribution profile with staging APP_VARIANT and preview EAS environment; JSON/config inspection only, not an EAS build or signing check.

No claim is made of complete scenario coverage, production readiness, successful native installation or live staging acceptance.
