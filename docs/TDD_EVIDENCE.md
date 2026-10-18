# Recorded regression cycle

The test `idempotent replay cannot bypass a staff role downgrade` was introduced during the security review before its fix. It executed an accepted-order operation as a manager, then retried the identical request/key after that same identity had only the KITCHEN role.

Red result: `AssertionError: Missing expected rejection.` The earlier response replay happened before the transaction callback's role check.

Fix: validate current order access and allowed target actions before looking up the stored idempotency response. Keep state-dependent transitions within the atomic callback so legitimate retries can still replay a successful terminal transition.

Green result: the regression and all 71 backend tests pass. Continue the same failing-test, implementation, regression cycle for unfinished release gates. This is recorded evidence of that cycle, not a claim that every artifact was produced under a fully audited TDD history.
