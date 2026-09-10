// Capability probe behind the shared authentication contract. Reproduces the
// evidence in ../auth-probe-evidence.md against the exact pinned packages.
//
// Invocation: npm ci && node probe.mjs
// Requires Docker. Starts its own throwaway PostgreSQL container on port
// 55439, runs every scenario against the in-process Better Auth handler over
// loopback Request objects, prints one JSON result per scenario, and removes
// the container on exit. No secret leaves the process: client secrets and
// tokens exist for one run and are never printed.
import { execFileSync } from "node:child_process";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { jwt } from "better-auth/plugins";
import { oauthDeviceAuthorization, oauthProvider } from "@better-auth/oauth-provider";
import pg from "pg";
import { Kysely, PostgresDialect } from "kysely";

const IMAGE =
  "postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73";
const CONTAINER = "dsg-auth-probe-postgres";
const PORT = 55439;
const CONN = `postgres://probe:probe@127.0.0.1:${PORT}/probe`;
const BASE = "http://127.0.0.1:3999";
const RESOURCE = "https://probe.invalid/api";

const results = [];
const record = (scenario, facts) => {
  results.push({ scenario, ...facts });
  console.log(JSON.stringify({ scenario, ...facts }));
};

const docker = (args) => execFileSync("docker", args, { encoding: "utf8" }).trim();

const startDatabase = () => {
  try {
    docker(["rm", "-f", CONTAINER]);
  } catch {
    // No prior container; nothing to remove.
  }
  docker([
    "run",
    "-d",
    "--name",
    CONTAINER,
    "-e",
    "POSTGRES_USER=probe",
    "-e",
    "POSTGRES_PASSWORD=probe",
    "-e",
    "POSTGRES_DB=probe",
    "-p",
    `${PORT}:5432`,
    IMAGE,
  ]);
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      docker(["exec", CONTAINER, "pg_isready", "-U", "probe"]);
      return;
    } catch {
      if (Date.now() > deadline) throw new Error("probe database never became ready");
      execFileSync("sleep", ["1"]);
    }
  }
};

