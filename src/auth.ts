import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { Fault, requireThat } from "./errors.js";
import type { Actor } from "./service.js";
export const roles = ["OWNER", "MANAGER", "OPERATOR", "KITCHEN", "RIDER"];
export interface Authenticator {
  authenticate(header: string | undefined): Promise<Actor>;
}
export function claimsActor(
  payload: JWTPayload,
  kind: "customer" | "staff",
  clientId: string,
): Actor {
  requireThat(
    payload.token_use === "access" &&
      payload.client_id === clientId &&
      typeof payload.sub === "string" &&
      /^[a-zA-Z0-9-]{1,100}$/.test(payload.sub),
    "invalid_token",
    401,
  );
  const groups = payload["cognito:groups"];
  return {
    kind,
    id: payload.sub,
    roles:
      kind === "staff" && Array.isArray(groups)
        ? groups.filter(
            (r): r is string => typeof r === "string" && roles.includes(r),
          )
        : [],
  };
}
export class CognitoAuth implements Authenticator {
  private pools;
  constructor(
    customerIssuer: string,
    customerClient: string,
    staffIssuer: string,
    staffClient: string,
  ) {
    for (const issuer of [customerIssuer, staffIssuer])
      requireThat(
        /^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[a-zA-Z0-9_-]+$/.test(
          issuer,
        ),
        "invalid_cognito_issuer",
        500,
      );
    this.pools = [
      {
        kind: "customer" as const,
        issuer: customerIssuer,
        client: customerClient,
        jwks: createRemoteJWKSet(
          new URL(customerIssuer + "/.well-known/jwks.json"),
        ),
      },
      {
        kind: "staff" as const,
        issuer: staffIssuer,
        client: staffClient,
        jwks: createRemoteJWKSet(
          new URL(staffIssuer + "/.well-known/jwks.json"),
        ),
      },
    ];
  }
  async authenticate(header: string | undefined) {
    requireThat(header?.startsWith("Bearer "), "authentication_required", 401);
    const token = header!.slice(7);
    requireThat(token.length <= 12000, "invalid_token", 401);
    for (const pool of this.pools) {
      try {
        const { payload } = await jwtVerify(token, pool.jwks, {
          issuer: pool.issuer,
          algorithms: ["RS256"],
          requiredClaims: ["exp", "iat", "sub", "token_use", "client_id"],
          clockTolerance: 5,
        });
        return claimsActor(payload, pool.kind, pool.client);
      } catch {
        /* Try only the configured, fixed issuers. Never use untrusted issuer URLs. */
      }
    }
    throw new Fault(401, "invalid_token");
  }
}
