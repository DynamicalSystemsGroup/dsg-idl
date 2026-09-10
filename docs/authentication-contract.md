# Shared authentication contract

Status: normative, revision 3. Supersedes revision 2 (`de636812`) and the
first delivery (`df84a13`); section 13 lists what each correction changed.

This document freezes the protocol the kernel authentication owner, the
console clients, and the plane validators implement against. It is the only
place these decisions live. Consumers pin this repository's released package
by version and integrity.

Approved architecture (Sayer, 2026-09-10): one Better Auth authority inside the
existing kernel Fastify API on the existing PostgreSQL deployment. The console
HTTPS domain is the canonical public issuer and application entry point. Better
Auth owns linked accounts, sessions, OAuth clients, application tokens, expiry
and revocation. The kernel record owns organization access, suspension,
qualifications, permissions, human decisions and dispatch authority.

## 1. Pins and evidence

| Component                   | Pin                                                                           | Notes                                                      |
| --------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| better-auth                 | 1.7.4                                                                         | kernel today pins 1.7.2 and moves up                       |
| @better-auth/oauth-provider | 1.7.4                                                                         | peer better-auth ^1.7.4                                    |
| Plugins                     | `jwt`, `oauthProvider`, `oauthDeviceAuthorization`                            |                                                            |
| Node                        | >= 24                                                                         | workspace engines                                          |
| Database                    | Kysely PostgreSQL, `{ casing: "snake", transaction: true }`                   | 13 tables                                                  |
| Admin transport             | `auth.api.*` server-side                                                      | admin endpoints are `SERVER_ONLY` and answer 404 over HTTP |
| In-process validation       | `getOAuthProviderApi(ctx, options).requireActiveAccessToken(token, clientId)` | exported; probe shows it matches remote introspection      |
| Organization plugin         | not used                                                                      | kernel authority stays in the record                       |

`docs/auth-probe/` is the runnable evidence: `npm ci && node probe.mjs`. It
starts its own PostgreSQL container under a unique name on an ephemeral
loopback port, asserts 48 scenarios over the in-process handler, prints one
JSON line each, removes only what it created, and exits non-zero if any
assertion fails or any required scenario did not run. Breaking one expectation
was verified to exit 1 with the container removed. `docs/auth-probe-evidence.md`
records the observed results and what stays documentation-derived.

## 2. What actually cuts a credential off

Measured on the pinned packages. Offline validity means the JWT verifies
against `/jwks` with an unexpired `exp`; online acceptance means
`/oauth2/introspect` answers `active: true`.

| Grant                               | `sid` | Session sign-out                | Refresh revoked                                         | Client rotation                                         | Client deletion                                 |
| ----------------------------------- | ----- | ------------------------------- | ------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| `client_credentials`                | no    | n/a                             | n/a                                                     | **old secret stops issuing; issued tokens stay active** | token `active:false`, issuance `invalid_client` |
| device (CLI)                        | no    | token stays `active:true`       | reuse `invalid_grant`; access token stays `active:true` | n/a                                                     | n/a                                             |
| authorization code + PKCE (desktop) | yes   | token `active:false`            | reuse `invalid_grant`                                   | n/a                                                     | n/a                                             |
| browser session cookie              | n/a   | store read returns null at once | n/a                                                     | n/a                                                     | n/a                                             |

Four consequences, each measured:

1. **Introspection decides acceptance.** Offline verification is a filter, never
   an authorization. Only introspection sees session termination, client
   deletion and the machine cutoff.
2. **Rotation is not revocation.** Rotating a client secret stops new issuance
   immediately; an already-issued machine token stays acceptable until its own
   `exp` or until the client is deleted. The contract does not call rotation a
   bearer-token revocation.
3. **Sign-out does not end a desktop chain by itself.** A refresh request after
   sign-out returns new tokens the library still accepts, because the refresh
   grant never consults the session. Desktop logout is therefore: revoke the
   refresh token, then end the session, then clear local state. All-session
   logout (`POST /revoke-sessions`) removes the session rows and does cut
   `sid`-carrying tokens.
4. **Device tokens carry no `sid`.** Session termination does not reach them.
   Their cutoff channels are refresh revocation and the access-token TTL.

Immediacy versus the cache: a validator's introspection result is cached at most
60 seconds (section 4.5). Sign-out, revocation and deletion are effective for
the next fresh validation, not for a cached success already in hand. Section 4.6
states what a state-changing request does when it holds a cached success and a
fresh check is unavailable.

