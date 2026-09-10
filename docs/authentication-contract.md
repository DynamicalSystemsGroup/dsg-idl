# Shared authentication contract

Status: normative, revision 2. This replaces the first delivery at `df84a13`,
which Sayer did not accept. Section 12 lists what changed and why.

This document freezes the protocol the kernel authentication owner, the
console clients, and the plane validators implement against. It is the only
place these decisions live. Consumers pin this repository's released package
by version and integrity.

Approved architecture (Sayer, 2026-09-10): one Better Auth authority inside the
existing kernel Fastify API on the existing PostgreSQL deployment. The console
HTTPS domain is the canonical public issuer and application entry point. Better
Auth owns linked accounts, sessions, OAuth clients, application tokens, expiry
and revocation. The kernel record owns organization access, suspension,
qualifications, permissions, human decisions and dispatch authority. Better
Auth organization roles do not duplicate kernel authority.

## 1. Library pins and evidence

| Component                   | Pin                                                         | Evidence                                                       |
| --------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| better-auth                 | 1.7.4                                                       | npm latest; kernel pins 1.7.2 today and moves to this pin      |
| @better-auth/oauth-provider | 1.7.4                                                       | peer better-auth ^1.7.4                                        |
| Plugins                     | `jwt`, `oauthProvider`, `oauthDeviceAuthorization`          | docs/auth-probe reproduces every claim below                   |
| Node                        | >= 24                                                       | workspace engines; Fastify integration requires >= 16          |
| Database                    | Kysely PostgreSQL, `{ casing: "snake", transaction: true }` | migrations create 13 tables on PostgreSQL 17                   |
| Admin transport             | `auth.api.*` server-side                                    | the admin endpoints are `SERVER_ONLY` and answer 404 over HTTP |
| Organization plugin         | not used                                                    | kernel access and authority stay in the record                 |

`docs/auth-probe/` is the runnable evidence: `npm ci && node probe.mjs`. It
starts its own throwaway PostgreSQL container on port 55439, runs every
scenario over the in-process handler, prints one JSON line per scenario and
removes the container on exit. It needs Docker and nothing else, touches no
shared service, and prints no secret. `docs/auth-probe-evidence.md` records the
observed results and separates what remains documentation-derived.

Version behaviors that are contract decisions, not defects:

- JWT access tokens cannot be revoked directly: `/oauth2/revoke` with
  `token_type_hint=access_token` answers `unsupported_token_type`. Acceptance of
  a live JWT is what revocation must change, so validators introspect (section
  4).
- The admin client-update schema has no `disabled` field. An update carrying one
  is stripped by the schema and the client stays live. Machine cutoff is client
  deletion or secret rotation (section 4.4).
- The `client_credentials` scope ceiling comes from the client's
  `client_credentials_scopes`, and a token request above it answers
  `invalid_scope`. The kernel wires the `clientPrivileges` hook to its recorded
  admin authority; unwired, the grant stays fail-closed.

## 2. Token classes and what actually cuts them off

Measured on the pinned packages (probe scenarios in parentheses). Offline
validity means the JWT still verifies against `/jwks` with an unexpired `exp`.
Online acceptance means `/oauth2/introspect` answers `active: true`.

| Grant                                          | Carries `sid` | Session sign-out                        | Refresh revoked                                   | Direct revoke            | Machine cutoff                                                              |
| ---------------------------------------------- | ------------- | --------------------------------------- | ------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `client_credentials` (`machine-client.*`)      | no            | n/a                                     | n/a                                               | `unsupported_token_type` | delete or rotate: introspection `active:false`, new tokens `invalid_client` |
| device (CLI) (`device.*`)                      | **no**        | introspection stays `active:true`       | reuse `invalid_grant`, access stays `active:true` | `unsupported_token_type` | n/a                                                                         |
| authorization code + PKCE (desktop) (`pkce.*`) | yes           | introspection answers `active:false`    | not probed                                        | `unsupported_token_type` | n/a                                                                         |
| browser session cookie                         | n/a           | session lookup returns null immediately | n/a                                               | n/a                      | n/a                                                                         |

Three consequences the contract fixes:

1. **Introspection is the only acceptance check.** A JWT that verifies offline
   can still be refused online; a JWT refused online may still verify offline.
   Resource servers MUST introspect before acting, and MUST NOT treat offline
   validation as authorization.
