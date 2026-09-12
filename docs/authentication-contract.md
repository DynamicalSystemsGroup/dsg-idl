# Shared authentication contract

Status: normative, revision 5. Supersedes revision 4 (`6b5ce39`).
Section 13 records the corrections. Automatic Google Workspace offboarding
is an explicit deployment dependency, not a capability of application refresh.

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
loopback port, asserts the required scenarios over the in-process handler, prints one
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
keep no session store. The browser is not an OAuth client: it calls only the
session routes (`/auth/sign-in/social`, `/auth/callback/:id`,
`/auth/get-session`, `/auth/sign-out`, `/auth/revoke-session*`) through the
console's transport proxy. The `oauth2/*` routes below are reached only by
desktop, CLI, and the confidential service clients that mint their own
`client_credentials` tokens; no code carrying a person leaves the console.

| Path                                                                  | Method            | Reachability | Credential                                                                                                       |
| --------------------------------------------------------------------- | ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `/auth/sign-in/social`                                                | POST              | public       | none (provider in the body)                                                                                      |
| `/auth/callback/:id` (`:id` = `google`)                               | GET or POST       | public       | none                                                                                                             |
| `/auth/get-session`                                                   | GET or POST       | public       | session cookie; null on a forged cookie                                                                          |
| `/auth/sign-out`                                                      | POST              | public       | session cookie                                                                                                   |
| `/auth/revoke-session`                                                | POST              | public       | session cookie                                                                                                   |
| `/auth/revoke-sessions`                                               | POST              | public       | session cookie; ends every session for the person                                                                |
| `/auth/revoke-other-sessions`                                         | POST              | public       | session cookie                                                                                                   |
| `/auth/.well-known/oauth-authorization-server`                        | GET               | public       | none                                                                                                             |
| `/auth/.well-known/openid-configuration`                              | GET               | public       | none                                                                                                             |
| `/auth/jwks`                                                          | GET               | public       | none                                                                                                             |
| `/auth/oauth2/authorize`                                              | GET               | public       | session cookie; desktop and CLI only; redirects to the hosted consent page unless the client sets `skip_consent` |
| `/auth/oauth2/consent`                                                | POST              | public       | session cookie; body `{ accept, oauth_query }`                                                                   |
| `/auth/oauth2/token`                                                  | POST              | public       | per grant; public clients send `client_id` in the body                                                           |
| `/auth/oauth2/introspect`                                             | POST              | public       | client credentials, plus a resource link (4.4)                                                                   |
| `/auth/oauth2/revoke`                                                 | POST              | public       | client credentials or `client_id`                                                                                |
| `/auth/oauth2/userinfo`                                               | GET               | public       | access token                                                                                                     |
| `/auth/oauth2/end-session`                                            | GET or POST       | public       | `id_token_hint` (RP-initiated logout) or `client_id` alone, which requires explicit confirmation (3.5)           |
| `/auth/oauth2/end-session/confirm`                                    | POST              | public       | signed, short-lived confirmation cookie set by `/end-session`; form body                                         |
| `/auth/device/code`                                                   | POST              | public       | none                                                                                                             |
| `/auth/device`                                                        | GET               | public       | session cookie; claims a pending `user_code`                                                                     |
| `/auth/device/approve`, `/auth/device/deny`                           | POST              | public       | session cookie; body `{ userCode }`, camelCase                                                                   |
| `/auth/admin/oauth2/*`                                                | POST/PATCH/DELETE | server-only  | no HTTP route; `auth.api.*` with an admin session                                                                |
| `/decisions/:kind/challenge`, `/decisions/:kind`                      | POST              | private      | session or PKCE token, plus fresh Google proof for the decision                                                  |
| `/principals/access`, `/principals/identity`, `/principals/bindings*` | GET/POST          | private      | person credential or plane service credential                                                                    |

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

| Public path                                                                 | Destination                                                 | Who uses it                               |
| --------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------- |
| `https://<console-domain>/auth/*` (session routes)                          | kernel API, through the console's transport proxy (private) | browsers                                  |
| `https://<console-domain>/auth/*` (`oauth2/*`, `device/*`, discovery, JWKS) | kernel API (private)                                        | desktop, CLI, service clients, validators |
| `https://<console-domain>/decisions/*`, `/principals/*`                     | kernel API (private)                                        | console API relay, plane, desktop, CLI    |
| `https://<console-domain>/api/*`                                            | console API (private)                                       | browser                                   |
| `https://<console-domain>/api/runs/*`                                       | console API, which relays to the plane                      | browser                                   |
| `https://<console-domain>/` and page routes                                 | console (private)                                           | browser                                   |