## 3. Routes, methods and page ownership

Verified against the pinned handlers. The kernel API is the only service running
Better Auth; the console API and the plane are resource servers and relays and
keep no session store.

| Path                                                                  | Method            | Reachability | Credential                                                                                 |
| --------------------------------------------------------------------- | ----------------- | ------------ | ------------------------------------------------------------------------------------------ |
| `/auth/sign-in/social`                                                | POST              | public       | none (provider in the body)                                                                |
| `/auth/callback/:id` (`:id` = `google`)                               | GET or POST       | public       | none                                                                                       |
| `/auth/get-session`                                                   | GET or POST       | public       | session cookie; null on a forged cookie                                                    |
| `/auth/sign-out`                                                      | POST              | public       | session cookie                                                                             |
| `/auth/revoke-session`                                                | POST              | public       | session cookie                                                                             |
| `/auth/revoke-sessions`                                               | POST              | public       | session cookie; ends every session for the person                                          |
| `/auth/revoke-other-sessions`                                         | POST              | public       | session cookie                                                                             |
| `/auth/.well-known/oauth-authorization-server`                        | GET               | public       | none                                                                                       |
| `/auth/.well-known/openid-configuration`                              | GET               | public       | none                                                                                       |
| `/auth/jwks`                                                          | GET               | public       | none                                                                                       |
| `/auth/oauth2/authorize`                                              | GET               | public       | session cookie; redirects to the hosted consent page unless the client sets `skip_consent` |
| `/auth/oauth2/consent`                                                | POST              | public       | session cookie; body `{ accept, oauth_query }`                                             |
| `/auth/oauth2/token`                                                  | POST              | public       | per grant; public clients send `client_id` in the body                                     |
| `/auth/oauth2/introspect`                                             | POST              | public       | client credentials, plus a resource link (4.4)                                             |
| `/auth/oauth2/revoke`                                                 | POST              | public       | client credentials or `client_id`                                                          |
| `/auth/oauth2/userinfo`                                               | GET               | public       | access token                                                                               |
| `/auth/device/code`                                                   | POST              | public       | none                                                                                       |
| `/auth/device`                                                        | GET               | public       | session cookie; claims a pending `user_code`                                               |
| `/auth/device/approve`, `/auth/device/deny`                           | POST              | public       | session cookie; body `{ userCode }`, camelCase                                             |
| `/auth/admin/oauth2/*`                                                | POST/PATCH/DELETE | server-only  | no HTTP route; `auth.api.*` with an admin session                                          |
| `/decisions/:kind/challenge`, `/decisions/:kind`                      | POST              | private      | session or PKCE token, plus fresh Google proof for the decision                            |
| `/principals/access`, `/principals/identity`, `/principals/bindings*` | GET/POST          | private      | person credential or plane service credential                                              |

### 3.1 Page ownership

The kernel serves the **endpoints**; the console serves the **pages**. The
plugin's `loginPage`, `consentPage` and the device plugin's `verificationUri`
are URLs, so they point at console routes on the public domain. This keeps the
implementation split the prepared assignments assume: hosted sign-in, consent,
device-verification and confirmation pages live in the console, and the
kernel serves `/auth/*`, `/decisions/*` and `/principals/*`. Nothing in the
plugin options requires the kernel repository to grow a UI.

The console's confirmation page is the one page that must exist for desktop and
CLI, because both open it in a browser and then read the recorded outcome.

### 3.2 Public paths and private destinations

Clients never reach a private kernel host. The console domain is the single
public entry point.

| Public path                                             | Destination                            | Who uses it                                            |
| ------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------ |
| `https://<console-domain>/auth/*`                       | kernel API (private)                   | browsers, desktop, CLI, discovery, JWKS, introspection |
| `https://<console-domain>/decisions/*`, `/principals/*` | kernel API (private)                   | console API relay, desktop, CLI                        |
| `https://<console-domain>/api/*`                        | console API (private)                  | browser                                                |
| `https://<console-domain>/api/runs/*`                   | console API, which relays to the plane | browser                                                |
| `https://<console-domain>/` and page routes             | console (private)                      | browser                                                |

The relay forwards method, status, `Location` and every `Set-Cookie` unchanged
and adds no authority of its own. Validation and bootstrap requests take the
same path: a validator outside the kernel introspects through `/auth/*`; the
kernel validates itself in process and never introspects itself.

