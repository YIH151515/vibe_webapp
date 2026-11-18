import assert from "node:assert/strict";
import { test } from "node:test";
import { readAuthConfig, type EntraConfig } from "../src/lib/server/auth-config";
import { beginLogin, finishLogin } from "../src/lib/server/auth-flow";
import { getOidcClient } from "../src/lib/server/oidc-client";
import { BoardError } from "../src/lib/server/errors";
import { startFakeOidcIssuer } from "./helpers/fake-oidc-issuer";
import { emptySqlFixture as sqlFixture } from "./helpers/sql-fixture";
const error = (status: number) => (value: unknown) => value instanceof BoardError && value.status === status;

test("JWT signature, audience, issuer, expiry, nonce and Member claims fail closed", async () => {
  const f = await sqlFixture(), config = readAuthConfig() as EntraConfig;
  try {
    for (const [actor, status] of [["guest", 403], ["missing-acct", 403], ["wrong-tenant", 403], ["bad-signature", 401],
      ["wrong-audience", 401], ["wrong-issuer", 401], ["expired", 401], ["future-iat", 401], ["wrong-nonce", 401], ["wrong-kid", 401], ["malformed-token", 401], ["unavailable", 503]] as const) {
      const start = await beginLogin(f.pool, config, undefined, "/");
      const consent = await fetch(start.authorizationUrl, { headers: { Cookie: "oidc_test_user=" + actor }, redirect: "manual" });
      assert.equal(consent.status, 302);
      await assert.rejects(finishLogin(f.pool, config, new URL(consent.headers.get("location")!), start.browserCookie), error(status), actor);
    }
    assert.equal((await f.pool.request().query("SELECT COUNT(*) n FROM dbo.auth_sessions")).recordset[0].n, 0);
    const start = await beginLogin(f.pool, config, undefined, "/");
    const consent = await fetch(start.authorizationUrl, { headers: { Cookie: "oidc_test_user=unknown-role" }, redirect: "manual" });
    assert.equal((await finishLogin(f.pool, config, new URL(consent.headers.get("location")!), start.browserCookie)).principal.isAdmin, false);
  } finally { await f.close(); }
});

test("discovery rejects non-JSON, foreign endpoints and redirects, then recovers its cache", async () => {
  const server = await startFakeOidcIssuer();
  const saved = { issuer: process.env.TEST_OIDC_ISSUER, client: process.env.TEST_OIDC_CLIENT_ID, secret: process.env.TEST_OIDC_CLIENT_SECRET };
  Object.assign(process.env, { TEST_OIDC_ISSUER: server.issuer, TEST_OIDC_CLIENT_ID: server.clientId, TEST_OIDC_CLIENT_SECRET: server.clientSecret });
  try {
    const config = readAuthConfig() as EntraConfig;
    for (const fault of ["malformed", "foreign-endpoint", "redirect"]) { server.setMetadataFault(fault); await assert.rejects(getOidcClient(config), error(503)); }
    server.setMetadataFault("none"); assert.ok(await getOidcClient(config));
  } finally {
    Object.assign(process.env, { TEST_OIDC_ISSUER: saved.issuer, TEST_OIDC_CLIENT_ID: saved.client, TEST_OIDC_CLIENT_SECRET: saved.secret }); await server.close();
  }
});