The transport proxy forwards method, status, `Location` and every `Set-Cookie`
unchanged and adds no authority of its own. It never issues, exchanges or
caches a token on the browser's behalf (4.2). Validation and bootstrap
requests take the same path: a validator outside the kernel introspects
through `/auth/*`; the kernel validates itself in process and never
introspects itself.

### 3.3 Cookie scope

The session cookie is issued by the public issuer host, `Secure`, `HttpOnly`,
`SameSite=Lax`, `Path=/`, and no `Domain` attribute (host-only for the console
domain). `Path=/` is required because the product routes and the hosted pages
are not under `/auth`. Mutations carry an origin check; a missing or foreign
origin is refused. `SameSite=Lax` still sends the cookie on the top-level
redirect back from Google, which is why it works for the callback. The cookie
is opaque outside the kernel: the console and the plane forward it verbatim in
`x-kernel-user-cookie` and never parse or verify it themselves (4.2).

### 3.4 Per-hop audience

One rule, stated once in section 4: every hop checks the audience of every
credential it receives, for its own resource. This table names each hop's
credential and the resource its audience must include.

| Hop                      | Credential                                     | Audience checked            | Checked by                                             |
| ------------------------ | ---------------------------------------------- | --------------------------- | ------------------------------------------------------ |
| Browser to console       | session cookie                                 | n/a (opaque to the console) | not checked here; the kernel resolves it (4.2)         |
| Console to kernel        | `X-DSG-Service-Token` (`dsg-console-service`)  | kernel resource             | kernel, `resolveServiceToken(token, kernelResource)`   |
| Console to plane         | `X-DSG-Service-Token` (`dsg-console-service`)  | plane resource              | plane, `verifyBearerToken` (forced remote)             |
| Desktop or CLI to kernel | `Authorization: Bearer <PKCE or device token>` | kernel resource             | kernel, `requireActive(token, kernelResource)`         |
| Desktop to plane         | `x-kernel-user-authorization` (PKCE token)     | plane resource              | plane, `verifyBearerToken`, `audience = planeResource` |
| Plane to kernel          | `X-DSG-Service-Token` (`dsg-plane-service`)    | kernel resource             | kernel, `resolveServiceToken(token, kernelResource)`   |

A credential minted for one resource is refused at every other resource's
validator. Nothing in this table is a cache: 4.5 states the freshness each
check keeps.

### 3.5 Desktop logout order

Two independent facts, tracked separately by the desktop client because one
does not imply the other: **grant state** (`POST /auth/oauth2/revoke` on the
refresh token) and **issuer-session cleanup** (a completed
`/auth/oauth2/end-session`). Revoking the refresh token never ends the issuer
session by itself.

1. Generate a fresh logout `state` for every attempt, distinct from the
   login flow's `state` and from any earlier logout attempt's `state`. Store
   it with the attempt and mark cleanup `pending`.
2. A first attempt opens `/auth/oauth2/end-session` with the retained
   `id_token` as `id_token_hint`, sent unread and uninspected regardless of
   its own `exp` - the desktop never parses or validates the hint locally,
   only the provider does, and only the provider's answer counts. It also
   carries `client_id=dsg-desktop`,
   `post_logout_redirect_uri=http://127.0.0.1:45877/`, and the fresh logout
   `state`. **Measured:** a hint matching the current session ends it at once
   and redirects with that exact `state` echoed back
   (`logout.correlated-success-state-echo`).
3. An explicit retry after an earlier attempt went **uncertain** (rule 5)
   opens `/auth/oauth2/end-session` again with a fresh `state` but no
   `id_token_hint`: the desktop does not know whether the prior attempt's
   hint was already consumed, and resending a possibly-consumed hint is
   indistinguishable from resending nothing, so the retry never carries one.
   `client_id` and `post_logout_redirect_uri` stay the same.
4. A loopback callback completes an attempt only when its `state` matches
   exactly the one stored for that attempt - missing, stale, unknown,
   duplicate, or login-flow `state` values are all unsolicited and ignored,
   never completing or restarting the attempt. A logout callback's own
   `code` or `error` query parameter is never read as a success or failure
   signal; only the matched `state` plus the redirect having occurred at all
   counts.