startDatabase();
try {
  const db = new Kysely({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: CONN }) }),
  });
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const auth = betterAuth({
    appName: "probe",
    baseURL: `${BASE}/auth`,
    basePath: "/auth",
    secret,
    database: { db, type: "postgres", casing: "snake", transaction: true },
    emailAndPassword: { enabled: true },
    plugins: [
      jwt(),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        scopes: ["openid", "profile", "offline_access", "api:read"],
        resources: [RESOURCE],
        // The contract wires this hook to the kernel's recorded admin
        // authority. The probe passes everyone to observe library behavior.
        clientPrivileges: async () => true,
      }),
      oauthDeviceAuthorization(),
    ],
  });
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  record("migrations", { ok: true });

  const call = async (method, path, body, headers = {}) => {
    const res = await auth.handler(
      new Request(`${BASE}/auth${path}`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body:
          body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 120) };
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  // Admin endpoints are server-only: the HTTP handler does not route them
  // (404), so administration goes through auth.api with a session's headers.
  const api = async (fn, body, headers = {}) => {
    try {
      const out = await auth.api[fn]({ headers: new Headers(headers), body });
      return { status: 200, body: out };
    } catch (e) {
      return {
        status: e.status === "UNAUTHORIZED" ? 401 : (e.statusCode ?? 400),
        body: e.body ?? { error: String(e.message).slice(0, 120) },
      };
    }
  };
  const linkResource = async (clientId, headers) => {
    try {
      return await auth.api.adminLinkClientResource({
        headers: new Headers(headers),
        params: { identifier: RESOURCE, client_id: clientId },
      });
    } catch (e) {
      return { linked: false, error: String(e.message).slice(0, 120) };
    }
  };
  const form = (params) => new URLSearchParams(params).toString();
  const FORM = { "content-type": "application/x-www-form-urlencoded" };
  const claims = (jwtToken) =>
    JSON.parse(Buffer.from(jwtToken.split(".")[1], "base64url").toString());

  // --- People -------------------------------------------------------------
  const signUp = await call("POST", "/sign-up/email", {
    email: "admin@probe.invalid",
    password: "probe-password-1",
    name: "Probe Admin",
  });
  const cookie = signUp.headers.get("set-cookie")?.split(";")[0];
  record("sign-up", { status: signUp.status, sessionCookie: cookie ? "set" : "missing" });

  // Resource rows exist independently; a client's `resources` array at
  // creation references them, and the link makes the grant possible.
  const resource = await api(
    "adminCreateOAuthResource",
    { identifier: RESOURCE, name: "probe-api" },
    { cookie },
  );
  record("resource.create", { status: resource.status });

  // --- Machine client: client_credentials ---------------------------------
  const machine = await api(
    "adminCreateOAuthClient",
    {
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["client_credentials"],
      client_credentials_scopes: ["api:read"],
      resources: [RESOURCE],
      client_name: "probe-service",
    },
    { cookie },
  );
  const machineId = machine.body?.client_id;
  const machineSecret = machine.body?.client_secret;
  record("machine-client.create", { status: machine.status, client_id: machineId ?? null });
  record("machine-client.link-resource", { result: await linkResource(machineId, { cookie }) });
  const machineBasic = Buffer.from(`${machineId}:${machineSecret}`).toString("base64");

  const machineToken = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", resource: RESOURCE }),
    { authorization: `Basic ${machineBasic}`, ...FORM },
  );
  const machineJwt = machineToken.body?.access_token;
  record("machine-client.token", {
    status: machineToken.status,
    kind: machineJwt?.split(".").length === 3 ? "JWT" : "opaque",
    expires_in: machineToken.body?.expires_in ?? null,
    claims: machineJwt
      ? {
          sub: claims(machineJwt).sub ?? null,
          aud: claims(machineJwt).aud,
          scope: claims(machineJwt).scope ?? null,
          iss: claims(machineJwt).iss,
          sid: claims(machineJwt).sid ?? null,
        }
      : null,
  });

  const overCeiling = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", scope: "api:write", resource: RESOURCE }),
    { authorization: `Basic ${machineBasic}`, ...FORM },
  );
  record("machine-client.over-ceiling-scope", {
    status: overCeiling.status,
    error: overCeiling.body?.error ?? null,
  });

  const unlinkedResource = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", resource: "https://other.invalid/api" }),
    { authorization: `Basic ${machineBasic}`, ...FORM },
  );
  record("machine-client.unlinked-resource", {
    status: unlinkedResource.status,
    error: unlinkedResource.body?.error ?? null,
  });

  const introMachine = await call("POST", "/oauth2/introspect", form({ token: machineJwt }), {
    authorization: `Basic ${machineBasic}`,
    ...FORM,
  });
  record("machine-client.introspect", {
    status: introMachine.status,
    active: introMachine.body?.active ?? null,
  });

  // Disablement: the 1.7.4 admin update schema has no disabled field. An
  // update carrying one is silently dropped (zod $strip), so this scenario
  // records that gap, then exercises deletion as the real cutoff.
  const disable = await api(
    "adminUpdateOAuthClient",
    { client_id: machineId, update: { disabled: true } },
    { cookie },
  );
  const introDisabled = await call("POST", "/oauth2/introspect", form({ token: machineJwt }), {
    authorization: `Basic ${machineBasic}`,
    ...FORM,
  });
  const tokenDisabled = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", resource: RESOURCE }),
    { authorization: `Basic ${machineBasic}`, ...FORM },
  );
  record("machine-client.disable-attempt", {
    update_status: disable.status,
    introspect_active: introDisabled.body?.active ?? null,
    new_token_status: tokenDisabled.status,
    note: "the update schema strips an unknown disabled field; the client stays live",
  });
  const machine2 = await api(
    "adminCreateOAuthClient",
    {
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["client_credentials"],
      client_credentials_scopes: ["api:read"],
      resources: [RESOURCE],
      client_name: "probe-service-2",
    },
    { cookie },
  );
  const machineId2 = machine2.body?.client_id;
  const machineSecret2 = machine2.body?.client_secret;
  await linkResource(machineId2, { cookie });
  const machineBasic2 = Buffer.from(`${machineId2}:${machineSecret2}`).toString("base64");
  const deleted = await api("deleteOAuthClient", { client_id: machineId }, { cookie });
  const introDeleted = await call("POST", "/oauth2/introspect", form({ token: machineJwt }), {
    authorization: `Basic ${machineBasic2}`,
    ...FORM,
  });
  const tokenDeleted = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", resource: RESOURCE }),
    { authorization: `Basic ${machineBasic}`, ...FORM },
  );
  record("machine-client.deleted", {
    delete_status: deleted.status,
    introspect_status: introDeleted.status,
    introspect_active: introDeleted.body?.active ?? null,
    new_token_status: tokenDeleted.status,
    new_token_error: tokenDeleted.body?.error ?? null,
  });

  // Secret rotation: the old secret stops authenticating.
  const rotate = await api("rotateClientSecret", { client_id: machineId2 }, { cookie });
  const machineBasicCurrent = Buffer.from(
    `${machineId2}:${rotate.body?.clientSecret ?? rotate.body?.client_secret}`,
  ).toString("base64");
  const oldSecretAfterRotate = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", resource: RESOURCE }),
    { authorization: `Basic ${machineBasic2}`, ...FORM },
  );
  record("machine-client.rotate-secret", {
    rotate_status: rotate.status,
    rotate_keys: Object.keys(rotate.body ?? {}),
    old_secret_token_status: oldSecretAfterRotate.status,
    old_secret_error: oldSecretAfterRotate.body?.error ?? null,
  });

  const freshCookie = async () => {
    const su = await call("POST", "/sign-in/email", {
      email: "admin@probe.invalid",
      password: "probe-password-1",
    });
    return su.headers.get("set-cookie")?.split(";")[0];
  };

  // --- Device grant: user token bound to a session -------------------------
  const pkceClientEarly = await api(
    "adminCreateOAuthClient",
    {
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      application_type: "native",
      redirect_uris: ["http://127.0.0.1:5377/callback"],
      resources: [RESOURCE],
      client_name: "probe-desktop",
    },
    { cookie },
  );
  const pkceClientIdEarly = pkceClientEarly.body?.client_id;
  record("pkce-client.create", {
    status: pkceClientEarly.status,
    client_id: pkceClientIdEarly ?? null,
  });
  record("pkce-client.link-resource", {
    result: await linkResource(pkceClientIdEarly, { cookie }),
  });

  const deviceClient = await api(
    "adminCreateOAuthClient",
    {
      token_endpoint_auth_method: "none",
      grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
      application_type: "native",
      resources: [RESOURCE],
      client_name: "probe-cli",
    },
    { cookie },
  );
  const deviceClientId = deviceClient.body?.client_id;
  record("device-client.create", {
    status: deviceClient.status,
    client_id: deviceClientId ?? null,
  });
  record("device-client.link-resource", { result: await linkResource(deviceClientId, { cookie }) });

  const deviceFlow = async (flowCookie) => {
    const dc = await call(
      "POST",
      "/device/code",
      form({
        client_id: deviceClientId,
        scope: "openid offline_access api:read",
        resource: RESOURCE,
      }),
      FORM,
    );
    const userCode = dc.body?.user_code;
    const deviceCode = dc.body?.device_code;
    const poll = () =>
      call(
        "POST",
        "/oauth2/token",
        form({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: deviceClientId,
        }),
        FORM,
      );
    const before = await poll();
    const claim = await call("GET", `/device?user_code=${userCode}`, undefined, {
      cookie: flowCookie,
      origin: BASE,
    });
    const approve = await call(
      "POST",
      "/device/approve",
      { userCode },
      { cookie: flowCookie, origin: BASE },
    );
    await new Promise((resolve) => setTimeout(resolve, (dc.body?.interval ?? 5) * 1000 + 500));
    const after = await poll();
    if (approve.status !== 200 || after.status !== 200) {
      console.log(
        JSON.stringify({ scenario: "device.flow-error", approve: approve.body, token: after.body }),
      );
    }
    return {
      issue_status: dc.status,
      verification_uri: dc.body?.verification_uri ?? null,
      poll_before: { status: before.status, error: before.body?.error ?? null },
      claim_status: claim.status,
      approve_status: approve.status,
      token: after,
    };
  };

  const device1 = await deviceFlow(cookie);
  const deviceJwt = device1.token.body?.access_token;
  record("device.flow", {
    issue_status: device1.issue_status,
    verification_uri: device1.verification_uri,
    poll_before: device1.poll_before,
    claim_status: device1.claim_status,
    approve_status: device1.approve_status,
    token_status: device1.token.status,
    has_refresh: Boolean(device1.token.body?.refresh_token),
  });
  record(
    "device.token-claims",
    deviceJwt
      ? {
          kind: deviceJwt.split(".").length === 3 ? "JWT" : "opaque",
          sub: claims(deviceJwt).sub ?? null,
          aud: claims(deviceJwt).aud,
          scope: claims(deviceJwt).scope ?? null,
          iss: claims(deviceJwt).iss,
          sid: claims(deviceJwt).sid ?? null,
        }
      : { kind: "none" },
  );

  // The machine client introspects the user token: authorized because the
  // machine client is linked to the token's audience resource.
  const introDevice = await call("POST", "/oauth2/introspect", form({ token: deviceJwt }), {
    authorization: `Basic ${machineBasicCurrent}`,
    ...FORM,
  });
  record("device.introspect-by-service", {
    status: introDevice.status,
    active: introDevice.body?.active ?? null,
    scope: introDevice.body?.scope ?? null,
  });

  // Session termination: sign out the approving session, introspect again.
  // The JWT's own exp is still minutes out; this separates offline validity
  // from online acceptance.
  const signOut = await call("POST", "/sign-out", {}, { cookie, origin: BASE });
  const introAfterSignOut = await call("POST", "/oauth2/introspect", form({ token: deviceJwt }), {
    authorization: `Basic ${machineBasicCurrent}`,
    ...FORM,
  });
  record("device.session-terminated", {
    sign_out_status: signOut.status,
    introspect_active: introAfterSignOut.body?.active ?? null,
    jwt_exp_seconds_out: deviceJwt ? claims(deviceJwt).exp - Math.floor(Date.now() / 1000) : null,
  });

  // Refresh-token revocation: does the access token's introspection change?
  const device2 = await deviceFlow(await freshCookie());
  const refresh2 = device2.token.body?.refresh_token;
  const access2 = device2.token.body?.access_token;
  const revokeRefresh = await call(
    "POST",
    "/oauth2/revoke",
    form({ token: refresh2, client_id: deviceClientId }),
    FORM,
  );
  const reuseRevoked = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "refresh_token", refresh_token: refresh2, client_id: deviceClientId }),
    FORM,
  );
  const introAccessAfterRefreshRevoke = await call(
    "POST",
    "/oauth2/introspect",
    form({ token: access2 }),
    { authorization: `Basic ${machineBasicCurrent}`, ...FORM },
  );
  record("device.refresh-revoked", {
    revoke_status: revokeRefresh.status,
    reuse_status: reuseRevoked.status,
    reuse_error: reuseRevoked.body?.error ?? null,
    access_introspect_active: introAccessAfterRefreshRevoke.body?.active ?? null,
  });

  // Direct JWT revocation is refused: self-contained tokens are not stored.
  const revokeJwt = await call(
    "POST",
    "/oauth2/revoke",
    form({ token: access2, token_type_hint: "access_token", client_id: deviceClientId }),
    FORM,
  );
  record("device.revoke-jwt-direct", {
    status: revokeJwt.status,
    error: revokeJwt.body?.error ?? null,
  });

  // --- PKCE: authorization code for a native public client -----------------
  const pkceClientId = pkceClientIdEarly;

  const pkceCookie = await freshCookie();

  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", Buffer.from(verifier)),
  ).toString("base64url");
  const authorizeQuery = new URLSearchParams({
    response_type: "code",
    client_id: pkceClientId,
    redirect_uri: "http://127.0.0.1:5377/callback",
    scope: "openid offline_access api:read",
    resource: RESOURCE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "probe-state",
  }).toString();
  const authorize = await auth.handler(
    new Request(`${BASE}/auth/oauth2/authorize?${authorizeQuery}`, {
      headers: { cookie: pkceCookie },
      redirect: "manual",
    }),
  );
  const authorizeLocation = authorize.headers.get("location") ?? "";
  record("pkce.authorize", {
    status: authorize.status,
    location_kind: authorizeLocation.includes("/consent")
      ? "consent"
      : authorizeLocation.includes("code=")
        ? "code"
        : "other",
  });

  let code = new URL(authorizeLocation, BASE).searchParams.get("code");
  if (!code && authorizeLocation.includes("/consent")) {
    const consent = await call(
      "POST",
      "/oauth2/consent",
      { accept: true, oauth_query: new URL(authorizeLocation, BASE).search },
      { cookie: pkceCookie, origin: BASE },
    );
    const redirectUri = consent.body?.redirect_uri ?? consent.body?.url ?? "";
    code = redirectUri ? new URL(redirectUri, BASE).searchParams.get("code") : null;
    record("pkce.consent", { status: consent.status, code_issued: Boolean(code) });
  }

  if (code) {
    const exchange = await call(
      "POST",
      "/oauth2/token",
      form({
        grant_type: "authorization_code",
        code,
        redirect_uri: "http://127.0.0.1:5377/callback",
        client_id: pkceClientId,
        code_verifier: verifier,
      }),
      FORM,
    );
    const pkceJwt = exchange.body?.access_token;
    record("pkce.exchange", {
      status: exchange.status,
      has_refresh: Boolean(exchange.body?.refresh_token),
      claims: pkceJwt
        ? {
            sub: claims(pkceJwt).sub ?? null,
            aud: claims(pkceJwt).aud,
            scope: claims(pkceJwt).scope ?? null,
            sid: claims(pkceJwt).sid ?? null,
          }
        : null,
    });
    const introPkce = await call("POST", "/oauth2/introspect", form({ token: pkceJwt }), {
      authorization: `Basic ${machineBasicCurrent}`,
      ...FORM,
    });
    await call("POST", "/sign-out", {}, { cookie: pkceCookie, origin: BASE });
    const introPkceAfter = await call("POST", "/oauth2/introspect", form({ token: pkceJwt }), {
      authorization: `Basic ${machineBasicCurrent}`,
      ...FORM,
    });
    record("pkce.session-terminated", {
      before_status: introPkce.status,
      introspect_before: introPkce.body?.active ?? null,
      before_error: introPkce.body?.error ?? null,
      after_status: introPkceAfter.status,
      introspect_after: introPkceAfter.body?.active ?? null,
    });

    // Adversarial: a second code exchanged with the wrong verifier.
    const authorize2 = await auth.handler(
      new Request(`${BASE}/auth/oauth2/authorize?${authorizeQuery}`, {
        headers: { cookie: await freshCookie() },
        redirect: "manual",
      }),
    );
    const location2 = authorize2.headers.get("location") ?? "";
    let code2 = new URL(location2, BASE).searchParams.get("code");
    if (!code2 && location2.includes("/consent")) {
      const consent2 = await call(
        "POST",
        "/oauth2/consent",
        { accept: true, oauth_query: new URL(location2, BASE).search },
        { cookie: pkceCookie, origin: BASE },
      );
      const redirect2 = consent2.body?.redirect_uri ?? consent2.body?.url ?? "";
      code2 = redirect2 ? new URL(redirect2, BASE).searchParams.get("code") : null;
    }
    const wrongExchange = await call(
      "POST",
      "/oauth2/token",
      form({
        grant_type: "authorization_code",
        code: code2 ?? "none",
        redirect_uri: "http://127.0.0.1:5377/callback",
        client_id: pkceClientId,
        code_verifier: "wrong-verifier",
      }),
      FORM,
    );
    record("pkce.wrong-verifier", {
      status: wrongExchange.status,
      error: wrongExchange.body?.error ?? null,
    });
  }

  // --- Session cookie validation fails closed -------------------------------
  const bogus = await call("GET", "/get-session", undefined, {
    cookie: "better-auth.session_token=fabricated",
  });
  record("session.bogus-cookie", {
    status: bogus.status,
    session: bogus.body === null ? "null" : "unexpected",
  });

  await db.destroy();
} finally {
  try {
    docker(["rm", "-f", CONTAINER]);
  } catch {
    // Teardown failure leaves a clearly-named throwaway container.
  }
}
record("teardown", { container_removed: true });
