import { loadOtpPepper } from "./secrets.js";
import awsLambdaFastify from "@fastify/aws-lambda";
import { runtimeConfig } from "./config.js";
import { DynamoStore } from "./dynamo.js";
import { CognitoAuth } from "./auth.js";
import { Service } from "./service.js";
import { createApp } from "./app.js";
const { values: v, config } = runtimeConfig();
config.otpPepper = await loadOtpPepper(v.OTP_SECRET_ARN);
const app = createApp(
  new Service(
    new DynamoStore({
      core: v.CORE_TABLE,
      ledger: v.LEDGER_TABLE,
      operations: v.OPERATIONS_TABLE,
    }),
    config,
  ),
  new CognitoAuth(
    v.CUSTOMER_ISSUER,
    v.CUSTOMER_CLIENT_ID,
    v.STAFF_ISSUER,
    v.STAFF_CLIENT_ID,
  ),
);
export const handler = awsLambdaFastify(app);
await app.ready();
