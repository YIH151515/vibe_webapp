import { createHash } from "node:crypto";
import * as oidc from "openid-client";
import { assertTestOidc, authUnavailable, type EntraConfig } from "./auth-config";

const clients = new Map<string, Promise<oidc.Configuration>>();
export async function getOidcClient(config: EntraConfig): Promise<oidc.Configuration> {
  const test = process.env.APP_TEST_MODE === "1";
  if (test) { assertTestOidc(process.env); if (config.issuer !== process.env.TEST_OIDC_ISSUER) throw authUnavailable(); }
  else if (config.issuer !== `https://login.microsoftonline.com/${config.tenantId}/v2.0`) throw authUnavailable();
  const expectedOrigin = new URL(config.issuer).origin;
  const key = createHash("sha256").update(JSON.stringify([config.issuer, config.clientId, config.clientSecret])).digest("hex");
  let pending = clients.get(key);
  if (!pending) {
    const execute = [oidc.enableNonRepudiationChecks, ...(test ? [oidc.allowInsecureRequests] : [])];
    const guardedFetch: oidc.CustomFetch = async (input, options) => {
      const url = new URL(input);
      if (url.origin !== expectedOrigin || url.username || url.password || url.hash) throw authUnavailable();
      const body = options.body instanceof Uint8Array ? Uint8Array.from(options.body) : options.body;
      const response = await fetch(url, { ...options, body, redirect: "manual", signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
      if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw authUnavailable(); }
      if (response.status >= 500) { await response.body?.cancel(); throw authUnavailable(); }
      return response;
    };
    pending = oidc.discovery(new URL(config.issuer), config.clientId, { client_secret: config.clientSecret, id_token_signed_response_alg: "RS256" },
      oidc.ClientSecretPost(config.clientSecret), { execute, timeout: 10, [oidc.customFetch]: guardedFetch }).then(client => {
        const metadata = client.serverMetadata();
        for (const endpoint of [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri]) {
          if (!endpoint || new URL(endpoint).origin !== expectedOrigin || new URL(endpoint).username || new URL(endpoint).password) throw authUnavailable();
        }
        return client;
      }).catch(() => { clients.delete(key); throw authUnavailable(); });
    if (clients.size >= 16) clients.delete(clients.keys().next().value!);
    clients.set(key, pending);
  }
  return pending;
}