2. **Session termination reaches desktop, not CLI.** PKCE tokens carry `sid`, so
   ending the session makes introspection report them inactive. Device tokens
   at 1.7.4 carry no `sid`, so ending the approving session does not. For the
   CLI the cutoff channels are refresh revocation and the access-token TTL.
3. **The TTL bound is per class, not universal.** The first delivery claimed a
   flat 3600-second revocation bound for every class. That was wrong for PKCE
   (session-bound, immediate) and incomplete for CLI (bound by access-token TTL
   and refresh revocation, since the session is not consulted).

## 3. Routes and required methods

Verified against the pinned handlers, not the documentation prose. The kernel
API is the only service that runs Better Auth; the console API and the plane are
resource servers and relays and hold no session store.

| Path                                           | Method            | Reachability    | Owner        | Credential                                            | Notes                                                                           |
| ---------------------------------------------- | ----------------- | --------------- | ------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `/auth/sign-in/social`                         | **POST**          | public          | kernel       | none                                                  | body carries the provider; this is a POST, not a GET                            |
| `/auth/callback/:id`                           | GET or POST       | public          | kernel       | none                                                  | Google's redirect target; `:id` is `google`                                     |
| `/auth/get-session`                            | GET or POST       | public          | kernel       | session cookie                                        | null session on a bogus cookie                                                  |
| `/auth/sign-out`                               | POST              | public          | kernel       | session cookie                                        | ends one session                                                                |
| `/auth/.well-known/oauth-authorization-server` | GET               | public          | kernel       | none                                                  | discovery must answer under the public issuer                                   |
| `/auth/.well-known/openid-configuration`       | GET               | public          | kernel       | none                                                  | same                                                                            |
| `/auth/jwks`                                   | GET               | public          | kernel       | none                                                  | the only key source for validators                                              |
| `/auth/oauth2/authorize`                       | GET               | public          | kernel       | session cookie                                        | redirects to the hosted consent page                                            |
| `/auth/oauth2/consent`                         | POST              | public          | kernel       | session cookie                                        | body `{ accept, oauth_query }`; returns the redirect with the code              |
| `/auth/oauth2/token`                           | POST              | public          | kernel       | per grant                                             | form-encoded; public clients send `client_id` in the body                       |
| `/auth/oauth2/introspect`                      | POST              | public          | kernel       | **client credentials**                                | an application access token is not enough; see 4.4                              |
| `/auth/oauth2/revoke`                          | POST              | public          | kernel       | client credentials or `client_id`                     | refresh tokens revoke; access JWTs answer `unsupported_token_type`              |
| `/auth/oauth2/userinfo`                        | GET               | public          | kernel       | access token                                          | not a resource server of its own                                                |
| `/auth/device/code`                            | POST              | public          | kernel       | none                                                  | RFC 8628 start                                                                  |
| `/auth/device`                                 | GET               | public          | kernel       | session cookie                                        | claims a pending `user_code` for the signed-in session                          |
| `/auth/device/approve`                         | POST              | public          | kernel       | session cookie                                        | body is `{ userCode }`, camelCase; approval must follow a claim                 |
| `/auth/device/deny`                            | POST              | public          | kernel       | session cookie                                        | same body shape                                                                 |
| `/auth/admin/oauth2/*`                         | POST/PATCH/DELETE | **server-only** | kernel       | no HTTP route                                         | `SERVER_ONLY`: 404 over HTTP, called through `auth.api.*` with an admin session |
| `/decisions/:kind/challenge`                   | POST              | private         | kernel       | session or PKCE token                                 | mints the confirmation challenge; unchanged from today                          |
| `/decisions/:kind`                             | POST              | private         | kernel       | session or PKCE token plus fresh Google proof         | the recorded decision                                                           |
| `/principals/access`                           | POST              | private         | kernel       | person credential                                     | enrollment and lookup                                                           |
| `/principals/identity`                         | GET               | private         | kernel       | plane service credential                              | the address-to-principal door the plane calls                                   |
| product API routes on the plane and console    | varies            | private         | each service | service token, plus a person token when a person acts | every hop validates independently                                               |

Hosted pages the kernel must serve, because they sit inside the flows above:
the sign-in page, the consent page, the device verification page, and the
decision confirmation page. `oauthProvider` takes `loginPage` and `consentPage`
and the device plugin takes `verificationUri`; these are kernel routes, not
console routes, and they are part of the security boundary.

