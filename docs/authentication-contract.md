# Shared authentication contract

Status: normative, revision 4. Supersedes revision 3 (`08a9ecd`).
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
   browser's cookie**, its own registered client, repeated `resource` parameters
   naming both kernel and plane when forwarding through both, and PKCE. Because that client sets `skip_consent`, the response is a
   redirect carrying a code and no consent page. **Measured:** 302 with a code,
   no consent page.
3. The console exchanges the code at `/auth/oauth2/token` for a person access
   token whose audience includes the target resource. **Measured:** exchange
   200, `aud` contains the resource.
4. The console calls the plane or kernel with `Authorization: Bearer <person
token>` and `X-DSG-Service-Token: Bearer <console service token>`.

Custody and lifecycle: before every protected browser request, the console
reads `/auth/get-session?disableCookieCache=true&disableRefresh=true` through
the kernel with that request's cookie. A null or expired session returns 401;
a failed session read returns 503. It must perform this check before consulting
its token cache or attempting renewal. The probe verifies null after both
expiry and sign-out. A cached refresh token never substitutes for the cookie.

The console cache is process-local, keyed by the verified session ID, user ID,
client ID, resource set and scope set. It holds only that session's tokens,
never writes them to disk or logs, and drops entries when their session expires
or fails validation. Account switching selects a different entry and clears
previous protected response state. Logout revokes the cached refresh chain,
ends the browser session and evicts the entry. Other replicas also refuse on
their next session read. A restart simply requires another code exchange.

The console client is public with PKCE, `skip_consent: true`, the two resource
links and the exact redirect URI in section 10. Person tokens stay in server
memory and never reach browser JavaScript. Renewal is serialized per cache
entry because refresh rotates on use. Failed renewal evicts the entry and
returns 401; it never falls back to a service credential. Bearer-token expiry
and the current browser session are both required. Stream reads repeat the
session and authorization checks on a heartbeat no slower than five seconds.

A call entering the plane and continuing to the kernel uses the same person
token with **both** audiences. The plane replaces the console's service token
with its own service token on the kernel hop. The probe issues a token from
repeated resource parameters, validates it with independently linked plane and
kernel clients, and refuses a kernel-only token at the plane validator. No
unproven token-exchange grant or audience rewriting is required.

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
a superset of `/1`'s **code values**, but each schema retains its distinct
literal `profile`. A `/2` schema rejects a `/1` document. A consumer reading
both versions must dispatch on `profile` to `RefusalSchema` or
`RefusalV2Schema`, or validate against their explicit TypeBox union. Unknown
versions fail closed. Both schemas retain their frozen literals and neither
rewrites historical bytes. Consumers add this reader before the new routes
ship. No dual-emit window exists, because the new codes appear only on
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

The OAuth table gives the usual error statuses. The pinned library has a
measured exception: a PKCE verifier mismatch with an otherwise valid code
answers HTTP 401 `invalid_request` in the pinned library, and revoking a JWT directly answers
`unsupported_token_type`. The candidate age hook uses `invalid_grant`; it is not a production
offboarding mechanism. No refusal carries a credential or identity detail beyond the
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

| Old mechanism                                       | Real location                                                                                                                                         | Replacement                                                         | Deletion chunk                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| Dev identity shortcut                               | `apps/api/src/config.ts`, `apps/api/src/app.ts` (`devIdentity`), `apps/cli/src/auth.ts` (`x-kernel-actor`)                                            | local issuer, same protocol                                         | kernel auth owner                             |
| IAP person transport                                | `dsg-run/service/src/http/kernel-relay.ts` (`x-goog-iap-jwt-assertion`, `x-kernel-person-assertion`), `dsg-kernel/apps/api/src/auth/console-relay.ts` | person token plus `X-DSG-Service-Token`; IAP stays at the edge only | plane relay chunk                             |
| Console service calls with no person credential     | `dsg-run-console/api/src/plane-relay.ts`                                                                                                              | the 4.2 code exchange, then person token plus service token         | console backend chunk                         |
| Public human IAP gate on the console domain         | console front door configuration                                                                                                                      | Better Auth sign-in; the domain and private upstreams stay          | console backend chunk, dsg-infra for the gate |
| Existing Better Auth surface, no provider plugins   | `dsg-kernel/apps/api/src/auth/google.ts` (1.7.2), `apps/cli/src/auth.ts` (device client)                                                              | 1.7.4 with `jwt`, `oauthProvider`, `oauthDeviceAuthorization`       | kernel auth owner                             |
| Google-attested decisions and bindings              | `apps/api/src/routes/decisions.ts`, `identity-binding.ts`, `packages/record/src/*-envelope.ts`                                                        | unchanged                                                           | none                                          |
| Record enrollment through the IAP relay             | `apps/api/src/routes/organization-access.ts`                                                                                                          | the same enrollment driven by a verified sign-in                    | kernel auth owner                             |
| `dsg.core.identity-binding/1`, `dsg.run.decision/1` | re-export only, no producer                                                                                                                           | unchanged, frozen                                                   | none                                          |

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

Revision 4 corrects the wrong-verifier probe to use the first exchange of a
fresh code, with a separate success control and replay assertion. It withdraws
the unsupported common age limit with measured counterexamples for all human
credential classes, defines browser cache ownership and current-cookie checks,
proves the two-resource relay, and specifies explicit refusal version dispatch.
It also resolves the service/person principal wording and retained IAP header
placement. Prior revision descriptions above are historical, not current
instructions.
