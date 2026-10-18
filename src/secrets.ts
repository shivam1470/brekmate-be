import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import { z } from "zod";
export async function loadOtpPepper(arn: string) {
  const result = await new SecretsManagerClient({}).send(
    new GetSecretValueCommand({ SecretId: arn }),
  );
  if (!result.SecretString) throw new Error("Delivery OTP secret is missing");
  const decoded = z
    .object({ pepper: z.string().min(32).max(512) })
    .strict()
    .parse(JSON.parse(result.SecretString));
  return decoded.pepper;
}