5. Outcomes: a correlated success redirect marks cleanup `done`, then
   revokes the refresh token; the desktop's own local cancel (the user
   dismisses the desktop's pre-launch prompt before the provider is ever
   reached) restores the logout record to whatever it was before this
   attempt and revokes nothing; a shown confirmation page waits for that
   decision; no correlated callback (timeout, closed browser, lost
   response, network failure) is **uncertain** and cleanup stays `pending`,
   with both entries kept, until an explicit retry (rule 3) or another
   local cancel resolves it.
6. With the hint expired, rejected, or absent, `/auth/oauth2/end-session`
   still requires `client_id` and the registered `post_logout_redirect_uri`
   to validate the redirect, and still requires an explicit confirmation
   before ending anything. The provider's own page offers Confirm only -
   there is no deny or cancel action on that page, and silence (the user
   closing the tab, or never acting) is never itself a rejection; it simply
   never produces a correlated callback, landing on the uncertain outcome in
   rule 5. **Measured:** with a session and no hint, the issuer serves its
   confirmation page (`logout.no-hint-confirmation-page`); confirming ends
   the session and echoes the same `state`
   (`logout.no-hint-confirmed-state-echo`); an unknown `client_id` is refused
   before any confirmation page exists (`logout.unknown-client-refused`).
7. Revoking the refresh token (rule 5) is idempotent: a repeat revoke of an
   already-revoked token, or a revoke of a token the issuer no longer
   recognizes, both succeed. `invalid_grant` on `/auth/oauth2/revoke` means
   the grant is already ended, never a distinct failure to retry or surface
   differently; nothing matches on the error's text, only on the RFC 7009
   200-with-`invalid_grant` shape.

The CLI's logout is grant-only: it revokes the refresh token and never calls
`/auth/oauth2/end-session`. `dsg-cli` is registered without end-session
privilege, so a call naming it is refused outright
(`logout.device-client-refused`), independent of session state. Section 6
states the browser and CLI lifecycles; this section is normative for the
desktop.

## 4. Credential transport

One `Authorization` header per request, naming the acting principal. A service
acting for a person adds its own credential in a separate header.

### 4.1 Names

| Carrier                               | Direction                                                     | Content                                                                          |
| ------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `Authorization: Bearer <token>`       | desktop or CLI to kernel; plane to kernel; service to service | the acting credential                                                            |
| `X-DSG-Service-Token: Bearer <token>` | console to plane, plane to kernel, console to kernel          | the calling service's `client_credentials` token                                 |
| session cookie                        | browser to console                                            | `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` (3.3)                             |
| `x-kernel-user-cookie`                | console to kernel, console to plane, plane to kernel          | the browser's session cookie, forwarded verbatim and unparsed outside the kernel |
| `x-kernel-user-authorization`         | console to plane, plane to kernel                             | the desktop's person bearer token, forwarded verbatim                            |
| `x-goog-iap-jwt-assertion`            | infrastructure front door only                                | transport identity; verified at the edge, never accepted as authority downstream |

`X-DSG-Service-Token` replaces the retired `x-kernel-person-assertion`. No hop
forwards a person assertion as authority any more. `x-kernel-user-cookie` and
`x-kernel-user-authorization` are mutually exclusive per request: a request
carrying both, or either arriving as a header array, is refused before any
credential is installed (5).

### 4.2 Browser to console to plane to kernel

The browser holds only the cookie. It is never exchanged for a token, and no
bearer token of any kind reaches browser JavaScript.

1. The browser calls the console with its cookie. No `Origin` is required on a
   read; a missing or foreign `Origin` is refused only on a cookie-bearing
   mutation (3.3).
2. Before relaying, the console obtains its own machine token with supported
   library operations (`oauth4webapi.clientCredentialsGrantRequest`), never
   with a handwritten exchange: `resource = kernelResource` for a kernel call,
   `resource = planeResource` for a plane call. Two separate single-resource
   tokens, never one token good for both (3.4). A missing `expires_in` is a
   failure, never a default. The console caches each token in memory until
   `expires_in` minus a margin.
3. If the token endpoint is unavailable and no usable cached token remains,
   the console returns 503, not an anonymous session and not
   `session_expired` (4.6). A person's cookie is never enough by itself; the
   console's own credential is required before the kernel will accept the
   relay.
