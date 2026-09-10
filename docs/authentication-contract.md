# Shared authentication contract

Status: normative contract for the approved authentication replacement. This
document freezes the protocol decisions the kernel authentication owner, the
console clients, and the plane validators implement against. It is the only
place these decisions live; consumers pin this repository's released package
by version and integrity.

Approved architecture (Sayer, 2026-09-10): one Better Auth authority inside
the existing kernel Fastify API on the existing PostgreSQL deployment. The
console HTTPS domain is the canonical public issuer and application entry
point. Better Auth owns linked accounts, sessions, OAuth clients, application
tokens, expiry, and revocation. The kernel record owns organization access,
suspension, qualifications, permissions, human decisions, and dispatch
authority. Better Auth organization roles do not duplicate kernel authority.

## 1. Library pins and evidence

| Component                   | Pin                                                       | Evidence                                                                                     |
| --------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| better-auth                 | 1.7.4                                                     | npm latest 1.7.4; kernel currently pins 1.7.2 in its catalog and must move to the common pin |
| @better-auth/oauth-provider | 1.7.4                                                     | peer better-auth ^1.7.4; probe evidence docs/auth-probe-evidence.md                          |
| Node                        | >= 24                                                     | workspace engines; Fastify integration doc requires v16+                                     |
| Database adapter            | Kysely PostgreSQL, { casing: "snake", transaction: true } | probe migrations created all 13 tables on PostgreSQL 17                                      |
| Plugins                     | jwt, oauthProvider, oauthDeviceAuthorization              | probe evidence; the organization plugin is not used                                          |

Stable versus prerelease: 1.7.4 is the published latest. The oauth-provider
plugin's client-credentials scope ceiling, resource linking, and device
composition are observed behavior at this version, not documentation claims.

Unresolved at this version, recorded as contract decisions rather than
defects: JWT access tokens cannot be revoked server-side (probe 6); refresh
tokens revoke cleanly. Access-token TTL is therefore the revocation bound for
machine and device clients, and every validator must treat introspection of a
JWT as a cache, not a guarantee.

## 2. Routes and trust boundaries

The kernel API is the only service that runs Better Auth. The console API and
the plane are resource servers and relays; they never hold a session database.