## 4. Credential transport, per hop

One rule up front: a request carries at most one `Authorization` header, and
that header names the acting principal. When a service acts on a person's
behalf, the service identity travels beside it in its own header.

### 4.1 Names

| Carrier                               | Direction                                            | Content                                                                                                           |
| ------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `Authorization: Bearer <token>`       | every hop                                            | the acting credential: a session-derived access token, a machine token, or a person token                         |
| `X-DSG-Service-Token: Bearer <token>` | console to plane, plane to kernel, console to kernel | the calling service's own `client_credentials` token                                                              |
| session cookie                        | browser to console and browser to kernel             | the kernel-issued session, `Secure`, `HttpOnly`, `SameSite=Lax`, path-scoped to the issuer                        |
| `x-goog-iap-jwt-assertion`            | front door to console                                | transport identity at the infrastructure edge; verified at the front door, never accepted as authority downstream |

`X-DSG-Service-Token` replaces the retired `x-kernel-person-assertion`. Nobody
forwards a person assertion as authority any more: the person's own token
travels and each hop verifies it.

### 4.2 Hop by hop

- **Browser to console.** Session cookie only. JavaScript never holds a bearer
  credential. Every mutation carries an origin check; a missing or foreign
  origin is refused.
- **Console API to kernel.** `Authorization: Bearer <person access token>` and
  `X-DSG-Service-Token: Bearer <console service token>`. The kernel verifies
  both: the service token's audience is the kernel resource, and the person
  token's audience includes the kernel resource and its issuer is the pinned
  issuer. Losing either refuses the request; there is no fallback to whichever
  one verifies.
- **Console API to plane.** Same shape with the plane resource: the person token
  in `Authorization`, the console service token in `X-DSG-Service-Token`. The
  plane verifies both against its own resource identifier.
- **Plane to kernel.** `Authorization: Bearer <person token>` plus
  `X-DSG-Service-Token: Bearer <plane service token>` when the call is about a
  person, or the plane's own token alone when the plane is the caller.
- **Desktop to kernel.** `Authorization: Bearer <access token>` from PKCE; the
  refresh token lives in the OS credential store, never in a file the app
  writes.
- **CLI to kernel.** `Authorization: Bearer <access token>` from the device
  grant; refresh token in the OS credential store.
- **Service to service with no person.** The caller's own `client_credentials`
  token in `Authorization`. No person header, no person claim.

### 4.3 Audience and resource binding

- Every protected resource has exactly one identifier, and tokens name it.
  A token minted for the plane is refused by the kernel and the reverse
  (`invalid_target` at issuance, refusal at validation).
- A person token reaches the resources it needs by being minted for them: the
  desktop client, the CLI client and the console register `resources` naming the
  kernel and plane identifiers they will call, and the authorize or device
  request passes `resource`. A token never reaches a resource it does not name.
- Clients are linked to the resources they may be issued for
  (`adminLinkClientResource`), and introspection follows the same link: an
  introspecting client must be the issuer client or be linked to one of the
  token's audience resources. A service that validates person tokens is
  therefore registered, linked and credentialed; it cannot introspect by
  possessing an application token.

### 4.4 Validation calls and cache bounds

| Check          | Call                                                             | Freshness bound                                  |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| Session cookie | in-process session store read                                    | 0; every request                                 |
| JWT pre-filter | `/jwks` key fetch, then local signature + `iss` + `aud` + `exp`  | keys cached 300 s, refetch on unknown `kid`      |
| Acceptance     | `/oauth2/introspect` with the validator's own client credentials | result cached at most 60 s, and never past `exp` |
| Suspension     | kernel record projection read                                    | 5 s                                              |
| Machine cutoff | client delete or rotate, then introspection                      | immediate at the next introspection              |

Introspection is required before any state-changing act and before any read
that exposes governed data. The 60-second cache is a ceiling, not a target: a
validator that can afford a fresh call makes one. Refusal on a failed check is
total (section 8).

### 4.5 Forged and conflicting credentials

- Inbound `X-DSG-Service-Token` and `x-goog-iap-jwt-assertion` are stripped
  unless the request arrives from the configured peer address range; a header
  that survives from anywhere else refuses the request.