4. Kernel product call: `X-DSG-Service-Token: Bearer <console token, aud
kernel>` and `x-kernel-user-cookie: <the exact Cookie header>`. No person
   `Authorization`.
5. Plane live call: IAP transport (`Proxy-Authorization`, never a person),
   `X-DSG-Service-Token: Bearer <console token, aud plane>`, and the same
   `x-kernel-user-cookie`. The plane validates the console token's audience
   before doing anything else, then substitutes its own token on the kernel
   hop (4.3, "Console to plane" and "Plane to kernel").

The cookie is opaque outside the kernel. Neither the console nor the plane
parses it, derives a subject from it, or accepts it as proof of anything by
itself; only the kernel's `getSession` resolves it, inside the relay hook
described in section 5. **Measured:** a console-shaped, kernel-audience
service token is accepted at the kernel validator and refused at the plane
validator, and a plane-audience service token is accepted at the plane
validator and refused at the kernel validator
(`service-relay.kernel-token-audience`, `service-relay.plane-token-audience`
and their cross-audience refusals).

Reload uses the cookie as-is. Sign-out clears queries and streams, then
`authClient.signOut()`. Account change is sign out, then sign in; Google's
chooser comes from `socialProviders.google.prompt`. Drop late responses keyed
to the previous session's user id. Stream reads repeat the session and
authorization checks on a heartbeat no slower than five seconds.

### 4.3 Hop by hop

- **Browser to console.** Cookie only, origin-checked on mutations, never
  exchanged for a token.
- **Desktop to kernel.** `Authorization: Bearer <PKCE token>`; refresh token in
  the OS credential store.
- **CLI to kernel.** `Authorization: Bearer <device token>`; refresh token in
  the OS credential store.
- **Console to kernel.** `X-DSG-Service-Token` (aud kernel) plus
  `x-kernel-user-cookie`, as in 4.2.
- **Console to plane.** IAP transport, `X-DSG-Service-Token` (aud plane) plus
  `x-kernel-user-cookie` or `x-kernel-user-authorization`, as in 4.2.
- **Plane to kernel.** The plane validates the incoming console token for the
  plane audience and, for a bearer person credential, validates that bearer
  for the plane audience too, **before** doing anything else. It then obtains
  its own `X-DSG-Service-Token` (aud kernel) and calls the kernel with that
  token plus the unchanged person header (cookie or bearer). The plane never
  forwards the console's service token as the kernel caller and never
  rewrites the person header.
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
- A confidential client's registered token endpoint authentication method is
  part of its identity, not a preference: every call it makes — issuing its
  own tokens and, for a client the issuer also introspects for, presenting
  credentials to `/oauth2/introspect` — must use that exact wire shape, or
  the issuer refuses it as a method mismatch before it ever checks the
  secret. The console's service client uses `client_secret_basic` (an
  `Authorization: Basic` header); the plane's service client uses
  `client_secret_post` (`client_id`/`client_secret` as body form fields).
  The difference exists because only the plane forces remote introspection
  on every incoming credential (4.5), and that call's wire shape is fixed;
  the console never calls introspection directly, so its client keeps the
  header-based method.

### 4.5 Validation calls and freshness

| Check                                   | Call                                                                                  | Freshness                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Session cookie (in kernel)              | in-process session read                                                               | every request                                                                                      |
| In-process acceptance (kernel)          | `getOAuthProviderApi(ctx, options).requireActiveAccessToken(token, expectedResource)` | every request; measured equal to introspection                                                     |
| Console or kernel service token (plane) | `verifyBearerToken`, `audience = planeResource`, remote verification forced           | every request; no local cache substitutes for it                                                   |
| Person bearer at the plane (desktop)    | `verifyBearerToken`, `audience = planeResource`, remote verification forced           | every request                                                                                      |
| Console or plane service token (kernel) | `resolveServiceToken(token, kernelResource)`                                          | every request                                                                                      |
| Stream re-check (plane, console)        | the same validation calls above, repeated                                             | the existing periodic interval (`INTROSPECTION_CACHE_SECONDS`, default 60 s); never once per event |
| Suspension                              | kernel record read                                                                    | 5 s                                                                                                |
| Machine cutoff                          | introspection or forced verification after delete                                     | next check                                                                                         |

