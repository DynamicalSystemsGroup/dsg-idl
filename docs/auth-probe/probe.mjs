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
const CONTAINER = `dsg-auth-probe-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

// --- assertions -------------------------------------------------------------
const REQUIRED = [
  "migrations",
  "resource.create",
  "sign-up",
  "machine-client.create",
  "machine-client.link",
  "machine-client.token",
  "machine-client.over-ceiling",
  "machine-client.unlinked-resource",
  "machine-client.introspect",
  "machine-client.rotate-old-secret-refused",
  "machine-client.rotate-old-token-still-active",
  "machine-client.rotate-new-secret-issues",
  "machine-client.deleted-token-inactive",
  "machine-client.deleted-issuance-refused",
  "device.flow",
  "device.token-has-no-sid",
  "device.introspect-by-service",
  "device.session-terminated-still-active",
  "device.refresh-revoked",
  "device.revoke-jwt-direct",
  "pkce.authorize",
  "pkce.consent",
  "pkce.exchange",
  "pkce.introspect-before",
  "pkce.in-process-validation-matches",
  "pkce.session-terminated",
  "pkce.refresh-after-signout",
  "pkce.refresh-bypasses-signout",
  "pkce.refresh-revoked",
  "pkce.revoke-sessions",
  "refresh.preserves-auth-time",
  "refresh.age-policy-refusal",
  "refresh.age-policy-control",
  "browser-relay.code-without-consent",
  "browser-relay.person-token-audience",
  "session.bogus-cookie",
  "pkce.wrong-verifier",
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
let containerStarted = false;
let containerPort = null;

const docker = (args) => execFileSync("docker", args, { encoding: "utf8" }).trim();

function startDatabase() {
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
  if (!containerStarted) return { removed: true, note: "nothing was created" };
  try {
    docker(["rm", "-f", CONTAINER]);
    return { removed: true };
  } catch (error) {
    return { removed: false, note: String(error).slice(0, 200) };
  }
}

const containerExists = () => {
  const names = docker(["ps", "-a", "--filter", `name=^${CONTAINER}$`, "--format", "{{.Names}}"]);
  return names.length > 0;
};

// --- scenarios --------------------------------------------------------------
async function run() {
  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const db = new Kysely({
    dialect: new PostgresDialect({
      pool: new pg.Pool({
        connectionString: `postgres://probe:probe@127.0.0.1:${containerPort}/probe`,
      }),
    }),
  });

  // The kernel's refresh-age policy, expressed as a supported middleware: read
  // the stored upstream authentication time and refuse a refresh that would
  // extend a session past the limit. Disabled until the scenario sets it.
  let maxUpstreamAuthAgeSeconds = null;
  const providerOptions = {
    loginPage: "/sign-in",
    consentPage: "/consent",
    scopes: ["openid", "profile", "offline_access", "api:read"],
    resources: [RESOURCE],
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
        if (ageSeconds > maxUpstreamAuthAgeSeconds) {
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
  const linkResource = async (clientId, headers) => {
    try {
      return await auth.api.adminLinkClientResource({
        headers: new Headers(headers),
        params: { identifier: RESOURCE, client_id: clientId },
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
      resources: [RESOURCE],
      client_name: "probe-console",
    },
    await adminHeaders(),
  );
  const consoleClientId = consoleClient.body?.client_id;
  check("console-client.create", consoleClient.status === 200 && Boolean(consoleClientId));
  await linkResource(consoleClientId, await adminHeaders());

  const pkceFlow = async (flowCookie, clientId, redirectUri, skipConsent) => {
    const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const challenge = Buffer.from(
      await crypto.subtle.digest("SHA-256", Buffer.from(verifier)),
    ).toString("base64url");
    const query = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "openid offline_access api:read",
      resource: RESOURCE,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "probe-state",
    }).toString();
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
    if (!code) return { authorize, consent, code: null, verifier };
    const exchange = await call(
      "POST",
      "/oauth2/token",
      form({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }),
      FORM,
    );
    void skipConsent;
    return { authorize, consent, code, verifier, query, exchange };
  };

  const pkceCookie = await freshCookie();
  const pkce = await pkceFlow(pkceCookie, pkceClientId, "http://127.0.0.1:5377/callback", false);
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
  const all = await pkceFlow(allCookie, pkceClientId, "http://127.0.0.1:5377/callback", false);
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

  // Refresh keeps the original upstream authentication time rather than
  // stamping a new one, which is what makes an age limit possible at all.
  const freshRefreshCookie = await freshCookie();
  const freshFlow = await pkceFlow(
    freshRefreshCookie,
    pkceClientId,
    "http://127.0.0.1:5377/callback",
    false,
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
    .set({ authTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) })
    .where("id", "=", storedRow?.id)
    .execute();
  const staleRefresh = await call(
    "POST",
    "/oauth2/token",
    form({
      grant_type: "refresh_token",
      refresh_token: currentRefresh,
      client_id: pkceClientId,
    }),
    FORM,
  );
  check(
    "refresh.age-policy-refusal",
    staleRefresh.status === 400 && staleRefresh.body?.error === "invalid_grant",
    { status: staleRefresh.status, error: staleRefresh.body?.error ?? null },
  );
  maxUpstreamAuthAgeSeconds = null;

  // Browser relay: the console's own client takes the browser cookie, obtains
  // a code without a consent page, and exchanges it for a resource-bound
  // person token. No bearer token is ever handled by browser JavaScript.
  const relayCookie = await freshCookie();
  const relay = await pkceFlow(
    relayCookie,
    consoleClientId,
    "https://console.probe.invalid/auth/callback",
    true,
  );
  check(
    "browser-relay.code-without-consent",
    relay.authorize.status === 302 && Boolean(relay.code) && relay.consent === null,
    {
      status: relay.authorize.status,
      code: Boolean(relay.code),
      consentPage: relay.consent !== null,
    },
  );
  const relayJwt = relay.exchange.body?.access_token;
  check(
    "browser-relay.person-token-audience",
    relay.exchange.status === 200 && (claims(relayJwt).aud ?? []).includes(RESOURCE),
    { status: relay.exchange.status, aud: claims(relayJwt)?.aud ?? null },
  );

  // --- failure paths -------------------------------------------------------
  const bogus = await call("GET", "/get-session", undefined, {
    cookie: "better-auth.session_token=fabricated",
  });
  check("session.bogus-cookie", bogus.status === 200 && bogus.body === null, {
    status: bogus.status,
  });

  // First prove a valid code exists under the correct session, then change
  // only the verifier.
  const badCookie = await freshCookie();
  const bad = await pkceFlow(badCookie, pkceClientId, "http://127.0.0.1:5377/callback", false);
  check("pkce.wrong-verifier-prerequisite", Boolean(bad.code));
  const wrong = await call(
    "POST",
    "/oauth2/token",
    form({
      grant_type: "authorization_code",
      code: bad.code,
      redirect_uri: "http://127.0.0.1:5377/callback",
      client_id: pkceClientId,
      code_verifier: "wrong-verifier",
    }),
    FORM,
  );
  eq("pkce.wrong-verifier", wrong.body?.error, "invalid_grant", "error");

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