### 3.3 Cookie scope

The session cookie is issued by the public issuer host, `Secure`, `HttpOnly`,
`SameSite=Lax`, `Path=/`, and no `Domain` attribute (host-only for the console
domain). `Path=/` is required because the product routes and the hosted pages
are not under `/auth`. Mutations carry an origin check; a missing or foreign
origin is refused. `SameSite=Lax` still sends the cookie on the top-level
redirect back from Google, which is why it works for the callback.

## 4. Credential transport

One `Authorization` header per request, naming the acting principal. A service
acting for a person adds its own credential in a separate header.

### 4.1 Names

| Carrier                               | Direction                                            | Content                                                                          |
| ------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Authorization: Bearer <token>`       | every hop                                            | the acting credential                                                            |
| `X-DSG-Service-Token: Bearer <token>` | console to plane, plane to kernel, console to kernel | the calling service's `client_credentials` token                                 |
| session cookie                        | browser to console and to the kernel                 | `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` (3.3)                             |
| `x-goog-iap-jwt-assertion`            | infrastructure front door only                       | transport identity; verified at the edge, never accepted as authority downstream |

`X-DSG-Service-Token` replaces the retired `x-kernel-person-assertion`. No hop
forwards a person assertion as authority any more.

### 4.2 Browser to console to plane to kernel

The browser holds only the cookie. The console needs a person token for
downstream calls, and obtains one with supported library operations, never with
a handwritten exchange:

1. The browser calls the console with its cookie.
2. The console, server-side, calls `/auth/oauth2/authorize` **with the
   browser's cookie**, its own registered client, `resource` set to the target
   service, and PKCE. Because that client sets `skip_consent`, the response is a
   redirect carrying a code and no consent page. **Measured:** 302 with a code,
   no consent page.
3. The console exchanges the code at `/auth/oauth2/token` for a person access
   token whose audience includes the target resource. **Measured:** exchange
   200, `aud` contains the resource.
4. The console calls the plane or kernel with `Authorization: Bearer <person
token>` and `X-DSG-Service-Token: Bearer <console service token>`.

Custody and lifecycle: the person token lives in the console process memory for
its lifetime (max 3600 s), is never written to disk, never logged, and never
reaches the browser. Browser JavaScript never holds a bearer credential. The
console's client is a confidential or public client registered with
`skip_consent`, `authorization_code` and `refresh_token` grants, the kernel and
plane resources, and a redirect URI on its own origin. Renewal uses the refresh
grant; when renewal fails the console returns 401 and the browser re-enters the
sign-in page with the cookie still present.

### 4.3 Hop by hop

- **Browser to console.** Cookie only, origin-checked on mutations.
- **Desktop to kernel.** `Authorization: Bearer <PKCE token>`; refresh token in
  the OS credential store.
- **CLI to kernel.** `Authorization: Bearer <device token>`; refresh token in
  the OS credential store.
- **Console to plane or kernel.** Person token plus console service token, as in
  4.2.
- **Plane to kernel.** Person token plus plane service token when the call is
  about a person; the plane's own token alone when the plane is the caller.
- **Service with no person.** The caller's `client_credentials` token alone.

### 4.4 Audience, resources and introspection authorization

- Each protected resource has one identifier, and tokens name it. A token minted
  for one resource is refused by another (`invalid_target` at issuance, refusal
  at validation).
- Clients are linked to the resources they may be issued for, and introspection
  follows the same link: the introspecting client must be the issuer client or
  be linked to one of the token's audience resources. A service that validates
  person tokens is therefore registered, linked and credentialed; holding an
  application token grants nothing.
- Desktop, CLI and console each register the resources they call and pass
  `resource` on authorize or device requests.

### 4.5 Validation calls and freshness

| Check                              | Call                                                                          | Freshness                                      |
| ---------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| Session cookie (in kernel)         | in-process session read                                                       | every request                                  |
| JWT pre-filter                     | local signature, `iss`, `aud`, `exp` against `/jwks`                          | keys cached 300 s, refetch on unknown `kid`    |
| In-process acceptance (kernel)     | `getOAuthProviderApi(ctx, options).requireActiveAccessToken(token, clientId)` | every request; measured equal to introspection |
| Remote acceptance (plane, console) | `POST /auth/oauth2/introspect`                                                | cached at most 60 s, never past `exp`          |
| Suspension                         | kernel record read                                                            | 5 s                                            |
| Machine cutoff                     | introspection after delete                                                    | next introspection                             |

### 4.6 Cached success with validation unavailable

A state-changing request never proceeds on a cached success alone:

- If the cached acceptance is unexpired and the fresh check is not required by
  the operation, the request may proceed within the cache window.
- If the operation requires a fresh check (every mutation, every decision, every
  dispatch) and the validator cannot answer, the request is refused with
  `validation_unavailable` (503). It is not queued and not retried
  optimistically.
- Reads inside the cache window proceed; reads outside it fail closed.
- The kernel validates itself in process, so kernel-internal authorization never
  depends on a network call to authentication. External validators depend on the
  kernel and fail closed when it is unreachable.

### 4.7 Forged and conflicting credentials

- Inbound `X-DSG-Service-Token` and `x-goog-iap-jwt-assertion` are stripped
  unless the request arrives from the configured peer range.
- Two credentials naming different principals, or a person token whose `azp` is
  not registered for this resource, refuse the request. No header wins by
  inspection order.
- A machine token never satisfies a human act; decisions require fresh Google
  proof regardless of the token that carried the request.

### 4.8 Google infrastructure credentials

The Google service accounts that reach GCP APIs stay, carrying infrastructure
identity only. IAP is removed as the **human gate** on the console domain (that
is what the migration replaces) and remains where it already protects
machine-facing infrastructure. Where it remains, its assertion is verified at
the edge for transport and is never rewritten into person authority: the
person's Better Auth token is what the kernel trusts, and a Google service
account is never accepted as a person. In no path does an infrastructure token
travel beside an application credential as a second identity for the same
request.

## 5. Identity mapping

| Identifier             | Where it lives                                  | Authority                                              |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| Better Auth user id    | kernel PostgreSQL only                          | none; never in the record, an event, a URL or evidence |
| Google subject (`sub`) | Better Auth `account` row (`providerId` google) | the identity the record binds                          |
| Email                  | account attribute                               | lookup and display only                                |

The recorded binding is unchanged: a principal whose `googleSubject` is
`accounts.google.com:<sub>`, actor derived from that subject, `googleAccountId`
holding the address. A verified sign-in resolves to a principal by issuer and
subject, never by email and never by the Better Auth user id. A changed address
does not rebind a principal. First access runs the existing enrollment path
under the recorded organization policy and is idempotent. Account linking is
governed and preserves the original principal and prior evidence.

### 5.1 Suspension and current authorization

Suspension lives in the record. It is checked on every protected request with a
5-second read bound, so a suspended principal is refused even with a fresh
session or token. A valid session never substitutes for a current permission
check.

Existing streams: an open `EventSource` or long-lived read re-checks at open and
at each heartbeat, and a stream whose subscription outlives the suspension bound
is closed. A stream is never allowed to outlive a recorded suspension.

### 5.2 Workspace membership: what refresh really does

Measured in the pinned source and probe:

- The refresh grant (`handleRefreshTokenGrant`, `dist/introspect-Dlc-aIaF.mjs`)
  reads the stored refresh token and the internal user, then mints tokens. It
  contacts neither Google nor the session. A rolling refresh therefore extends
  access with **no fresh Google observation**.
- The refresh token row stores `authTime`, and each rotation carries the
  original value forward. Provenance is preserved and cannot be reset by
  refreshing. **Measured:** `id_token.auth_time` after a refresh equals the
  original sign-in time.

So the honest mechanisms are:

1. **Interactive sign-in** obtains fresh Google claims. `hd` is re-checked
   against the recorded workspace domain and the address must end in it.
2. **Absolute upstream-authentication age**, enforced by the kernel at the token
   endpoint through a supported `hooks.before` middleware: read
   `oauthRefreshToken.authTime` for the presented token (found with the
   provider's own `hashToken`), and refuse the refresh with `invalid_grant` when
   the age exceeds `KERNEL_MAX_UPSTREAM_AUTH_AGE_SECONDS` (default 86400).
   **Measured:** with the policy active, a fresh chain refreshes 200 and a chain
   whose stored `authTime` is backdated 30 days is refused 400 `invalid_grant`.
   Because the age is read from stored provenance, refreshing cannot reset it,
   and this also caps the sign-out bypass in section 2 consequence 3.
3. **Recorded suspension**, checked per request (5.1), immediate.
4. **Directory observation** (`users.get`,
   `https://www.googleapis.com/auth/admin.directory.user.readonly`) on sign-in
   and on a timer, for removal detection tighter than the age limit. This needs
   domain-wide delegation in the Workspace tenant: **Sayer's act**, not assumed
   here.