- Two credentials that name different acting principals, or a person token whose
  `azp` is a client not registered for this resource, refuse the request. No
  header wins by being checked first.
- A machine token never satisfies a human-authority act. The decision routes
  require the fresh Google proof regardless of which token carries the request.
- Bootstrap and recursion: the kernel validates its own tokens in process and
  never introspects itself, so authentication does not depend on a call to
  authentication. Validators outside the kernel introspect the kernel, and the
  code that calls introspection uses a service credential, not a token being
  validated.

### 4.6 Retained Google infrastructure credentials

The Google service accounts that reach GCP APIs, and IAP in front of the console
domain, stay. They carry infrastructure identity only. IAP's assertion is
verified at the front door for transport and is never rewritten into person
authority; the person's Better Auth token is what the kernel trusts. A GCP
service account is never accepted as a person.

## 5. Identity mapping

Two different identifiers, kept apart:

| Identifier             | Where it lives                                                       | Authority                                                                |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Better Auth user id    | kernel PostgreSQL only                                               | none; internal row key, never in the record, an event, a URL or evidence |
| Google subject (`sub`) | Better Auth `account` row (`providerId` google, `accountId` = `sub`) | the identity the record binds                                            |

The recorded binding stays what it is today: a principal whose
`googleSubject` is `accounts.google.com:<sub>` and whose actor is derived from
that subject (`organizationActorForSubject`), with `googleAccountId` holding the
address for lookup. The kernel resolves a verified Better Auth sign-in to a
principal by `issuer + subject`, never by email and never by the Better Auth
user id.

- **Email** is a lookup and display attribute. A changed Google address does not
  rebind a principal and does not move authority; the recorded subject does.
- **First access** runs the existing enrollment path: a verified eligible
  Workspace identity is enrolled once under the recorded organization policy
  (workspace domain and audiences are both checked), the act is idempotent, and
  concurrent first sign-ins resolve to one recorded enrollment.
- **Linked accounts** are governed. Linking a second Google account preserves the
  original principal and prior evidence; an ordinary sign-in never creates
  authority, and one person's sign-in never replaces another's binding.
- **Suspension** lives in the record and is checked per request (5 s bound). A
  suspended principal is refused at every protected route no matter how fresh
  the session or token.

### 5.1 Workspace membership: computation and refresh

Decided mechanism, in two parts:

1. **Sign-in gate.** The kernel configures the Google provider with the recorded
   workspace domain (`hd`) and re-checks the returned claims: `hd` equals the
   recorded domain and the address ends in it. An account outside the domain is
   refused (`not_dsg_account`). This is the existing kernel behavior in both the
   decision and binding routes and it keeps working after the swap.
2. **Refresh.** Membership is re-evaluated at each token refresh and at each new
   sign-in, because those are the points where Google hands back fresh claims.
   Between those points the enforcement bound is the token lifetime:
   access tokens at most 3600 s, sessions at most 24 h.

Removal detection therefore has a bound of the longest outstanding token or
session, not zero. Closing that gap means calling the Google Workspace Directory
API (`users.get`, scope
`https://www.googleapis.com/auth/admin.directory.user.readonly`) on sign-in and
on a timer, which needs domain-wide delegation for a service account in the
Workspace tenant. **Blocker, named rather than assumed:** that delegation and
the admin consent are Sayer's act (a Google admin action), and until it exists
the deployed bound is the token lifetime stated above. The contract does not
claim a shorter one.

An old hosted-domain claim never establishes current membership. It establishes
what Google said at sign-in.

## 6. Client lifecycle

- **Browser session.** Cookie as in 4.1. Sign-out ends the session; other
  sessions survive. All-session logout is a separate recorded act. The client
  clears protected cached state on sign-out.
- **Desktop (PKCE).** S256 only, exact loopback redirect, system browser, public
  native client with no embedded secret. Cancellation finalizes the pending flow
  atomically with credential storage. Switching accounts clears the previous
  person's protected state.
- **CLI (device).** RFC 8628 vocabulary (`authorization_pending`, `slow_down`,
  `expired_token`, `access_denied`), the advertised `interval` honored with
  backoff, and the `refresh_token` rotated on use. Reuse of a rotated refresh
  token answers `invalid_grant`: the client treats that as a lost credential and
  starts a new device flow. The kernel CLI already speaks this flow through the
  Better Auth device client.
