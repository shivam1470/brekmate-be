# Cost estimate and controls — checked 18 October 2026

No AWS account access is verified: AWS CLI is absent, credential environment indicators are absent and no shared credentials file exists here. Actual Free Tier/credit eligibility, account age, existing usage, quotas, balance and expiry **could not be checked**. Estimate below deducts no credits or free allowances. No service was enabled or purchased.

Current official Mumbai catalog extracts are saved with publication dates, SKUs and units in `current-regional-pricing.json` (seven service catalogs re-fetched during this review). These are public price data, not an account bill. Use current account-region quotes before any apply.

| Item | Illustrative monthly sizing, per retained environment | Rate / estimate USD |
|---|---|---|
| HTTP API | 60,000 requests, excluding extra browsing/polling | $1.05/million → $0.063 |
| Lambda ARM | 60,000 × 250 ms × 0.25 GB; requests additional | $0.20/million + $0.0000133334/GB-s → $0.062 |
| DynamoDB standard requests | 600,000 WRUs + 1,200,000 RRUs, already budgeted as capacity units rather than operations | $0.71/million WRUs + $0.1425/million RRUs → $0.597; transaction reads/writes and item sizes must be measured |
| DynamoDB storage/PITR | 1 GB combined table data; 1 GB protected data | Paid storage ~$0.285 + PITR $0.228 → $0.513 before allowances; GSI/restore/on-demand backup costs additional |
| Secrets | Three secret containers after runtime integration | $0.40/secret-month → $1.20; two payment containers are currently unused; evaluate optional creation only after inspecting actual state |
| Secret reads | 10,000 cold-start reads allowance | $0.05; warm reuse reduces this, cold starts not measured |
| Logs | 1 GB standard ingest + 0.25 GB-month retained | $0.67/GB ingest + $0.03/GB-month storage → ~$0.678; queries/exports additional |
| Alarms | Two standard Lambda error/throttle alarms | $0.10/alarm-metric-month → $0.20; optional worker adds alarms/resources |
| Cognito Lite | 1,000 active users, no free allowance deducted | $0.0055/MAU → $5.50; existing account allowances can change the bill |
| S3/state/staff assets | 1 GB standard storage + illustrative 10,000 writes / 100,000 reads | $0.025 storage + $0.05 writes + $0.04 reads ≈ $0.115; noncurrent versions/locks/build retention add usage |

These modeled items sum to approximately **$9 per environment/month** before CloudFront requests, outbound transfer, SES/email/auth communications, SNS/budget usage, restore operations, build services and taxes. This is a sizing example, not a measured workload or spending cap. Both staging and production retained together would roughly double modeled baselines; staging without Lambda/web still retains data, identities and secrets.

Proposed planning allowance: **$25–50/month combined AWS staging + pilot production**, subject to a real plan and account calculator review. This is an engineering reserve, not an official all-in quote. More users, frequent polling, logs or images can exceed it. Use a tagged project/environment budget plus account-wide alert for untagged charges. Budgets alert; they do not enforce a hard cap. Review 7-day staging / 30-day production log retention in the source and lower retention only under approved data policies. No NAT, EC2, RDS, ALB, provisioned capacity or optional worker is needed for this COD candidate.

External costs and prerequisites:

- Google Play registration: **US$25 one-time**, verification/testing requirements also apply.
- Apple Developer Program: **US$99/year**, local currency and eligibility can differ. No membership verified.
- EAS has a free tier and paid/usage-based build options. No Expo account quota or paid plan is verified; inspect remaining quotas and estimate the selected builder before approving any build. Local iOS signing requires a suitable Mac/Xcode; no access to the user's Mac is claimed.
- Current login implementation uses email/SRP and staff TOTP, not SMS login. Delivery OTP is displayed in-app. SMS/WhatsApp/provider delivery fees are excluded, not assumed free; enabling providers is a separate scope/cost approval. Photo sharing is manual.
- Domain, app-store assets, hardware/device access, email sender configuration, staff operating time, tax and currency conversion are outside this estimate.

AWS's public new-customer offering advertises up to $200 credits and a six-month free plan. That does **not** establish this account's eligibility or production suitability. Billing/credits/expiry must be inspected by the account operator before apply; do not create another account to assume eligibility.

Official sources checked:

- https://aws.amazon.com/lambda/pricing/ and https://aws.amazon.com/api-gateway/pricing/
- https://aws.amazon.com/dynamodb/pricing/ and https://aws.amazon.com/secrets-manager/pricing/
- https://aws.amazon.com/cloudwatch/pricing/ and https://aws.amazon.com/cognito/pricing/
- https://aws.amazon.com/s3/pricing/ and https://aws.amazon.com/cloudfront/pricing/
- https://aws.amazon.com/free/
- Regional catalogs: `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<service>/current/ap-south-1/index.json` (exact source per retained extract)
- https://expo.dev/pricing
- https://developer.apple.com/programs/enroll/
- https://support.google.com/googleplay/android-developer/answer/6112435
