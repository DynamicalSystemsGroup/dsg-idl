// Capability probe behind the shared authentication contract.
//
// Invocation: npm ci && node probe.mjs
//
// Requires Docker. Starts its own PostgreSQL container under a unique name on
// an ephemeral loopback port, runs every scenario over the in-process Better
// Auth handler, asserts each expected result, prints one JSON line per
// scenario, and removes only the container it created. Exits non-zero if any
// assertion fails or any required scenario did not run. No token, secret or
// response body is printed: client secrets and tokens live for one run.
import { execFileSync } from "node:child_process";
import http from "node:http";
import { APIError, createAuthEndpoint, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { jwt } from "better-auth/plugins";
import {
  getOAuthProviderApi,
  oauthDeviceAuthorization,
  oauthProvider,
} from "@better-auth/oauth-provider";
import pg from "pg";
import { Kysely, PostgresDialect } from "kysely";

const IMAGE =
  "postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73";
const BASE = "http://127.0.0.1:3999";
const RESOURCE = "https://probe.invalid/api";
const PLANE_RESOURCE = "https://plane.probe.invalid/api";
const CONTAINER = `dsg-auth-probe-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

// --- assertions -------------------------------------------------------------
const REQUIRED = [
  "migrations",
  "sign-up",
  "sign-up-cookie",
  "resource.create",
  "plane-resource.create",
  "machine-client.create",
  "machine-client.link",
  "machine-client.validator-ready",
  "machine-client.token",
  "machine-client.over-ceiling",
  "machine-client.unlinked-resource",
  "machine-client.introspect",
  "machine-client.rotate-status",
  "machine-client.rotate-old-secret-refused",
  "machine-client.rotate-old-token-still-active",
  "machine-client.rotate-new-secret-issues",
  "machine-client.delete-status",
  "machine-client.deleted-token-inactive",
  "machine-client.deleted-issuance-refused",
  "device.flow",
  "device.token-has-no-sid",
  "device.introspect-by-service",
  "device.session-terminated-still-active",
  "device.refresh-revoked",
  "device.revoke-jwt-direct",
  "pkce-client.create",
  "console-client.create",
  "pkce.authorize",
  "pkce.consent",
  "pkce.exchange",
  "pkce.id-token-auth-time",
  "pkce.introspect-before",
  "pkce.in-process-validation-matches",
  "pkce.session-terminated",
  "pkce.refresh-after-signout",
  "pkce.refresh-bypasses-signout",
  "pkce.refresh-revoked",
  "pkce.revoke-sessions",
  "refresh.preserves-auth-time",
  "refresh.age-policy-control",
  "refresh.before-age-limit",
  "refresh.access-outlives-age-limit",
  "refresh.age-policy-refusal",
  "service-relay.kernel-token-audience",
  "service-relay.kernel-token-refused-at-plane",
  "service-relay.plane-token-audience",
  "service-relay.plane-token-refused-at-kernel",
  "browser.age-policy-does-not-limit-session",
  "browser.old-cookie-issues-code",
  "browser.old-code-refresh-refused",
  "device.age-policy-missing-provenance",
  "device.age-policy-refuses-even-fresh-refresh",
  "device.age-policy-does-not-limit-access",
  "device.refresh-without-age-policy",
  "browser.expired-cookie-refused",
  "browser.signed-out-cookie-refused",
  "session.bogus-cookie",
  "pkce.wrong-verifier-prerequisite",
  "pkce.wrong-verifier",
  "pkce.correct-verifier-control",
  "pkce.consumed-code-replay",
  "logout.correlated-success-state-echo",
  "logout.correlated-success-session-ended",
  "logout.no-hint-confirmation-page",
  "logout.no-hint-confirmed-state-echo",
  "logout.unknown-client-refused",
  "logout.device-client-refused",
];
const seen = new Set();
let failures = 0;
const line = (payload) => console.log(JSON.stringify(payload));
function check(name, condition, detail) {
  seen.add(name);
  if (!condition) failures += 1;
  line({ scenario: name, pass: Boolean(condition), ...(detail === undefined ? {} : { detail }) });
}
const eq = (name, actual, expected, label) =>
  check(name, Object.is(actual, expected), { [label ?? "value"]: actual, expected });

// --- container --------------------------------------------------------------
// PROBE_DATABASE_URL points the probe at an already-running PostgreSQL
// instance (a shared isolated instance, for example) instead of starting a
// container. Set it to skip Docker entirely; leave it unset to keep the
// self-contained container this file otherwise starts and tears down.
const EXTERNAL_DATABASE_URL = process.env.PROBE_DATABASE_URL ?? null;
let containerStarted = false;
let containerPort = null;
// RP-initiated logout verifies its id_token_hint by fetching this server's
// own /auth/jwks over the network (not in process), so a real listener on
// BASE is required for that one round trip. Every other scenario keeps
// calling auth.handler directly.
let httpServer = null;

const docker = (args) => execFileSync("docker", args, { encoding: "utf8" }).trim();

function startDatabase() {
  if (EXTERNAL_DATABASE_URL) return;
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
    "127.0.0.1:0:5432",
    IMAGE,
  ]);
  containerStarted = true;
  const mapping = docker(["port", CONTAINER, "5432"]);
  containerPort = Number(mapping.split(":").pop());
  if (!Number.isInteger(containerPort) || containerPort <= 0) {
    throw new Error(`could not read the published port from ${mapping}`);
  }
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
}

function stopDatabase() {
  if (EXTERNAL_DATABASE_URL) return { removed: true, note: "external database, nothing to remove" };
  if (!containerStarted) return { removed: true, note: "nothing was created" };
  try {
    docker(["rm", "-f", CONTAINER]);
    return { removed: true };
  } catch (error) {
    return { removed: false, note: String(error).slice(0, 200) };
  }
}

const containerExists = () => {
  if (EXTERNAL_DATABASE_URL) return false;
  const names = docker(["ps", "-a", "--filter", `name=^${CONTAINER}$`, "--format", "{{.Names}}"]);
  return names.length > 0;
};

// --- scenarios --------------------------------------------------------------
async function run() {
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const db = new Kysely({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString:
          EXTERNAL_DATABASE_URL ?? `postgres://probe:probe@127.0.0.1:${containerPort}/probe`,
      }),
    }),
  });

  // Candidate policy retained to prove its limits. It is not a production
  // freshness guarantee: device grants omit authTime and access tokens outlive it.
  let maxUpstreamAuthAgeSeconds = null;
  const providerOptions = {
    loginPage: "/sign-in",
    consentPage: "/consent",
    scopes: ["openid", "profile", "offline_access", "api:read"],
    resources: [RESOURCE, PLANE_RESOURCE],
    clientPrivileges: async () => true,
  };
  const inProcessValidationPlugin = {
    id: "probe-in-process-validation",
    endpoints: {
      hashRefresh: createAuthEndpoint("/probe/hash-refresh", { method: "POST" }, async (ctx) => {
        const provider = getOAuthProviderApi(ctx, providerOptions);
        const hashed = await provider.hashToken(ctx.body?.token ?? "", "refresh_token");
        return { hashed };
      }),
      requireActive: createAuthEndpoint(
        "/probe/require-active",
        { method: "POST" },
        async (ctx) => {
          const provider = getOAuthProviderApi(ctx, providerOptions);
          const token = ctx.body?.token;
          const clientId = ctx.body?.clientId;
          try {
            const payload = await provider.requireActiveAccessToken(token, clientId);
            return { active: true, scope: payload.scope ?? null, sid: payload.sid ?? null };
          } catch {
            return { active: false };
          }
        },
      ),
    },
  };
  const auth = betterAuth({
    appName: "probe",
    baseURL: `${BASE}/auth`,
    basePath: "/auth",
    secret,
    database: { db, type: "postgres", casing: "snake", transaction: true },
    emailAndPassword: { enabled: true },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (maxUpstreamAuthAgeSeconds === null) return;
        if (ctx.path !== "/oauth2/token") return;
        const body = ctx.body ?? {};
        if (body.grant_type !== "refresh_token" || typeof body.refresh_token !== "string") return;
        const provider = getOAuthProviderApi(ctx, providerOptions);
        const hashed = await provider.hashToken(body.refresh_token, "refresh_token");
        const row = await db
          .selectFrom("oauthRefreshToken")
          .select(["authTime"])
          .where("token", "=", hashed)
          .executeTakeFirst();
        const authTime = row?.authTime ? new Date(row.authTime) : null;
        if (authTime === null) {
          throw new APIError("BAD_REQUEST", {
            error_description: "no recorded upstream authentication time",
            error: "invalid_grant",
          });
        }
        const ageSeconds = (Date.now() - authTime.getTime()) / 1000;
        if (
          !Number.isFinite(ageSeconds) ||
          ageSeconds < 0 ||
          ageSeconds >= maxUpstreamAuthAgeSeconds
        ) {
          throw new APIError("BAD_REQUEST", {
            error_description: "upstream authentication is older than the limit",
            error: "invalid_grant",
          });
        }
      }),
    },
    plugins: [
      jwt(),
      oauthProvider(providerOptions),
      oauthDeviceAuthorization(),
      inProcessValidationPlugin,
    ],
  });
  const { runMigrations } = await getMigrations(auth.options);
  await runMigrations();
  check("migrations", true);

  httpServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`http://127.0.0.1:3999${req.url}`, {
      method: req.method,
      headers: req.headers,
      body:
        chunks.length && req.method !== "GET" && req.method !== "HEAD"
          ? Buffer.concat(chunks)
          : undefined,
    });
    const response = await auth.handler(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise((resolve) => httpServer.listen(3999, "127.0.0.1", resolve));

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
      parsed = { unparsed: true };
    }
    return { status: res.status, body: parsed, headers: res.headers };
  };
  const api = async (fn, body, headers = {}) => {
    try {
      const out = await auth.api[fn]({ headers: new Headers(headers), body });
      return { status: 200, body: out };
    } catch (error) {
      return {
        status: typeof error.statusCode === "number" ? error.statusCode : 400,
        body: error.body ?? { error: String(error.message).slice(0, 160) },
      };
    }
  };
  const linkResource = async (clientId, headers, identifier = RESOURCE) => {
    try {
      return await auth.api.adminLinkClientResource({
        headers: new Headers(headers),
        params: { identifier, client_id: clientId },
      });
    } catch (error) {
      return { linked: false, detail: String(error.message).slice(0, 120) };
    }
  };
  const form = (params) => new URLSearchParams(params).toString();
  const FORM = { "content-type": "application/x-www-form-urlencoded" };
  const claims = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  const freshCookie = async () => {
    const signIn = await call("POST", "/sign-in/email", {
      email: "admin@probe.invalid",
      password: "probe-password-1",
    });
    return signIn.headers.get("set-cookie")?.split(";")[0];
  };
  const basic = (id, value) => Buffer.from(`${id}:${value}`).toString("base64");

  // --- people and resources ------------------------------------------------
  const signUp = await call("POST", "/sign-up/email", {
    email: "admin@probe.invalid",
    password: "probe-password-1",
    name: "Probe Admin",
  });
  const cookie = signUp.headers.get("set-cookie")?.split(";")[0];
  eq("sign-up", signUp.status, 200, "status");
  check("sign-up-cookie", Boolean(cookie));

  // Admin calls need a live session, and one scenario signs the first one out.
  let adminCookie = cookie;
  const admin = async () => {
    if (adminCookie === null) adminCookie = await freshCookie();
    return adminCookie;
  };
  const adminHeaders = async () => ({ cookie: await admin() });

  const resource = await api(
    "adminCreateOAuthResource",
    { identifier: RESOURCE, name: "probe-api" },
    await adminHeaders(),
  );
  eq("resource.create", resource.status, 200, "status");

  const planeResource = await api(
    "adminCreateOAuthResource",
    { identifier: PLANE_RESOURCE, name: "probe-plane" },
    await adminHeaders(),
  );
  eq("plane-resource.create", planeResource.status, 200, "status");

  // --- machine clients -----------------------------------------------------
  const machine = await api(
    "adminCreateOAuthClient",
    {
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["client_credentials"],
      client_credentials_scopes: ["api:read"],
      resources: [RESOURCE],
      client_name: "probe-service",
    },
    await adminHeaders(),
  );
  const machineId = machine.body?.client_id;
  eq("machine-client.create", machine.status, 200, "status");
  check(
    "machine-client.link",
    (await linkResource(machineId, await adminHeaders())).linked === true,
  );
  const machineBasic = basic(machineId, machine.body?.client_secret);

  const validator = await api(
    "adminCreateOAuthClient",
    {
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["client_credentials"],
      client_credentials_scopes: ["api:read"],
      resources: [RESOURCE],
      client_name: "probe-validator",
    },
    await adminHeaders(),
  );
  const validatorId = validator.body?.client_id;
  await linkResource(validatorId, await adminHeaders());
  const validatorBasic = basic(validatorId, validator.body?.client_secret);
  check("machine-client.validator-ready", validator.status === 200 && Boolean(validatorId));

  const machineToken = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", resource: RESOURCE }),
    { authorization: `Basic ${machineBasic}`, ...FORM },
  );
  const machineJwt = machineToken.body?.access_token;
  check(
    "machine-client.token",
    machineToken.status === 200 &&
      claims(machineJwt).aud === RESOURCE &&
      claims(machineJwt).scope === "api:read" &&
      claims(machineJwt).sid === undefined,
    { status: machineToken.status, aud: claims(machineJwt)?.aud ?? null },
  );

  const overCeiling = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", scope: "api:write", resource: RESOURCE }),
    { authorization: `Basic ${machineBasic}`, ...FORM },
  );
  eq("machine-client.over-ceiling", overCeiling.body?.error, "invalid_scope", "error");

  const unlinked = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", resource: "https://other.invalid/api" }),
    { authorization: `Basic ${machineBasic}`, ...FORM },
  );
  eq("machine-client.unlinked-resource", unlinked.body?.error, "invalid_target", "error");

  const introLive = await call("POST", "/oauth2/introspect", form({ token: machineJwt }), {
    authorization: `Basic ${validatorBasic}`,
    ...FORM,
  });
  eq("machine-client.introspect", introLive.body?.active, true, "active");

  // Rotation separates the two claims the contract must not conflate: the old
  // secret stops issuing immediately, while the already-issued token stays
  // acceptable until its own expiry or the client's deletion.
  const rotate = await api("rotateClientSecret", { client_id: machineId }, await adminHeaders());
  eq("machine-client.rotate-status", rotate.status, 200, "status");
  const oldSecretAttempt = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", resource: RESOURCE }),
    { authorization: `Basic ${machineBasic}`, ...FORM },
  );
  eq(
    "machine-client.rotate-old-secret-refused",
    oldSecretAttempt.body?.error,
    "invalid_client",
    "error",
  );
  const introAfterRotate = await call("POST", "/oauth2/introspect", form({ token: machineJwt }), {
    authorization: `Basic ${validatorBasic}`,
    ...FORM,
  });
  eq("machine-client.rotate-old-token-still-active", introAfterRotate.body?.active, true, "active");
  const newSecret = rotate.body?.client_secret ?? rotate.body?.clientSecret;
  const newSecretAttempt = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", resource: RESOURCE }),
    { authorization: `Basic ${basic(machineId, newSecret)}`, ...FORM },
  );
  eq("machine-client.rotate-new-secret-issues", newSecretAttempt.status, 200, "status");

  const deleted = await api("deleteOAuthClient", { client_id: machineId }, await adminHeaders());
  eq("machine-client.delete-status", deleted.status, 200, "status");
  const introAfterDelete = await call("POST", "/oauth2/introspect", form({ token: machineJwt }), {
    authorization: `Basic ${validatorBasic}`,
    ...FORM,
  });
  eq("machine-client.deleted-token-inactive", introAfterDelete.body?.active, false, "active");
  const issueAfterDelete = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", resource: RESOURCE }),
    { authorization: `Basic ${basic(machineId, newSecret)}`, ...FORM },
  );
  eq(
    "machine-client.deleted-issuance-refused",
    issueAfterDelete.body?.error,
    "invalid_client",
    "error",
  );

  // --- device grant (the CLI) ----------------------------------------------
  const deviceClient = await api(
    "adminCreateOAuthClient",
    {
      token_endpoint_auth_method: "none",
      grant_types: ["urn:ietf:params:oauth:grant-type:device_code", "refresh_token"],
      application_type: "native",
      resources: [RESOURCE],
      // The CLI logout revokes the refresh token only; it never ends the
      // issuer session, so the client is not registered as a logout
      // initiator.
      enable_end_session: false,
      client_name: "probe-cli",
    },
    await adminHeaders(),
  );
  const deviceClientId = deviceClient.body?.client_id;
  await linkResource(deviceClientId, await adminHeaders());

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
    const poll = () =>
      call(
        "POST",
        "/oauth2/token",
        form({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: dc.body?.device_code,
          client_id: deviceClientId,
        }),
        FORM,
      );
    const before = await poll();
    const claim = await call("GET", `/device?user_code=${dc.body?.user_code}`, undefined, {
      cookie: flowCookie,
      origin: BASE,
    });
    const approve = await call(
      "POST",
      "/device/approve",
      { userCode: dc.body?.user_code },
      {
        cookie: flowCookie,
        origin: BASE,
      },
    );
    await new Promise((resolve) => setTimeout(resolve, (dc.body?.interval ?? 5) * 1000 + 500));
    const after = await poll();
    return { dc, before, claim, approve, after };
  };

  const device = await deviceFlow(cookie);
  check(
    "device.flow",
    device.dc.status === 200 &&
      device.before.body?.error === "authorization_pending" &&
      device.claim.status === 200 &&
      device.approve.status === 200 &&
      device.after.status === 200,
    {
      issue: device.dc.status,
      poll_before: device.before.body?.error ?? null,
      claim: device.claim.status,
      approve: device.approve.status,
      token: device.after.status,
    },
  );
  const deviceJwt = device.after.body?.access_token;
  const deviceRefresh = device.after.body?.refresh_token;
  check("device.token-has-no-sid", deviceJwt !== undefined && claims(deviceJwt).sid === undefined);

  const introDevice = await call("POST", "/oauth2/introspect", form({ token: deviceJwt }), {
    authorization: `Basic ${validatorBasic}`,
    ...FORM,
  });
  eq("device.introspect-by-service", introDevice.body?.active, true, "active");

  const deviceSignOut = await call("POST", "/sign-out", {}, { cookie, origin: BASE });
  adminCookie = null;
  const introDeviceAfter = await call("POST", "/oauth2/introspect", form({ token: deviceJwt }), {
    authorization: `Basic ${validatorBasic}`,
    ...FORM,
  });
  check(
    "device.session-terminated-still-active",
    deviceSignOut.status === 200 && introDeviceAfter.body?.active === true,
    { signOut: deviceSignOut.status, active: introDeviceAfter.body?.active ?? null },
  );

  const revokeDeviceRefresh = await call(
    "POST",
    "/oauth2/revoke",
    form({ token: deviceRefresh, client_id: deviceClientId }),
    FORM,
  );
  const reuseDeviceRefresh = await call(
    "POST",
    "/oauth2/token",
    form({
      grant_type: "refresh_token",
      refresh_token: deviceRefresh,
      client_id: deviceClientId,
    }),
    FORM,
  );
  const introDeviceAfterRevoke = await call(
    "POST",
    "/oauth2/introspect",
    form({ token: deviceJwt }),
    { authorization: `Basic ${validatorBasic}`, ...FORM },
  );
  check(
    "device.refresh-revoked",
    revokeDeviceRefresh.status === 200 &&
      reuseDeviceRefresh.body?.error === "invalid_grant" &&
      introDeviceAfterRevoke.body?.active === true,
    { revoke: revokeDeviceRefresh.status, reuse: reuseDeviceRefresh.body?.error ?? null },
  );

  const revokeDeviceJwt = await call(
    "POST",
    "/oauth2/revoke",
    form({ token: deviceJwt, token_type_hint: "access_token", client_id: deviceClientId }),
    FORM,
  );
  eq("device.revoke-jwt-direct", revokeDeviceJwt.body?.error, "unsupported_token_type", "error");

  // --- authorization code with PKCE (the desktop and the console relay) ----
  const pkceClient = await api(
    "adminCreateOAuthClient",
    {
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      application_type: "native",
      redirect_uris: ["http://127.0.0.1:5377/callback"],
      post_logout_redirect_uris: ["http://127.0.0.1:5377/logout-callback"],
      enable_end_session: true,
      resources: [RESOURCE],
      client_name: "probe-desktop",
    },
    await adminHeaders(),
  );
  const pkceClientId = pkceClient.body?.client_id;
  check("pkce-client.create", pkceClient.status === 200 && Boolean(pkceClientId));
  await linkResource(pkceClientId, await adminHeaders());
  const consoleClient = await api(
    "adminCreateOAuthClient",
    {
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      application_type: "web",
      redirect_uris: ["https://console.probe.invalid/auth/callback"],
      skip_consent: true,
      resources: [RESOURCE, PLANE_RESOURCE],
      client_name: "probe-console",
    },
    await adminHeaders(),
  );
  const consoleClientId = consoleClient.body?.client_id;
  check("console-client.create", consoleClient.status === 200 && Boolean(consoleClientId));
  await linkResource(consoleClientId, await adminHeaders());

  await linkResource(consoleClientId, await adminHeaders(), PLANE_RESOURCE);
  const planeValidator = await api(
    "adminCreateOAuthClient",
    {
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["client_credentials"],
      client_credentials_scopes: ["api:read"],
      resources: [PLANE_RESOURCE],
      client_name: "probe-plane-validator",
    },
    await adminHeaders(),
  );
  await linkResource(planeValidator.body?.client_id, await adminHeaders(), PLANE_RESOURCE);
  const planeValidatorBasic = basic(
    planeValidator.body?.client_id,
    planeValidator.body?.client_secret,
  );

  const issueCode = async (flowCookie, clientId, redirectUri, resources = [RESOURCE]) => {
    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const challenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", Buffer.from(verifier)),
    ).toString("base64url");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "openid offline_access api:read",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "probe-state",
    });
    for (const resource of resources) query.append("resource", resource);
    const authorize = await auth.handler(
      new Request(`${BASE}/auth/oauth2/authorize?${query}`, {
        headers: { cookie: flowCookie },
        redirect: "manual",
      }),
    );
    let location = authorize.headers.get("location") ?? "";
    let code = new URL(location, BASE).searchParams.get("code");
    let consent = null;
    if (!code && location.includes("/consent")) {
      consent = await call(
        "POST",
        "/oauth2/consent",
        {
          accept: true,
          oauth_query: new URL(location, BASE).search,
        },
        { cookie: flowCookie, origin: BASE },
      );
      const redirect = consent.body?.redirect_uri ?? consent.body?.url ?? "";
      location = redirect;
      code = redirect ? new URL(redirect, BASE).searchParams.get("code") : null;
    }
    return { authorize, consent, code, verifier, query, clientId, redirectUri };
  };
  const exchangeCode = (issued, verifier = issued.verifier) =>
    call(
      "POST",
      "/oauth2/token",
      form({
        grant_type: "authorization_code",
        code: issued.code,
        redirect_uri: issued.redirectUri,
        client_id: issued.clientId,
        code_verifier: verifier,
      }),
      FORM,
    );
  const pkceFlow = async (flowCookie, clientId, redirectUri, resources = [RESOURCE]) => {
    const issued = await issueCode(flowCookie, clientId, redirectUri, resources);
    return { ...issued, exchange: issued.code ? await exchangeCode(issued) : null };
  };

  const pkceCookie = await freshCookie();
  const pkce = await pkceFlow(pkceCookie, pkceClientId, "http://127.0.0.1:5377/callback");
  eq("pkce.authorize", pkce.authorize.status, 302, "status");
  check("pkce.consent", pkce.consent !== null && pkce.consent.status === 200 && Boolean(pkce.code));
  const pkceJwt = pkce.exchange.body?.access_token;
  const pkceRefresh = pkce.exchange.body?.refresh_token;
  let pkceRefreshCurrent = pkceRefresh;
  const pkceIdToken = pkce.exchange.body?.id_token;
  check(
    "pkce.exchange",
    pkce.exchange.status === 200 &&
      claims(pkceJwt).sid !== undefined &&
      typeof pkceIdToken === "string",
    { status: pkce.exchange.status, hasSid: claims(pkceJwt)?.sid !== undefined },
  );
  const originalAuthTime = claims(pkceIdToken).auth_time ?? null;
  check("pkce.id-token-auth-time", typeof originalAuthTime === "number");

  const introPkce = await call("POST", "/oauth2/introspect", form({ token: pkceJwt }), {
    authorization: `Basic ${validatorBasic}`,
    ...FORM,
  });
  eq("pkce.introspect-before", introPkce.body?.active, true, "active");

  // The kernel's in-process validation API, exercised beside introspection on
  // the same token: both must agree, and both must refuse after sign-out.
  const requireActive = async (token) => {
    const res = await call("POST", "/probe/require-active", { token, clientId: validatorId });
    return res.body?.active ?? null;
  };
  const inProcessLive = await requireActive(pkceJwt);
  eq(
    "pkce.in-process-validation-matches",
    inProcessLive,
    introPkce.body?.active === true,
    "active",
  );

  const pkceSignOut = await call("POST", "/sign-out", {}, { cookie: pkceCookie, origin: BASE });
  const introPkceAfter = await call("POST", "/oauth2/introspect", form({ token: pkceJwt }), {
    authorization: `Basic ${validatorBasic}`,
    ...FORM,
  });
  const inProcessAfter = await requireActive(pkceJwt);
  check(
    "pkce.session-terminated",
    pkceSignOut.status === 200 && introPkceAfter.body?.active === false && inProcessAfter === false,
    { introspect: introPkceAfter.body?.active ?? null, inProcess: inProcessAfter },
  );

  // A refresh that follows a sign-out, answered by the library as measured.
  const pkceRefreshAfterSignOut = await call(
    "POST",
    "/oauth2/token",
    form({
      grant_type: "refresh_token",
      refresh_token: pkceRefresh,
      client_id: pkceClientId,
    }),
    FORM,
  );
  check("pkce.refresh-after-signout", pkceRefreshAfterSignOut.status === 200, {
    status: pkceRefreshAfterSignOut.status,
    error: pkceRefreshAfterSignOut.body?.error ?? null,
  });
  const refreshedJwt = pkceRefreshAfterSignOut.body?.access_token;
  if (typeof refreshedJwt === "string") {
    const introRefreshed = await call("POST", "/oauth2/introspect", form({ token: refreshedJwt }), {
      authorization: `Basic ${validatorBasic}`,
      ...FORM,
    });
    // The finding the contract must state: a refresh that follows a sign-out
    // returns a token the library still accepts, because the refresh grant
    // does not consult the session the chain was issued under. Ending a
    // session is therefore not a desktop logout by itself.
    check("pkce.refresh-bypasses-signout", introRefreshed.body?.active === true, {
      status: pkceRefreshAfterSignOut.status,
      active: introRefreshed.body?.active ?? null,
    });
    pkceRefreshCurrent = pkceRefreshAfterSignOut.body?.refresh_token ?? pkceRefresh;
  }

  const revokePkceRefresh = await call(
    "POST",
    "/oauth2/revoke",
    form({ token: pkceRefreshCurrent, client_id: pkceClientId }),
    FORM,
  );
  const reusePkceRefresh = await call(
    "POST",
    "/oauth2/token",
    form({
      grant_type: "refresh_token",
      refresh_token: pkceRefreshCurrent,
      client_id: pkceClientId,
    }),
    FORM,
  );
  check(
    "pkce.refresh-revoked",
    revokePkceRefresh.status === 200 && reusePkceRefresh.body?.error === "invalid_grant",
    { revoke: revokePkceRefresh.status, reuse: reusePkceRefresh.body?.error ?? null },
  );

  // All-session cutoff: a fresh desktop session, revoked wholesale.
  const allCookie = await freshCookie();
  const all = await pkceFlow(allCookie, pkceClientId, "http://127.0.0.1:5377/callback");
  const allJwt = all.exchange.body?.access_token;
  const introAllBefore = await call("POST", "/oauth2/introspect", form({ token: allJwt }), {
    authorization: `Basic ${validatorBasic}`,
    ...FORM,
  });
  const revokeAll = await call("POST", "/revoke-sessions", {}, { cookie: allCookie, origin: BASE });
  const introAllAfter = await call("POST", "/oauth2/introspect", form({ token: allJwt }), {
    authorization: `Basic ${validatorBasic}`,
    ...FORM,
  });
  check(
    "pkce.revoke-sessions",
    introAllBefore.body?.active === true &&
      revokeAll.status === 200 &&
      introAllAfter.body?.active === false,
    {
      before: introAllBefore.body?.active ?? null,
      revoke: revokeAll.status,
      after: introAllAfter.body?.active ?? null,
    },
  );

  // Every session for this person just ended, including whichever cached
  // cookie adminHeaders() was holding: force a fresh one on next use.
  adminCookie = null;

  // Refresh keeps the original upstream authentication time rather than
  // stamping a new one, which is what makes an age limit possible at all.
  const freshRefreshCookie = await freshCookie();
  const freshFlow = await pkceFlow(
    freshRefreshCookie,
    pkceClientId,
    "http://127.0.0.1:5377/callback",
  );
  const freshRefresh = freshFlow.exchange.body?.refresh_token;
  const firstAuthTime = claims(freshFlow.exchange.body?.id_token).auth_time ?? null;
  const storedBefore = await db
    .selectFrom("oauthRefreshToken")
    .select(["authTime"])
    .orderBy("createdAt", "desc")
    .limit(1)
    .executeTakeFirst();
  const refreshed = await call(
    "POST",
    "/oauth2/token",
    form({
      grant_type: "refresh_token",
      refresh_token: freshRefresh,
      client_id: pkceClientId,
    }),
    FORM,
  );
  const refreshedAuthTime = claims(refreshed.body?.id_token).auth_time ?? null;
  check(
    "refresh.preserves-auth-time",
    refreshed.status === 200 &&
      typeof firstAuthTime === "number" &&
      refreshedAuthTime === firstAuthTime &&
      storedBefore?.authTime !== undefined,
    {
      first: firstAuthTime,
      afterRefresh: refreshedAuthTime,
      stored: storedBefore?.authTime ? "present" : "absent",
    },
  );

  // The age policy itself, through the supported middleware: a fresh chain
  // passes, and the same chain with backdated provenance is refused.
  maxUpstreamAuthAgeSeconds = 60 * 60 * 24 * 7;
  const policyRefresh = await call(
    "POST",
    "/oauth2/token",
    form({
      grant_type: "refresh_token",
      refresh_token: refreshed.body?.refresh_token ?? freshRefresh,
      client_id: pkceClientId,
    }),
    FORM,
  );
  eq("refresh.age-policy-control", policyRefresh.status, 200, "status");
  const currentRefresh = policyRefresh.body?.refresh_token ?? refreshed.body?.refresh_token;
  const hashed = (await call("POST", "/probe/hash-refresh", { token: currentRefresh })).body
    ?.hashed;
  const storedRow = await db
    .selectFrom("oauthRefreshToken")
    .select(["id", "authTime"])
    .where("token", "=", hashed)
    .executeTakeFirst();
  await db
    .updateTable("oauthRefreshToken")
    .set({ authTime: new Date(Date.now() - (maxUpstreamAuthAgeSeconds - 2) * 1000) })
    .where("id", "=", storedRow?.id)
    .execute();
  const nearLimit = await call(
    "POST",
    "/oauth2/token",
    form({
      grant_type: "refresh_token",
      refresh_token: currentRefresh,
      client_id: pkceClientId,
    }),
    FORM,
  );
  eq("refresh.before-age-limit", nearLimit.status, 200, "status");
  await new Promise((resolve) => setTimeout(resolve, 3100));
  const afterLimitAccess = await call(
    "POST",
    "/oauth2/introspect",
    form({ token: nearLimit.body?.access_token }),
    {
      authorization: `Basic ${validatorBasic}`,
      ...FORM,
    },
  );
  eq("refresh.access-outlives-age-limit", afterLimitAccess.body?.active, true, "active");
  const staleRefresh = await call(
    "POST",
    "/oauth2/token",
    form({
      grant_type: "refresh_token",
      refresh_token: nearLimit.body?.refresh_token,
      client_id: pkceClientId,
    }),
    FORM,
  );
  check(
    "refresh.age-policy-refusal",
    staleRefresh.status === 400 && staleRefresh.body?.error === "invalid_grant",
  );
  maxUpstreamAuthAgeSeconds = null;

  // Per-hop audience, corrected: the browser is not an OAuth client and
  // never exchanges its cookie for a token. Each service mints one
  // single-resource token per hop (client_credentials, "resource" = the
  // resource it is about to call), never one token good for both. A
  // console-service-shaped client, linked to both resources like
  // dsg-console-service in the catalog, proves both directions
  // independently: its kernel-audience token is accepted at the kernel
  // validator and refused at the plane validator, and its plane-audience
  // token is accepted at the plane validator and refused at the kernel
  // validator.
  const consoleServiceRelay = await api(
    "adminCreateOAuthClient",
    {
      token_endpoint_auth_method: "client_secret_basic",
      grant_types: ["client_credentials"],
      client_credentials_scopes: ["api:read"],
      resources: [RESOURCE, PLANE_RESOURCE],
      client_name: "probe-console-service",
    },
    await adminHeaders(),
  );
  const consoleServiceId = consoleServiceRelay.body?.client_id;
  await linkResource(consoleServiceId, await adminHeaders(), RESOURCE);
  await linkResource(consoleServiceId, await adminHeaders(), PLANE_RESOURCE);
  const consoleServiceBasic = basic(consoleServiceId, consoleServiceRelay.body?.client_secret);

  const introspectWith = (token, credential) =>
    call("POST", "/oauth2/introspect", form({ token }), {
      authorization: `Basic ${credential}`,
      ...FORM,
    });

  const kernelHopToken = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", resource: RESOURCE }),
    { authorization: `Basic ${consoleServiceBasic}`, ...FORM },
  );
  const kernelHopJwt = kernelHopToken.body?.access_token;
  const kernelHopAtKernel = await introspectWith(kernelHopJwt, validatorBasic);
  const kernelHopAtPlane = await introspectWith(kernelHopJwt, planeValidatorBasic);
  check(
    "service-relay.kernel-token-audience",
    kernelHopToken.status === 200 &&
      claims(kernelHopJwt).aud === RESOURCE &&
      kernelHopAtKernel.body?.active === true,
    { status: kernelHopToken.status, aud: claims(kernelHopJwt)?.aud ?? null },
  );
  eq("service-relay.kernel-token-refused-at-plane", kernelHopAtPlane.body?.active, false, "active");

  const planeHopToken = await call(
    "POST",
    "/oauth2/token",
    form({ grant_type: "client_credentials", resource: PLANE_RESOURCE }),
    { authorization: `Basic ${consoleServiceBasic}`, ...FORM },
  );
  const planeHopJwt = planeHopToken.body?.access_token;
  const planeHopAtPlane = await introspectWith(planeHopJwt, planeValidatorBasic);
  const planeHopAtKernel = await introspectWith(planeHopJwt, validatorBasic);
  check(
    "service-relay.plane-token-audience",
    planeHopToken.status === 200 &&
      claims(planeHopJwt).aud === PLANE_RESOURCE &&
      planeHopAtPlane.body?.active === true,
    { status: planeHopToken.status, aud: claims(planeHopJwt)?.aud ?? null },
  );
  eq("service-relay.plane-token-refused-at-kernel", planeHopAtKernel.body?.active, false, "active");

  // The two-resource authorization-code grant below is retained only to
  // host the age-policy withdrawal counterexamples further down (a code
  // carrying both audiences from one browser session, needed to backdate a
  // session and watch the library still honor it). No production client
  // requests it this way any more: the browser holds only the cookie,
  // proven above never leaving the console as a bearer token.
  const relayCookie = await freshCookie();
  const relay = await pkceFlow(
    relayCookie,
    consoleClientId,
    "https://console.probe.invalid/auth/callback",
    [PLANE_RESOURCE, RESOURCE],
  );

  const sessionRead = await call(
    "GET",
    "/get-session?disableCookieCache=true&disableRefresh=true",
    undefined,
    { cookie: relayCookie },
  );
  const sessionId = sessionRead.body?.session?.id;
  const originalCreatedAt = new Date(Date.now() - 30 * 86400 * 1000);
  await db
    .updateTable("session")
    .set({ createdAt: originalCreatedAt })
    .where("id", "=", sessionId)
    .execute();
  maxUpstreamAuthAgeSeconds = 7 * 86400;
  const oldBrowser = await call(
    "GET",
    "/get-session?disableCookieCache=true&disableRefresh=true",
    undefined,
    { cookie: relayCookie },
  );
  check("browser.age-policy-does-not-limit-session", oldBrowser.body?.session?.id === sessionId);
  const oldCookieCode = await pkceFlow(
    relayCookie,
    consoleClientId,
    "https://console.probe.invalid/auth/callback",
  );
  check(
    "browser.old-cookie-issues-code",
    oldCookieCode.exchange?.status === 200 &&
      claims(oldCookieCode.exchange.body.id_token).auth_time ===
        Math.floor(originalCreatedAt.getTime() / 1000),
  );
  const oldCodeRefresh = await call(
    "POST",
    "/oauth2/token",
    form({
      grant_type: "refresh_token",
      client_id: consoleClientId,
      refresh_token: oldCookieCode.exchange.body?.refresh_token,
    }),
    FORM,
  );
  check(
    "browser.old-code-refresh-refused",
    oldCodeRefresh.status === 400 && oldCodeRefresh.body?.error === "invalid_grant",
  );

  const policyDevice = await deviceFlow(relayCookie);
  const policyDeviceRefresh = policyDevice.after.body?.refresh_token;
  const deviceHash = (await call("POST", "/probe/hash-refresh", { token: policyDeviceRefresh }))
    .body?.hashed;
  const deviceRow = await db
    .selectFrom("oauthRefreshToken")
    .select(["authTime"])
    .where("token", "=", deviceHash)
    .executeTakeFirst();
  check(
    "device.age-policy-missing-provenance",
    policyDevice.after.status === 200 && deviceRow?.authTime === null,
  );
  const devicePolicyRenewal = await call(
    "POST",
    "/oauth2/token",
    form({
      grant_type: "refresh_token",
      client_id: deviceClientId,
      refresh_token: policyDeviceRefresh,
    }),
    FORM,
  );
  check(
    "device.age-policy-refuses-even-fresh-refresh",
    devicePolicyRenewal.status === 400 && devicePolicyRenewal.body?.error === "invalid_grant",
  );
  const deviceAfterAge = await introspectWith(
    policyDevice.after.body?.access_token,
    validatorBasic,
  );
  eq("device.age-policy-does-not-limit-access", deviceAfterAge.body?.active, true, "active");
  maxUpstreamAuthAgeSeconds = null;
  const deviceWithoutPolicy = await call(
    "POST",
    "/oauth2/token",
    form({
      grant_type: "refresh_token",
      client_id: deviceClientId,
      refresh_token: policyDeviceRefresh,
    }),
    FORM,
  );
  eq("device.refresh-without-age-policy", deviceWithoutPolicy.status, 200, "status");

  const expiredCookie = await freshCookie();
  const expiringSession = await call("GET", "/get-session?disableRefresh=true", undefined, {
    cookie: expiredCookie,
  });
  await db
    .updateTable("session")
    .set({ expiresAt: new Date(Date.now() - 1000) })
    .where("id", "=", expiringSession.body?.session?.id)
    .execute();
  const expiredRead = await call(
    "GET",
    "/get-session?disableCookieCache=true&disableRefresh=true",
    undefined,
    { cookie: expiredCookie },
  );
  check("browser.expired-cookie-refused", expiredRead.body === null);
  await call("POST", "/sign-out", {}, { cookie: relayCookie, origin: BASE });
  const signedOutRead = await call(
    "GET",
    "/get-session?disableCookieCache=true&disableRefresh=true",
    undefined,
    { cookie: relayCookie },
  );
  check("browser.signed-out-cookie-refused", signedOutRead.body === null);

  // --- desktop logout: state correlation, the no-hint confirmation gate, ---
  // --- and the CLI's grant-only logout -------------------------------------
  const logoutRedirect = "http://127.0.0.1:5377/logout-callback";

  // Correlated success: a fresh logout `state`, sent with the id_token from
  // the same session the cookie names. The issuer ends that session and
  // echoes the exact state back on the redirect, which is what lets the
  // desktop app match this callback to this attempt and no other.
  const logoutCookie = await freshCookie();
  const logoutLogin = await pkceFlow(logoutCookie, pkceClientId, "http://127.0.0.1:5377/callback");
  const logoutIdToken = logoutLogin.exchange.body?.id_token;
  const logoutState = `logout-${crypto.randomUUID()}`;
  const correlatedLogout = await call(
    "GET",
    `/oauth2/end-session?${new URLSearchParams({
      id_token_hint: logoutIdToken,
      client_id: pkceClientId,
      post_logout_redirect_uri: logoutRedirect,
      state: logoutState,
    })}`,
    undefined,
    { cookie: logoutCookie },
  );
  const correlatedLocation = correlatedLogout.headers.get("location") ?? "";
  check(
    "logout.correlated-success-state-echo",
    correlatedLogout.status >= 300 &&
      correlatedLogout.status < 400 &&
      correlatedLocation.startsWith(logoutRedirect) &&
      new URL(correlatedLocation, BASE).searchParams.get("state") === logoutState,
    { status: correlatedLogout.status, location: correlatedLocation },
  );
  const afterCorrelatedLogout = await call(
    "GET",
    "/get-session?disableCookieCache=true&disableRefresh=true",
    undefined,
    { cookie: logoutCookie },
  );
  check("logout.correlated-success-session-ended", afterCorrelatedLogout.body === null);

  // No hint (expired, rejected, or absent): the issuer still needs
  // `client_id` to validate the registered redirect, and still requires an
  // explicit confirmation before it ends anything. A programmatic caller
  // with no active session and an unknown client is refused before any
  // confirmation page exists.
  const unknownClientLogout = await call(
    "GET",
    `/oauth2/end-session?${new URLSearchParams({ client_id: "does-not-exist" })}`,
    undefined,
    {},
  );
  eq("logout.unknown-client-refused", unknownClientLogout.body?.error, "invalid_client", "error");

  // With a live session and a registered client, absence of a hint reaches
  // the confirmation page rather than ending the session outright.
  const noHintCookie = await freshCookie();
  const noHintState = `logout-${crypto.randomUUID()}`;
  const confirmationResponse = await auth.handler(
    new Request(
      `${BASE}/auth/oauth2/end-session?${new URLSearchParams({
        client_id: pkceClientId,
        post_logout_redirect_uri: logoutRedirect,
        state: noHintState,
      })}`,
      { headers: { cookie: noHintCookie, accept: "text/html" } },
    ),
  );
  const confirmationBody = await confirmationResponse.text();
  check(
    "logout.no-hint-confirmation-page",
    confirmationResponse.status === 200 &&
      confirmationBody.includes("data-oidc-logout-confirmation"),
    { status: confirmationResponse.status },
  );
  const confirmationCookies = confirmationResponse.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0]);
  const confirmComplete = await call(
    "POST",
    "/oauth2/end-session/confirm",
    form({ action: "confirm" }),
    {
      cookie: [noHintCookie, ...confirmationCookies].filter(Boolean).join("; "),
      accept: "text/html",
      origin: BASE,
      ...FORM,
    },
  );
  const confirmedLocation = confirmComplete.headers.get("location") ?? "";
  check(
    "logout.no-hint-confirmed-state-echo",
    confirmComplete.status >= 300 &&
      confirmComplete.status < 400 &&
      confirmedLocation.startsWith(logoutRedirect) &&
      new URL(confirmedLocation, BASE).searchParams.get("state") === noHintState,
    { status: confirmComplete.status, location: confirmedLocation },
  );

  // The CLI is a grant-only logout: it revokes the refresh token and never
  // touches the issuer session, so its client is not a registered logout
  // initiator at all.
  const deviceLogoutAttempt = await call(
    "GET",
    `/oauth2/end-session?${new URLSearchParams({ client_id: deviceClientId })}`,
    undefined,
    {},
  );
  eq("logout.device-client-refused", deviceLogoutAttempt.body?.error, "invalid_client", "error");

  // --- failure paths -------------------------------------------------------
  const bogus = await call("GET", "/get-session", undefined, {
    cookie: "better-auth.session_token=fabricated",
  });
  check("session.bogus-cookie", bogus.status === 200 && bogus.body === null, {
    status: bogus.status,
  });

  const badCookie = await freshCookie();
  const bad = await issueCode(badCookie, pkceClientId, "http://127.0.0.1:5377/callback");
  check("pkce.wrong-verifier-prerequisite", bad.authorize.status === 302 && Boolean(bad.code));
  const differentVerifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
    "base64url",
  );
  const wrong = await exchangeCode(bad, differentVerifier);
  check("pkce.wrong-verifier", wrong.status === 401 && wrong.body?.error === "invalid_request", {
    status: wrong.status,
    error: wrong.body?.error ?? null,
  });
  const control = await issueCode(badCookie, pkceClientId, "http://127.0.0.1:5377/callback");
  const correct = await exchangeCode(control);
  eq("pkce.correct-verifier-control", correct.status, 200, "status");
  const replay = await exchangeCode(control);
  check(
    "pkce.consumed-code-replay",
    replay.status === 400 && replay.body?.error === "invalid_grant",
  );

  await db.destroy();
}

let teardown = { removed: false };
let crashed = null;
try {
  startDatabase();
  await run();
} catch (error) {
  crashed = error instanceof Error ? `${error.message}` : String(error);
  failures += 1;
  line({ scenario: "probe.crashed", pass: false, detail: crashed });
} finally {
  if (httpServer) await new Promise((resolve) => httpServer.close(resolve));
  teardown = stopDatabase();
}

const missing = REQUIRED.filter((name) => !seen.has(name));
check("probe.required-scenarios-ran", missing.length === 0, { missing });
check("teardown.container-removed", teardown.removed === true, teardown);
if (teardown.removed) {
  check("teardown.container-gone", !containerExists());
}
line({ scenario: "probe.summary", failures, scenarios: seen.size });
process.exit(failures === 0 ? 0 : 1);
