# COD batch 1 update

Initial release is COD only. Read ../brekmate-fe/docs/COD_BATCH_REVIEW.md from this folder for implemented work, migration and remaining release gates. Deploy matching frontend/backend versions: COD now requires a server quote token. Merge the generated 41-route map. Configure actual PICKUP_ADDRESS. Do not enable live orders or mark production-ready.

# Continue development from this folder

Read README.md, docs/RELEASE_GATES.md, docs/ARCHITECTURE.md and integration/README.md before editing. This is an executable COD core, not a complete production backend. Do not report online payments, refunds, provider messaging, AWS integration or native E2E as complete.

Use Node24, npm ci, npm run check. Preserve the actual pricing service behind adapters/quality.mjs. If the earlier quality workspace is adjacent, run:

```bash
BREKMATE_TEST_ADAPTER="$(pwd)/adapters/quality.mjs" \
BREKMATE_BASKET_ADAPTER="$(pwd)/adapters/quality.mjs" \
npm run test:product --prefix ../brekmate-drive-workspace
```

The quality folder may have a different checkout name; use its actual path. Arithmetic vectors are not native E2E coverage. Preserve every counterexample as a meaningful regression test.

Follow TDD for each remaining behavior: write a failing test with a realistic state/actor/provider event, run it and record the expected failure, implement the smallest safe change, run the impacted suite, then refactor. Prioritize payment/refund/identity/authorization/persistence boundaries over inflating test count. Do not copy fixture oracles into adapters or call real payment/message providers in deterministic tests.

Choose the next task from the release gates with the owner. Provider choice and unresolved business policies need decisions; routine implementation does not need repeated permission. Keep online payments unavailable until the complete provider lifecycle is implemented and sandbox verified. Do not silently enable approval flags or invent tax/refund rules.

Keep user-facing code and credentials separate. Do not put real credentials/customer data in source, fixtures, Drive, logs or IaC state. The local fixture-token server is not deployable authentication. Lambda must keep its fail-closed configuration and real Cognito verifier. Review every role/ownership boundary before idempotent response replay.

The IaC patch is supplied, not applied to the earlier Drive infra folder. Review/apply it in the infra checkout, run required IaC checks and inspect a plan. No deployment, secret provisioning or GitHub push occurred in this session. CI configuration is included but has not run on GitHub; pin third-party actions to reviewed immutable SHAs before production.