| Route                                                                                | Method   | Reachability | Accepting service                    | Credential required                           | Proxy behavior                                                                     |
| ------------------------------------------------------------------------------------ | -------- | ------------ | ------------------------------------ | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| /auth/sign-in/social, /auth/callback/google                                          | GET      | public       | kernel (via console and plane relay) | none                                          | console and plane forward method, status, location, and every Set-Cookie unchanged |
| /auth/.well-known/oauth-authorization-server, /auth/.well-known/openid-configuration | GET      | public       | kernel                               | none                                          | discovery must reach the auth handler under the issuer's public origin             |
| /auth/jwks                                                                           | GET      | public       | kernel                               | none                                          | cacheable; validators fetch here                                                   |
| /auth/oauth2/authorize, /auth/oauth2/token                                           | GET/POST | public       | kernel                               | per client type                               | token endpoint is form-encoded; relays must not move credentials into URLs or logs |
| /auth/device/code, /auth/device, /auth/device/approve, /auth/device/deny             | GET/POST | public       | kernel                               | session for approve/deny                      | approval requires Origin header and a prior code claim (probe 7)                   |
| /auth/oauth2/introspect, /auth/oauth2/revoke                                         | POST     | public       | kernel                               | client authentication                         | resource servers call introspection through their own service credential           |
| /auth/admin/oauth2/*                                                                 | POST     | server-only  | kernel                               | kernel-held admin session                     | never reachable through the public relay; the relay allowlist excludes /auth/admin |
| product API routes                                                                   | varies   | private      | kernel, plane, console               | session cookie or resource-bound access token | each hop validates independently                                                   |
| decision confirmation page and receipt                                               | GET/POST | public       | kernel                               | session plus fresh Google proof               | reuses the existing kernel challenge route                                         |

Local and deployed use the same protocol. Local development has a separate
issuer, clients, credentials, and containers. Trusted actor headers, fake IAP
assertions, and synthetic people cannot prove real sign-in acceptance.

## 3. Credential transport

- Browser: Better Auth Google sign-in, secure HTTP-only session cookie.
  JavaScript never persists bearer credentials. The cookie is first-party to
  the console domain; relays preserve multiple Set-Cookie headers (kernel
  google.ts forward() already implements the getSetCookie path).
- Desktop: authorization code with PKCE against the Better Auth issuer through
  the system browser, public native client (token_endpoint_auth_method "none"),
  OS credential storage, no embedded client secret. The direct Google
  installed-app login path is replaced in the client chunk.
- CLI: device authorization against the same issuer, public native client,
  resource-bound OAuth access token plus rotating refresh token. No browser
  library in the CLI runtime.
- Application services: client_credentials with an admin-assigned scope
  ceiling (client_credentials_scopes). Service identity and the initiating
  person's credential travel separately: the service token in Authorization,
  the person's session cookie or token unchanged beside it. A machine
  credential never confers human authority.
- Internal headers: the plane accepts a person assertion only from the
  configured console service identity; every other forged internal header is
  stripped and rejected. Conflicting credentials on one request refuse rather
  than merge. No raw credentials in URLs, logs, traces, redirects, or
  evidence. EventSource and streams carry the same cookie or token rules;
  a stream that cannot present a credential is refused at open.

## 4. Validation

- Issuer and resource: validators check iss against the pinned issuer and aud
  against their own resource identifier. Wrong-resource tokens refuse.
- Token kinds: session cookies resolve through Better Auth's session lookup
  against the kernel PostgreSQL store. OAuth access tokens are JWT verified
  offline against /auth/jwks with introspection as the freshness check.
- Expiry and clock: tokens carry exp; validators apply a bounded clock
  tolerance (60 seconds) and refuse expired tokens.
- Revocation: refresh-token revocation is immediate (probe 6). JWT access
  tokens are not server-revocable; their TTL is the revocation bound. The
  contract sets access-token TTL to 3600 seconds (observed default) and
  requires validators to treat introspection active:false as authoritative
  within that bound.
- Key rotation: /auth/jwks is the only key source; validators cache with a
  bounded TTL and refetch on unknown kid.
- Unavailability: an unavailable validator (session store, introspection
  endpoint, JWKS fetch) fails closed. No protected route opens on a
  validation outage.

## 5. Identity and authorization

- Better Auth identity resolves to a kernel principal by stable issuer and
  subject, never by email. The existing dsg.core.identity-binding/1 profile
  carries issuer, subject, principal, decider, boundAt, signature; it is
  reused unchanged for the recorded binding act.
- First access: any verified eligible Google Workspace identity receives
  basic organization access on first sign-in under the recorded organization
  policy. First access is idempotent; concurrent first sign-ins resolve to
  one recorded enrollment. Basic access grants neither spending authority
  nor approval qualifications.
- Suspension: a suspended principal is refused at every protected route;
  suspension lives in the kernel record, not in Better Auth.
- Account linking: governed linking preserves the original principal and
  prior evidence; ordinary sign-in cannot create authority or replace
  another person's binding.
- Workspace membership: verified at sign-in and refreshed on session use;
  removal affects subsequent access. No immediate offboarding detection is
  claimed from an old login claim.
- Stale permissions: the kernel record is the permission authority; a valid
  session never substitutes for a current permission check.

## 6. Client lifecycle

- Browser cookie: Secure, HTTP-only, SameSite scoped to the console origin;
  CSRF/origin checks on every mutation; sign-out clears the session and the
  client clears protected cached state.
- Desktop PKCE: S256, exact loopback redirect, system browser, cancellation
  finalizes the pending flow atomically with credential storage, account
  switching clears the previous person's protected state.
- CLI device: poll with the RFC 8628 error vocabulary (authorization_pending,
  slow_down, expired_token, access_denied), honor expires_in, cancel on user
  interrupt, store the refresh token in OS credential storage, rotate on use,
  treat refresh reuse (invalid_grant) as a lost credential requiring a new
  device flow.
- Logout: one client's logout revokes that client's refresh token; other
  sessions survive. All-sessions logout is a separate recorded act.

## 7. Human confirmation

The existing kernel challenge and decision contract is reused. The shared
hosted page shows the exact action and obtains a fresh Google proof bound to
the kernel challenge. The kernel checks account, nonce, action digest,
expiry, single use, current qualification, and separation of duties. An
ordinary session, a token refresh, a machine token, or another person's
proof never satisfies a decision. Desktop and CLI open this page and
retrieve the recorded outcome. The dsg.run.decision/1 profile (runId,
requestDigest, decision, cause, decidedAt, decider, signature) remains the
recorded receipt shape; the challenge transport that produces it is kernel
implementation, not an IDL shape.

## 8. Errors

Stable machine-readable refusals reuse dsg.core.refusal/1. New codes this
contract requires: session_expired (present), identity_unbound (present),
principal_suspended (present), not_dsg_account (present), plus
validation_unavailable for a validator outage and confirmation_expired for
an out-of-window proof. OAuth-standard errors (invalid_request,
invalid_grant, invalid_scope, invalid_target, authorization_pending,
slow_down, expired_token, access_denied, unsupported_token_type) keep their
RFC vocabularies and headers. No refusal exposes credentials or identity
detail beyond the recorded sentence.

## 9. Migration inventory

Producers and consumers of the old mixture, with their replacement and
deletion owner. Source revisions: kernel d29fa731, plane 702dbf8b, console
73d4e84 (all merged to main).

| Old mechanism                             | Location                                                                                       | Replacement                                                                                    | Deletion chunk          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------- |
| Direct Google desktop tokens              | dsg-run-console desktop sign-in (Google installed-app flow)                                    | Better Auth PKCE against the kernel issuer                                                     | desktop client chunk    |
| IAP person assertion transport            | dsg-run service/src/http/kernel-relay.ts (x-goog-iap-jwt-assertion, x-kernel-person-assertion) | Better Auth session/token through the relay; IAP remains only as front-door transport identity | plane relay chunk       |
| Custom service assertions                 | console API to plane service credential                                                        | client_credentials service tokens with scope ceilings                                          | console backend chunk   |
| Existing Better Auth session/device usage | dsg-kernel apps/api/src/auth/google.ts (1.7.2, no provider plugins)                            | same module upgraded to 1.7.4 with jwt, oauthProvider, oauthDeviceAuthorization                | kernel auth owner chunk |
| Development identity shortcuts            | KERNEL_DEV_IDENTITY, trustActorHeader, x-kernel-actor                                          | deleted; local development uses the same protocol with a local issuer                          | kernel auth owner chunk |

Rollout: the public console backend's IAP human gate is replaced by Better
Auth application authentication; the domain, HTTPS front door, private hosts,
and existing infrastructure are retained. Ingress cannot bypass the front
door. Rollback cannot restore invalidated authority; old tokens stop being
accepted at cutover and there is no dual-accept window for human identity.

## 10. Ownership and configuration

| Surface                                     | Owner            |
| ------------------------------------------- | ---------------- |
| kernel authentication and CLI               | dsg-kernel       |
| console clients, API, backend configuration | dsg-run-console  |
| plane validation and relay                  | dsg-run          |
| this contract                               | dsg-idl          |
| infrastructure baseline ingress and IAM     | dsg-infra        |
| credentials and signing material            | dsg-secret-store |

Registries, ORN libraries, events, and TCPM workloads need no changes: no
contract dependency reaches them. The signed job catalog and law bundle do
not name authentication shapes; the ORN grammar is unchanged; dsg-events
declares workload events, not identity.

Configuration matrix (names and ownership only, never values): Google OAuth
web client (console callbacks), native client (desktop), device client (CLI),
service clients (console, plane), issuer base URL per environment, Better
Auth secret, JWKS signing keys, retained Google service accounts for GCP
access and retained private infrastructure gates. Local development uses a
separate issuer, clients, credentials, and containers.

## 11. Later acceptance cases

Browser, desktop, and CLI sign-in; first organization access; outsider
refusal; suspension; revocation within the TTL bound; wrong-resource token
refusal; forged internal header refusal; machine/person separation;
confirmation mutation and replay; renewal; deployed ingress through the
front door. Dependencies these cases need and this chunk does not fabricate:
an organization member account, a non-member account, two qualified
decision-makers, OAuth client configuration access, and a desktop signing
identity.