Forced remote verification removes the plane's own accept-cache: `force:
true` on `verifyBearerToken` means every checked token gets a live kernel
round trip on every plane request, not a cached result reused within a
window. A cookie relay checks the console's service token; a person-bearer
request also checks the person token, so a desktop call to the plane costs
two kernel round trips. A long-lived stream does not add a check per event:
it re-runs the same validation on the existing periodic interval, unchanged
from before this migration. `INTROSPECTION_CACHE_SECONDS` continues to name
that interval even though the plane's own token acceptance is no longer
cached; only the stream's re-check cadence still reads it.

### 4.6 No cached success on a state-changing request

Forced verification means there is no accept-cache at the plane to fall back
on. A state-changing request never proceeds on a stale or assumed-good
credential:

- Every mutation, every decision, and every dispatch requires a fresh check.
  If the validator the check depends on cannot answer, the request is
  refused with `validation_unavailable` (503). It is not queued and not
  retried optimistically.
- The console's own machine-token acquisition is a distinct failure mode from
  verifying an inbound credential: if the token endpoint is unavailable and
  no usable cached machine token remains, the console returns 503 rather
  than an anonymous session or `session_expired` (4.2).
- The kernel validates itself in process, so kernel-internal authorization
  never depends on a network call to authentication. External validators
  (the plane, the console) depend on the kernel and fail closed when it is
  unreachable: a kernel outage is 503 at the plane, never an empty result
  treated as "no access."
- Reads may still use a bound freshness window where the operation does not
  require a fresh check (the stream re-check interval in 4.5); a
  state-changing request never does.

### 4.7 Forged and conflicting credentials

- Inbound `X-DSG-Service-Token` and `x-goog-iap-jwt-assertion` are stripped
  unless the request arrives from the configured peer range.
- The person and calling service are deliberately different principals. Each
  credential must have its expected class, audience and registered client.
  Conflicting credentials for the same acting-person slot are refused. A service
  token cannot replace, overwrite or impersonate that person.
- A machine token never satisfies a human act; decisions require fresh Google
  proof regardless of the token that carried the request.

### 4.8 Google infrastructure credentials

The Google service accounts that reach GCP APIs stay, carrying infrastructure
identity only. IAP is removed as the **human gate** on the console domain (that
is what the migration replaces) and remains where it already protects
machine-facing infrastructure. Where it remains, its assertion is verified at
the edge for transport and is never rewritten into person authority: the
person's Better Auth token is what the kernel trusts, and a Google service
account is never accepted as a person. Where an outbound hop still crosses IAP, its transport token goes in
`Proxy-Authorization: Bearer <Google transport token>`; `Authorization` and
`X-DSG-Service-Token` keep their application meanings. The edge verifies its
IAP assertion and the backend prevents direct ingress. Transport identity
never selects the acting person.

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

### 5.2 Workspace membership and offboarding

Google sign-in establishes a point-in-time identity observation. The kernel
verifies Google's issuer, stable subject and hosted-domain claim against the
recorded organization policy. Email suffix alone never admits someone.
Application refresh does not contact Google and does not establish current
Workspace membership.

The pinned library has these measured provenance and lifetime boundaries:

| Credential                          | Timestamp source                                                                             | What the candidate refresh-age hook actually does                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser cookie                      | Better Auth `session.createdAt`, retained on ordinary renewal                                | Nothing. An old but unexpired cookie still reads successfully and can obtain a new code.                                                            |
| Authorization code and PKCE refresh | Code copies `session.createdAt`; refresh row `authTime` and ID-token `auth_time` preserve it | Refuses a later refresh at or after the limit. A token issued just before the limit remains active afterward. Initial code exchange is not covered. |
| Device grant and refresh            | Device redemption passes no `sessionId` or `authTime`; stored `authTime` is null             | A fail-closed provenance check refuses even a fresh device refresh. Initial device issuance and access still succeed.                               |

Session creation is a local library timestamp, not Google's `auth_time` or proof
of a password entry. A production session can be treated as a new Google
observation only when it was created by the verified Google callback. The probe
uses synthetic email sign-in and proves library behavior only. Renewing a
session, issuing an application grant or rotating a refresh token must never be
reported as a fresh Google observation. Missing, invalid or future provenance
cannot satisfy a freshness requirement.

**Revision 3's refresh-age hook is withdrawn from the production contract.**
It cannot enforce a common upstream-authentication limit across the approved
clients. The probe retains it solely as a counterexample, including the
near-limit token, old-cookie grant and device-refresh refusal. Do not copy it
into the kernel or configure a purported 24-hour offboarding guarantee.

The selected baseline offboarding mechanism is **recorded suspension**. Every
protected request checks it with the five-second bound in 5.1. Until Directory
integration exists, an administrator must record suspension to cut off a
removed Workspace member. A failed future Google sign-in refuses that sign-in;
it does not retroactively revoke that person's other application credentials.

The bounds are explicit. An individual access token lasts at most 3600 seconds,
and validation caches never extend `exp`. That is not an offboarding bound:
rolling sessions and refresh chains can keep issuing credentials. Without a
recorded suspension or fresh Directory observation there is **no finite
automatic Workspace-removal detection bound** for any of the three clients.
A refresh-age check on one endpoint does not change that conclusion.

Automatic Workspace offboarding requires a verified Directory `users.get`
observation, including deletion and `suspended`, keyed by the Google-linked
identity, followed by the existing record suspension path. The read-only
`admin.directory.user.readonly` scope and domain-wide delegation require
Workspace administrator action. That integration, its observation interval,
and its outage behavior must be accepted before claiming bounded automatic
Workspace offboarding. No Directory permission or observation was created by
this contract task. This dependency does not prevent implementing sign-in,
manual recorded suspension or the other approved client flows.

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

| Profile                                           | Producer today                                   | Status                                                                                                                                                                              |
| ------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dsg.core.identity-binding/1`                     | none                                             | the detached personal-key binding path only; kernel's live path is Google-attested                                                                                                  |
| `dsg.run.decision/1`                              | none anywhere                                    | frozen and unused; do not delete a released profile                                                                                                                                 |
| `dsg.core.refusal/1`                              | kernel refusals                                  | still emitted; bytes untouched                                                                                                                                                      |
| `dsg.core.refusal/2`                              | new authentication routes, dsg-run-console proxy | adds `validation_unavailable`, `confirmation_expired`; amended in place (2026-09-11) with optional `stage`/`correlationId` for the proxy hop, not a /3 - the system has not shipped |
| `google-signed-decision`, `google-signed-binding` | kernel API via `packages/record`                 | the real sealed artifacts; kernel-owned shapes, no IDL profile                                                                                                                      |

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
a superset of `/1`'s **code values**, but each schema retains its distinct
literal `profile`. A `/2` schema rejects a `/1` document. A consumer reading
both versions must dispatch on `profile` to `RefusalSchema` or
`RefusalV2Schema`, or validate against their explicit TypeBox union. Unknown
versions fail closed. Both schemas retain their frozen literals and neither
rewrites historical bytes. Consumers add this reader before the new routes
ship. No dual-emit window exists, because the new codes appear only on
routes that do not exist yet.