The removal-detection bound is therefore: **the configured upstream
authentication age (default 24 hours) once mechanism 2 is wired, and the next
interactive sign-in otherwise.** With mechanism 4 it becomes the observation
interval. It is not the session or access-token lifetime, and an old
hosted-domain claim never establishes current membership.

## 6. Client lifecycle

- **Browser.** Sign-out ends the session; other sessions survive. All-session
  logout uses `POST /revoke-sessions`, which removes the session rows and cuts
  `sid`-carrying tokens of that person. The client clears protected cached
  state.
- **Desktop.** PKCE S256, exact loopback redirect, system browser, no embedded
  secret. Logout revokes the refresh token at `/auth/oauth2/revoke`, then signs
  out, then clears local state, because sign-out alone leaves a refresh chain
  alive (section 2). Account switching clears the previous person's state.
- **CLI.** RFC 8628 vocabulary, the advertised `interval` honored with backoff,
  refresh rotated on use. Logout revokes the refresh token and deletes the OS
  credential entry; a rotated-token reuse (`invalid_grant`) is treated as a lost
  credential requiring a new device flow.
- **Services.** `client_credentials` with the ceiling in
  `client_credentials_scopes`, linked to the resources they call. Cutoff is
  deletion or a TTL-bounded wait after rotation (section 2).