- **Services.** `client_credentials` with the ceiling in
  `client_credentials_scopes`, the client linked to the resources it may call.
  No service client may request a scope above its ceiling, and no service
  credential carries human authority.

## 7. Human confirmation

Unchanged in substance and now stated against real producers. The kernel mints a
single-use challenge naming the digest of the proposed decision, the person, the
Case, the gate node and the client identity the Google token must carry. The
person answers it in Google's own account prompt; the kernel verifies Google's
signature, the issuer, the recorded audience, token age and the nonce through
the library's verifier, consumes the challenge, and seals the result.

- The provenance of a confirmation is Google's signature over a token whose
  nonce is the challenge. No session, no token refresh, no machine token and no
  other person's proof satisfies it.
- SEPARATION of duties and current qualification are checked against the record
  at decision time, not at challenge time.
- Desktop and CLI open the hosted confirmation page and retrieve the recorded
  outcome; they never sign a decision with a key they hold.

## 8. Compatibility with the frozen signed profiles

Finding 3 asked what remains on the old profiles and what new shapes are
required. Inspected at kernel `d29fa731`, plane `702dbf8b`, console `73d4e84`.

| Profile                                                                                | Producer today                                                                                                   | What it is now                                                                                                                   |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `dsg.core.identity-binding/1` (`signature`, CLI-signed, Google issuer literal)         | none                                                                                                             | describes the detached personal-key binding path only. The kernel's live path is Google-attested and seals a different artifact. |
| `dsg.run.decision/1` (`signature`, verified against the decider's recorded public key) | none                                                                                                             | describes a detached-signature receipt. Nothing in kernel, plane, console or infra emits or consumes these bytes.                |
| `dsg.core.refusal/1`                                                                   | kernel refusals                                                                                                  | still emitted; frozen, unchanged in this delivery.                                                                               |
| `google-signed-decision` / `google-signed-binding` envelopes                           | kernel API (`apps/api/src/routes/decisions.ts`, `apps/api/src/routes/identity-binding.ts` via `packages/record`) | the real sealed artifacts. Kernel-owned TypeBox shapes, no IDL profile.                                                          |

Statements the contract makes, so nobody reinterprets a frozen field:

- The `signature` field on both frozen profiles keeps its documented meaning: a
  detached signature by a key the person holds, verified against that person's
  recorded public key. The kernel's third signing branch still supports that
  path. Reusing the profile shape does not make it describe Google attestation,
  and the contract does not claim it does.
- The Google-attested channel is a different artifact with different fields
  (`idToken`, `keySet`, `challenge`, `signer`). It is not a version of those
  profiles and is not emitted under their literal.
- **No new IDL profile is minted in this delivery.** The envelopes have exactly
  one consumer today, the kernel that writes them, and an IDL profile exists to
  fix a wire two systems must agree on. The trigger for minting one is stated
  rather than left vague: the first consumer outside `dsg-kernel`, which is the
  console's browser-side evidence verification or the plane's evidence sealing.
  Whoever writes that consumer lifts the envelope shape into `dsg-idl` at that
  point, from `packages/record/src/decision-envelope.ts` and
  `binding-envelope.ts`, and both sides then pin it.

## 9. Errors

The authentication surface needs two codes the frozen `/1` does not carry:
`validation_unavailable` (a validator could not answer; the request fails
closed) and `confirmation_expired` (a Google proof outside its window).
`dsg.core.refusal/2` defines them beside `/1`, whose bytes are untouched.

Version selection, resolved:

- New authentication routes emit `dsg.core.refusal/2`.
- Existing consumers of `/1` keep working unchanged until they are migrated:
  `/2` is a superset of `/1`'s codes, so a `/2` reader accepts every `/1`
  document, while a `/1` reader rejects the two new codes by design.
- A consumer that must read authentication refusals (console, plane) moves to
  `/2` in its implementation chunk, before the new routes ship. There is no
  dual-emit window, because the two codes only appear on routes that do not
  exist yet.

Status and recovery mapping:

| Code                                                                                                                                                                    | Status | Where                     | Recovery                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------- | ------------------------------------------------------ |
| `invalid_client`                                                                                                                                                        | 401    | token, introspect, revoke | fix the client credential; not a person-facing message |
| `invalid_token`                                                                                                                                                         | 401    | protected routes          | re-authenticate                                        |
| `session_expired`                                                                                                                                                       | 401    | protected routes          | re-authenticate                                        |
| `identity_unbound`                                                                                                                                                      | 403    | protected routes          | bind the principal in the record                       |
| `not_dsg_account`                                                                                                                                                       | 403    | sign-in, enrollment       | use a workspace account                                |
| `principal_suspended`                                                                                                                                                   | 403    | protected routes          | an administrator lifts the suspension in the record    |
| `confirmation_expired`                                                                                                                                                  | 403    | decision routes           | mint a new challenge and answer it                     |
| `validation_unavailable`                                                                                                                                                | 503    | protected routes          | retry when validation answers                          |
| `invalid_request`, `invalid_grant`, `invalid_scope`, `invalid_target`, `unsupported_token_type`, `authorization_pending`, `slow_down`, `expired_token`, `access_denied` | 400    | OAuth endpoints           | RFC-standard vocabularies and headers, unchanged       |

No refusal carries a credential, a token or identity detail beyond the recorded
sentence.

## 10. Ownership and configuration

| Surface                                             | Owner            |
| --------------------------------------------------- | ---------------- |
| kernel authentication, hosted pages, CLI            | dsg-kernel       |
| console clients, console API, backend configuration | dsg-run-console  |
| plane validation and relay                          | dsg-run          |
| this contract, its profiles and vectors             | dsg-idl          |
| infrastructure ingress, IAM, front door             | dsg-infra        |
| credentials, signing keys, secret containers        | dsg-secret-store |

Configuration, named by key and owner. No values here.

| Key                                     | Owner                          | Purpose                                        |
| --------------------------------------- | ------------------------------ | ---------------------------------------------- |
| `KERNEL_AUTH_BASE_URL`                  | dsg-run-console                | public issuer the browser and clients use      |
| `KERNEL_AUTH_ISSUER`                    | dsg-kernel, dsg-run            | expected `iss` in every token                  |
| `KERNEL_RESOURCE_IDENTIFIER`            | dsg-kernel                     | audience for tokens the kernel accepts         |
| `PLANE_RESOURCE_IDENTIFIER`             | dsg-run                        | audience for tokens the plane accepts          |
| `BETTER_AUTH_SECRET`                    | dsg-secret-store               | session and token signing secret               |
| `GOOGLE_WEB_CLIENT_ID`                  | dsg-secret-store               | browser sign-in client                         |
| `GOOGLE_DESKTOP_CLIENT_ID`              | dsg-secret-store               | PKCE client                                    |
| `GOOGLE_DEVICE_CLIENT_ID`               | dsg-secret-store               | CLI device client                              |
| `CONSOLE_SERVICE_CLIENT_ID` / `_SECRET` | dsg-secret-store               | console service credential                     |
| `PLANE_SERVICE_CLIENT_ID` / `_SECRET`   | dsg-secret-store               | plane service credential                       |
| `KERNEL_WORKSPACE_DOMAIN`               | dsg-kernel                     | `hd` value enrollment and confirmation require |
| `KERNEL_JWKS_CACHE_SECONDS`             | dsg-kernel                     | key cache bound, default 300                   |
| `INTROSPECTION_CACHE_SECONDS`           | dsg-run, dsg-run-console       | acceptance cache bound, default 60             |
| `WORKSPACE_DIRECTORY_DELEGATION`        | dsg-secret-store, Google admin | the delegation in 5.1; absent until Sayer acts |

Local development uses a separate issuer, separate client registrations,
separate secrets and its own containers. The dev-identity shortcut
(`KERNEL_DEV_IDENTITY`, `trustActorHeader`, `x-kernel-actor`) is deleted in the
kernel chunk; local sign-in runs the same protocol against the local issuer.

## 11. Migration inventory

Producers and consumers of the old mixture, by real path, with the deletion
owner. Source revisions: kernel `d29fa731`, plane `702dbf8b`, console `73d4e84`.

| Old mechanism                                     | Real location                                                                                                                                                                | Replacement                                                                             | Deletion chunk        |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------- |
| Dev identity shortcut                             | `apps/api/src/config.ts`, `apps/api/src/app.ts` (`devIdentity`, `KERNEL_DEV_IDENTITY`), `apps/cli/src/auth.ts` (`x-kernel-actor`, loopback only)                             | local issuer with the same protocol                                                     | kernel auth owner     |
| IAP person transport into the plane               | `dsg-run/service/src/http/kernel-relay.ts` (`x-goog-iap-jwt-assertion`, `x-kernel-person-assertion`), `dsg-kernel/apps/api/src/auth/console-relay.ts` (`verifyIapAssertion`) | `Authorization` person token plus `X-DSG-Service-Token`; IAP stays front-door transport | plane relay chunk     |
| Console service calls with no person credential   | `dsg-run-console/api/src/plane-relay.ts` (`service.authorization(...)`)                                                                                                      | same shape plus `X-DSG-Service-Token` on person-bearing calls                           | console backend chunk |
| Existing Better Auth surface, no provider plugins | `dsg-kernel/apps/api/src/auth/google.ts` (1.7.2), `apps/cli/src/auth.ts` (device client)                                                                                     | 1.7.4 with `jwt`, `oauthProvider`, `oauthDeviceAuthorization`                           | kernel auth owner     |
| Google-attested decisions                         | `apps/api/src/routes/decisions.ts`, `packages/record/src/decision-envelope.ts`                                                                                               | unchanged; challenge route and envelope stay                                            | none                  |
| Google-attested bindings                          | `apps/api/src/routes/identity-binding.ts`, `packages/record/src/binding-envelope.ts`                                                                                         | unchanged                                                                               | none                  |
| Record enrollment in the IAP relay                | `apps/api/src/routes/organization-access.ts` (`verifyIapAssertion` then `access.enroll`)                                                                                     | the same enrollment call driven by a verified Better Auth sign-in                       | kernel auth owner     |
| `dsg.core.identity-binding/1` consumer            | `packages/core/src/index.ts` re-export, `packages/core/src/wire-conformance.test.ts`                                                                                         | stays; the profile is not the live path                                                 | none                  |
| `dsg.run.decision/1`                              | no producer, no consumer anywhere                                                                                                                                            | stays frozen and unused; do not delete a released profile                               | none                  |

Rollout: the console front door's human gate moves from IAP to Better Auth while
the domain, HTTPS front door, private hosts and baseline stay. Old tokens stop
being accepted at cutover; there is no dual-accept window for human identity,
because a token minted against the old authority cannot be validated against the
new one. Rollback cannot restore invalidated authority.

## 12. What changed from revision 1

| Finding                          | Correction                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Revocation evidence overstated   | Section 2 measures each grant class. The flat 3600-second bound is replaced: PKCE tokens are session-bound and cut off immediately; device tokens carry no `sid` and are bounded by TTL plus refresh revocation; machines are cut by delete or rotate. Section 4 adds the validation calls, cache bounds and outage behavior. |
| Transport incomplete             | Section 4 names every carrier per hop, retires `x-kernel-person-assertion`, fixes audience and resource linking, and states forged-header and recursion behavior.                                                                                                                                                             |
| Frozen profile reuse claimed     | Section 8 inspects the real producers and says what each profile is, that `dsg.run.decision/1` has no producer at all, and that envelopes get a profile at their first external consumer rather than now.                                                                                                                     |
| Identity and refresh hand-waved  | Section 5 separates the Better Auth user id from the Google subject, fixes the mapping, and names the Directory API delegation as Sayer's act rather than claiming an immediate membership check.                                                                                                                             |
| Routes and errors wrong or vague | Section 3 is per-method (`/sign-in/social` is POST), includes session, hosted pages and discovery, and states that introspection requires client credentials with a resource link. Section 9 resolves refusal version selection and maps status and recovery.                                                                 |
| Evidence not reproducible        | `docs/auth-probe/` runs from a clean checkout with a pinned lock and its own container; `docs/auth-probe-evidence.md` records the observed result of each scenario and what remains documentation-derived.                                                                                                                    |

## 13. Later acceptance cases

Deferred to real people and real infrastructure, listed so they are not
forgotten: browser, desktop and CLI sign-in end to end; first organization
access; outsider refusal; suspension; session termination on desktop; CLI
revocation through refresh rotation; wrong-resource token refusal; forged
internal header refusal; machine and person credential separation; confirmation
mutation and replay; token refresh; and the same journeys through the deployed
front door.

Dependencies this delivery does not fabricate: an organization member account
and a non-member account, two qualified decision-makers, OAuth client
registration access, a desktop signing identity, and the Workspace Directory
delegation in 5.1.