The dsg-run-console proxy answers with the origin's own `/2` body, unchanged,
plus two fields the origin never sets: `stage: "proxy"` names the hop that
answered, and `correlationId` carries the proxy's own request id. Both are
optional on the shared schema (2026-09-11) - an origin refusal has neither,
and a reader that does not know them ignores them, since the schema was not
narrowed. This replaces the `X-DSG-Refusal-Stage` / `X-Request-ID` header
pair: the same two facts travel in the body a validator already parses,
never in headers a validator would otherwise ignore.

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

The OAuth table gives the usual error statuses. The pinned library has a
measured exception: a PKCE verifier mismatch with an otherwise valid code
answers HTTP 401 `invalid_request` in the pinned library, and revoking a JWT directly answers
`unsupported_token_type`. The candidate age hook uses `invalid_grant`; it is not a production
offboarding mechanism. No refusal carries a credential or identity detail beyond the
recorded sentence.

## 10. Client registrations and configuration

One registration table. These are Better Auth clients, not Google clients. The
Google web client is separate and used only by the provider.

| Registration          | Client type                                 | Grant types                                                     | Token endpoint auth          | Redirect / verification                  | Post-logout redirect                     | Scopes                                 | Resources      |
| --------------------- | ------------------------------------------- | --------------------------------------------------------------- | ---------------------------- | ---------------------------------------- | ---------------------------------------- | -------------------------------------- | -------------- |
| `dsg-console-web`     | web, confidential BFF, `skip_consent: true` | `authorization_code`, `refresh_token`                           | `client_secret_basic` (PKCE) | `https://<console-domain>/auth/callback` | none registered                          | `openid`, `offline_access`, `api:read` | kernel, plane  |
| `dsg-desktop`         | native                                      | `authorization_code`, `refresh_token`                           | `none` (public, PKCE)        | loopback, exact                          | `http://127.0.0.1:45877/`, exact (3.5)   | `openid`, `offline_access`, `api:read` | kernel, plane  |
| `dsg-cli`             | native                                      | `urn:ietf:params:oauth:grant-type:device_code`, `refresh_token` | `none`                       | device verification URI on the console   | none registered; grant-only logout (3.5) | `openid`, `offline_access`, `api:read` | kernel         |
| `dsg-console-service` | service                                     | `client_credentials`                                            | `client_secret_basic`        | n/a                                      | n/a                                      | `api:read`                             | kernel, plane  |
| `dsg-plane-service`   | service                                     | `client_credentials`                                            | `client_secret_basic`        | n/a                                      | n/a                                      | `api:read`                             | kernel         |
| `dsg-probe-*`         | test only, never deployed                   | as needed                                                       | as needed                    | probe redirects                          | probe redirects                          | probe scopes                           | probe resource |