## 7. Human confirmation

Unchanged in substance. The kernel mints a single-use challenge naming the
digest of the proposed decision, the person, the Case, the gate node and the
client identity the Google token must carry. The person answers it in Google's
own account prompt; the kernel verifies Google's signature, issuer, recorded
audience, token age and nonce through the library's verifier, consumes the
challenge, and seals the result as the kernel's `google-signed-decision`
envelope. Qualification and separation of duties are checked against the record
at decision time. Neither a session, a refresh, a machine token nor another
person's proof satisfies a decision.

## 8. Frozen profiles and the sealed envelopes

Inspected at kernel `d29fa731`, plane `702dbf8b`, console `73d4e84`.

| Profile                                           | Producer today                   | Status                                                                             |
| ------------------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------- |
| `dsg.core.identity-binding/1`                     | none                             | the detached personal-key binding path only; kernel's live path is Google-attested |
| `dsg.run.decision/1`                              | none anywhere                    | frozen and unused; do not delete a released profile                                |
| `dsg.core.refusal/1`                              | kernel refusals                  | still emitted; bytes untouched                                                     |
| `dsg.core.refusal/2`                              | new authentication routes        | adds `validation_unavailable`, `confirmation_expired`                              |
| `google-signed-decision`, `google-signed-binding` | kernel API via `packages/record` | the real sealed artifacts; kernel-owned shapes, no IDL profile                     |