| Key                                                       | Owner                          | Purpose                                                                                                                                                                                           |
| --------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KERNEL_AUTH_BASE_URL`                                    | dsg-run-console                | public issuer and entry point                                                                                                                                                                     |
| `KERNEL_AUTH_ISSUER`                                      | dsg-kernel, dsg-run            | expected `iss`                                                                                                                                                                                    |
| `KERNEL_RESOURCE_IDENTIFIER`, `PLANE_RESOURCE_IDENTIFIER` | dsg-kernel, dsg-run            | token audiences                                                                                                                                                                                   |
| `BETTER_AUTH_SECRET`                                      | dsg-secret-store               | session and token signing secret                                                                                                                                                                  |
| JWKS signing keys                                         | kernel Better Auth PostgreSQL  | `jwt` generates and encrypts private keys in its database; `BETTER_AUTH_SECRET` is held through dsg-secret-store. Public keys are served at `/auth/jwks`. Never copy private rows into artifacts. |
| `GOOGLE_WEB_CLIENT_ID`, `GOOGLE_WEB_CLIENT_SECRET`        | dsg-secret-store               | browser sign-in; the secret is used only by the kernel's provider, never by a client                                                                                                              |
| `GOOGLE_WORKSPACE_DOMAIN`                                 | dsg-kernel                     | `hd` value enrollment and confirmation require                                                                                                                                                    |
| `KERNEL_JWKS_CACHE_SECONDS`                               | dsg-kernel                     | key cache bound, default 300                                                                                                                                                                      |
| `INTROSPECTION_CACHE_SECONDS`                             | dsg-run, dsg-run-console       | acceptance cache bound, default 60                                                                                                                                                                |
| `KERNEL_SUSPENSION_CACHE_SECONDS`                         | dsg-kernel                     | suspension read bound, default 5                                                                                                                                                                  |
| `SERVICE_PEER_RANGES`                                     | dsg-infra                      | the addresses whose service-token headers are trusted                                                                                                                                             |
| `WORKSPACE_DIRECTORY_DELEGATION`                          | dsg-secret-store, Google admin | the delegation in 5.2; absent until Sayer acts                                                                                                                                                    |

Local development uses a separate issuer, separate registrations, separate
secrets and its own containers. The dev-identity shortcut
(`KERNEL_DEV_IDENTITY`, `trustActorHeader`, `x-kernel-actor`) is deleted in the
kernel chunk.

## 11. Migration inventory

Source revisions: kernel `d29fa731`, plane `702dbf8b`, console `73d4e84`.

| Old mechanism                                       | Real location                                                                                                                                         | Replacement                                                                                                                            | Deletion chunk                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Dev identity shortcut                               | `apps/api/src/config.ts`, `apps/api/src/app.ts` (`devIdentity`), `apps/cli/src/auth.ts` (`x-kernel-actor`)                                            | local issuer, same protocol                                                                                                            | kernel auth owner                             |
| IAP person transport                                | `dsg-run/service/src/http/kernel-relay.ts` (`x-goog-iap-jwt-assertion`, `x-kernel-person-assertion`), `dsg-kernel/apps/api/src/auth/console-relay.ts` | person token plus `X-DSG-Service-Token`; IAP stays at the edge only                                                                    | plane relay chunk                             |
| Console service calls with no person credential     | `dsg-run-console/api/src/plane-relay.ts`                                                                                                              | the browser's cookie forwarded opaquely as `x-kernel-user-cookie`, plus one single-resource `client_credentials` machine token per hop | console backend chunk                         |
| Public human IAP gate on the console domain         | console front door configuration                                                                                                                      | Better Auth sign-in; the domain and private upstreams stay                                                                             | console backend chunk, dsg-infra for the gate |
| Existing Better Auth surface, no provider plugins   | `dsg-kernel/apps/api/src/auth/google.ts` (1.7.2), `apps/cli/src/auth.ts` (device client)                                                              | 1.7.4 with `jwt`, `oauthProvider`, `oauthDeviceAuthorization`                                                                          | kernel auth owner                             |
| Google-attested decisions and bindings              | `apps/api/src/routes/decisions.ts`, `identity-binding.ts`, `packages/record/src/*-envelope.ts`                                                        | unchanged                                                                                                                              | none                                          |
| Record enrollment through the IAP relay             | `apps/api/src/routes/organization-access.ts`                                                                                                          | the same enrollment driven by a verified sign-in                                                                                       | kernel auth owner                             |
| `dsg.core.identity-binding/1`, `dsg.run.decision/1` | re-export only, no producer                                                                                                                           | unchanged, frozen                                                                                                                      | none                                          |

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

| Revision | Correction                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 → 2    | Per-grant revocation evidence; per-hop transport; frozen-profile assessment; identity mapping and Directory blocker; per-method routes; refusal version selection; runnable probe                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 2 → 3    | Membership: application refresh provably does not contact Google, so the lifetime bound is withdrawn and replaced by a refresh-age limit enforced through a supported `hooks.before` over stored `authTime` (probe-proven), with Directory still named as the tighter option. Rotation: separated from bearer revocation by measurement, and client deletion, old-secret rejection and old-token acceptance are now three distinct assertions. Browser relay: the console's cookie-to-person-token path is defined and measured through the library, with cookie scope and the public/private path table. Logout: desktop and CLI logout now include refresh revocation because sign-out alone leaves a chain alive; all-session logout is measured. Errors: PKCE mismatch is `invalid_grant`, JWT revocation is `unsupported_token_type`. Probe: assertions, required-scenario accounting, unique container, ephemeral loopback port, truthful teardown, no token material in output     |
| 4 → 5    | Material change per the accepted design (2026-09-11): the browser is no longer an OAuth client. Sections 3, 4.2, 4.5 and 4.6 are rewritten. The console's cookie-to-person-token PKCE exchange is retired; the browser's cookie is forwarded opaquely as `x-kernel-user-cookie` and resolved only inside the kernel. Each service mints one single-resource `client_credentials` token per hop instead of one token good for both. Forced remote verification (`verifyBearerToken`, `force: true`) replaces the plane's accept-cache; the stream re-check interval is unchanged. A per-hop audience table is added (3.4). The desktop logout order, its `state` correlation, the no-hint confirmation gate and the uncertain-outcome rule are specified (3.5), with `post_logout_redirect_uris` registered for `dsg-desktop`. The CLI's grant-only logout is specified as a registration property, not just a behavioral note. No wire shape changed; the released package is not bumped. |

Revision 4 corrects the wrong-verifier probe to use the first exchange of a
fresh code, with a separate success control and replay assertion. It withdraws
the unsupported common age limit with measured counterexamples for all human
credential classes, defines browser cache ownership and current-cookie checks,
proves the two-resource relay, and specifies explicit refusal version dispatch.
It also resolves the service/person principal wording and retained IAP header
placement.

Revision 5 retires that two-resource relay as production behavior: it was
correct evidence of a library capability, never of what the browser does. The
probe retains the mechanism only to host the age-policy withdrawal
counterexamples in section 5.2, which still need a real code-and-refresh
chain to demonstrate library limits; no production client requests it that
way. Prior revision descriptions above are historical, not current
instructions.

Correction, 2026-09-11: section 11's migration-inventory row for console
service calls still described the retired 4.2 code exchange as the
replacement mechanism after revision 5 had already replaced it with the
opaque cookie relay; the row now names the current mechanism.