The `signature` field on both frozen profiles keeps its documented meaning: a
detached signature by a key the person holds, verified against the person's
recorded public key. The Google-attested channel is a different artifact with
different fields and is not emitted under those literals. No new IDL profile is
minted now: the envelopes have exactly one consumer, the kernel that writes
them. The trigger is named: the first external consumer (the console's
browser-side evidence verification or the plane's evidence sealing) lifts the
envelope shape from `packages/record/src/decision-envelope.ts` and
`binding-envelope.ts` into `dsg-idl` at that point, and both sides pin it.

## 9. Errors

Version selection: new authentication routes emit `dsg.core.refusal/2`; `/2` is
a superset of `/1`'s codes, so a `/2` reader accepts every `/1` document while a
`/1` reader rejects the two new codes by design. A consumer that must read
authentication refusals moves to `/2` in its implementation chunk before those
routes ship. No dual-emit window exists, because the new codes appear only on
routes that do not exist yet.

| Code                                                                                                                                                                    | Status | Where                     | Recovery                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------- | ------------------------------------- |
| `invalid_client`                                                                                                                                                        | 401    | token, introspect, revoke | fix the client credential             |
| `invalid_token`                                                                                                                                                         | 401    | protected routes          | re-authenticate                       |
| `session_expired`                                                                                                                                                       | 401    | protected routes          | sign in again                         |
| `identity_unbound`                                                                                                                                                      | 403    | protected routes          | bind the principal in the record      |
| `not_dsg_account`                                                                                                                                                       | 403    | sign-in, enrollment       | use a workspace account               |
| `principal_suspended`                                                                                                                                                   | 403    | protected routes          | an administrator lifts the suspension |
| `confirmation_expired`                                                                                                                                                  | 403    | decision routes           | mint a new challenge                  |
| `validation_unavailable`                                                                                                                                                | 503    | protected routes          | retry when validation answers         |
| `invalid_request`, `invalid_grant`, `invalid_scope`, `invalid_target`, `unsupported_token_type`, `authorization_pending`, `slow_down`, `expired_token`, `access_denied` | 400    | OAuth endpoints           | RFC-standard vocabularies             |

Two measured specifics: a PKCE verifier mismatch with an otherwise valid code
answers `invalid_grant` (RFC 6749), and revoking a JWT directly answers
`unsupported_token_type`. The freshness-cap refusal at the token endpoint uses
`invalid_grant`. No refusal carries a credential or identity detail beyond the
recorded sentence.

## 10. Client registrations and configuration

One registration table. These are Better Auth clients, not Google clients. The
Google web client is separate and used only by the provider.

| Registration          | Client type               | Grant types                                                     | Token endpoint auth   | Redirect / verification                  | Scopes                                 | Resources      |
| --------------------- | ------------------------- | --------------------------------------------------------------- | --------------------- | ---------------------------------------- | -------------------------------------- | -------------- |
| `dsg-console-web`     | web, `skip_consent: true` | `authorization_code`, `refresh_token`                           | `none` (public, PKCE) | `https://<console-domain>/auth/callback` | `openid`, `offline_access`, `api:read` | kernel, plane  |
| `dsg-desktop`         | native                    | `authorization_code`, `refresh_token`                           | `none` (public, PKCE) | loopback, exact                          | `openid`, `offline_access`, `api:read` | kernel, plane  |
| `dsg-cli`             | native                    | `urn:ietf:params:oauth:grant-type:device_code`, `refresh_token` | `none`                | device verification URI on the console   | `openid`, `offline_access`, `api:read` | kernel         |
| `dsg-console-service` | service                   | `client_credentials`                                            | `client_secret_basic` | n/a                                      | `api:read`                             | kernel, plane  |
| `dsg-plane-service`   | service                   | `client_credentials`                                            | `client_secret_basic` | n/a                                      | `api:read`                             | kernel         |
| `dsg-probe-*`         | test only, never deployed | as needed                                                       | as needed             | probe redirects                          | probe scopes                           | probe resource |

| Key                                                       | Owner                          | Purpose                                                                                                                                |
| --------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `KERNEL_AUTH_BASE_URL`                                    | dsg-run-console                | public issuer and entry point                                                                                                          |
| `KERNEL_AUTH_ISSUER`                                      | dsg-kernel, dsg-run            | expected `iss`                                                                                                                         |
| `KERNEL_RESOURCE_IDENTIFIER`, `PLANE_RESOURCE_IDENTIFIER` | dsg-kernel, dsg-run            | token audiences                                                                                                                        |
| `BETTER_AUTH_SECRET`                                      | dsg-secret-store               | session and token signing secret                                                                                                       |
| JWKS signing keys                                         | dsg-secret-store               | minted and held by the kernel's `jwt` plugin; private key never leaves the kernel's secret mount, public halves served at `/auth/jwks` |
| `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_WEB_CLIENT_SECRET`        | dsg-secret-store               | browser sign-in; the secret is used only by the kernel's provider, never by a client                                                   |
| `GOOGLE_WORKSPACE_DOMAIN`                                 | dsg-kernel                     | `hd` value enrollment and confirmation require                                                                                         |
| `KERNEL_MAX_UPSTREAM_AUTH_AGE_SECONDS`                    | dsg-kernel                     | refresh-age limit, default 86400                                                                                                       |
| `KERNEL_JWKS_CACHE_SECONDS`                               | dsg-kernel                     | key cache bound, default 300                                                                                                           |
| `INTROSPECTION_CACHE_SECONDS`                             | dsg-run, dsg-run-console       | acceptance cache bound, default 60                                                                                                     |
| `KERNEL_SUSPENSION_CACHE_SECONDS`                         | dsg-kernel                     | suspension read bound, default 5                                                                                                       |
| `SERVICE_PEER_RANGES`                                     | dsg-infra                      | the addresses whose service-token headers are trusted                                                                                  |
| `WORKSPACE_DIRECTORY_DELEGATION`                          | dsg-secret-store, Google admin | the delegation in 5.2; absent until Sayer acts                                                                                         |

Local development uses a separate issuer, separate registrations, separate
secrets and its own containers. The dev-identity shortcut
(`KERNEL_DEV_IDENTITY`, `trustActorHeader`, `x-kernel-actor`) is deleted in the
kernel chunk.

## 11. Migration inventory

Source revisions: kernel `d29fa731`, plane `702dbf8b`, console `73d4e84`.

| Old mechanism                                       | Real location                                                                                                                                         | Replacement                                                                         | Deletion chunk                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------- |
| Dev identity shortcut                               | `apps/api/src/config.ts`, `apps/api/src/app.ts` (`devIdentity`), `apps/cli/src/auth.ts` (`x-kernel-actor`)                                            | local issuer, same protocol                                                         | kernel auth owner                             |
| IAP person transport                                | `dsg-run/service/src/http/kernel-relay.ts` (`x-goog-iap-jwt-assertion`, `x-kernel-person-assertion`), `dsg-kernel/apps/api/src/auth/console-relay.ts` | person token plus `X-DSG-Service-Token`; IAP stays at the edge only                 | plane relay chunk                             |
| Console service calls with no person credential     | `dsg-run-console/api/src/plane-relay.ts`                                                                                                              | the 4.2 code exchange, then person token plus service token                         | console backend chunk                         |
| Public human IAP gate on the console domain         | console front door configuration                                                                                                                      | Better Auth sign-in; the domain and private upstreams stay                          | console backend chunk, dsg-infra for the gate |
| Existing Better Auth surface, no provider plugins   | `dsg-kernel/apps/api/src/auth/google.ts` (1.7.2), `apps/cli/src/auth.ts` (device client)                                                              | 1.7.4 with `jwt`, `oauthProvider`, `oauthDeviceAuthorization`, the refresh-age hook | kernel auth owner                             |
| Google-attested decisions and bindings              | `apps/api/src/routes/decisions.ts`, `identity-binding.ts`, `packages/record/src/*-envelope.ts`                                                        | unchanged                                                                           | none                                          |
| Record enrollment through the IAP relay             | `apps/api/src/routes/organization-access.ts`                                                                                                          | the same enrollment driven by a verified sign-in                                    | kernel auth owner                             |
| `dsg.core.identity-binding/1`, `dsg.run.decision/1` | re-export only, no producer                                                                                                                           | unchanged, frozen                                                                   | none                                          |

Old tokens stop being accepted at cutover; there is no dual-accept window for
human identity, because a token minted against the old authority cannot be
validated against the new one. Rollback cannot restore invalidated authority.

## 12. Deferred acceptance

Real people and infrastructure: browser, desktop and CLI sign-in end to end;
first organization access; outsider refusal; suspension including an open
stream; desktop logout with refresh revocation; CLI revocation through refresh
rotation; wrong-resource refusal; forged header refusal; machine and person
credential separation; confirmation mutation and replay; deployed front door.
Dependencies this delivery does not fabricate: a member account, a non-member
account, two qualified decision-makers, OAuth registration access, a desktop
signing identity, and the Workspace Directory delegation in 5.2.

## 13. Corrections by revision

| Revision | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 → 2    | Per-grant revocation evidence; per-hop transport; frozen-profile assessment; identity mapping and Directory blocker; per-method routes; refusal version selection; runnable probe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 2 → 3    | Membership: application refresh provably does not contact Google, so the lifetime bound is withdrawn and replaced by a refresh-age limit enforced through a supported `hooks.before` over stored `authTime` (probe-proven), with Directory still named as the tighter option. Rotation: separated from bearer revocation by measurement, and client deletion, old-secret rejection and old-token acceptance are now three distinct assertions. Browser relay: the console's cookie-to-person-token path is defined and measured through the library, with cookie scope and the public/private path table. Logout: desktop and CLI logout now include refresh revocation because sign-out alone leaves a chain alive; all-session logout is measured. Errors: PKCE mismatch is `invalid_grant`, JWT revocation is `unsupported_token_type`. Probe: assertions, required-scenario accounting, unique container, ephemeral loopback port, truthful teardown, no token material in output |
