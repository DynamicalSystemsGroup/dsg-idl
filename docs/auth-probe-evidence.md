# Better Auth capability probe evidence

Date: 2026-09-10. Probe environment: better-auth 1.7.4, @better-auth/oauth-provider 1.7.4,
PostgreSQL 17 (OrbStack container kernel-proto-postgres-1), throwaway database
dsg_auth_probe, loopback handler invocation, random per-run secrets. No production
server was built; no credentials left the probe process. Reproduce: install
better-auth@1.7.4 and @better-auth/oauth-provider@1.7.4 with pg and kysely, create
a scratch database, and drive auth.handler with Request objects as in the probe
transcript (session artifact history).

## Observed behavior

1. Migrations: getMigrations(auth.options).runMigrations() creates user, session,
   account, verification, jwks, oauthClient, oauthResource, oauthClientResource,
   oauthRefreshToken, oauthAccessToken, oauthConsent, oauthClientAssertion,
   deviceCode on the Kysely PostgreSQL adapter ({ db, type: "postgres",
   casing: "snake", transaction: true }). The "Database schema mismatch" error
   line in probe output is the pre-migration startup check, not a failure of the
   migrated state; flows complete after runMigrations in the same process.

2. Admin client creation: POST /admin/oauth2/create-client is SERVER_ONLY and
   session-gated. Without a session: UNAUTHORIZED. With a session but without a
   configured clientPrivileges hook: UNAUTHORIZED for the
   configure-client-credentials-scopes action. With clientPrivileges: async () =>
   true, creation succeeds and returns client_id and client_secret. Direct HTTP
   to the admin path without a session returns 404.

3. client_credentials fail-closed: a client created without
   client_credentials_scopes cannot be created at all through the admin API
   (UNAUTHORIZED without the privileges hook). With the hook and an explicit
   ceiling, token issuance succeeds. Requesting a scope above the ceiling
   (api:write when ceiling is api:read) returns 400 invalid_scope.

4. Resource binding: a token request naming a resource the client is not linked
   to returns 400 invalid_target ("client ... is not linked to resource(s) ...").
   Linking requires the resource row to exist (adminCreateOAuthResource with
   body.identifier) plus adminLinkClientResource with params
   { identifier, client_id }. After linking, the token request with
   resource=https://probe.invalid/api returns 200.

5. Token shape: with jwt() installed, access tokens are JWT (three segments,
   typ at+jwt, EdDSA). Introspection returns active: true with sub, aud (the
   resource), client_id, azp, scope, iss, iat, exp, jti. /jwks returns 200 with
   one key. Without jwt(), tokens are opaque.

6. Revocation: POST /oauth2/revoke on a JWT access token returns 400
   unsupported_token_type, "JWT access tokens are self-contained and cannot be
   revoked server-side". Introspection after that call still returns
   active: true. Refresh tokens revoke with 200 (no hint) and subsequent use
   returns invalid_grant. Passing token_type_hint=refresh_token after the token
   is already revoked returns 400 invalid_request "refresh token revoked".

7. Device authorization (oauthDeviceAuthorization composed with oauthProvider):
   POST /device/code as a public native client (token_endpoint_auth_method:
   "none", grant_types including urn:ietf:params:oauth:grant-type:device_code)
   returns device_code, user_code (8 chars), verification_uri,
   verification_uri_complete, expires_in. Polling /oauth2/token with the device
   grant before approval returns 400 authorization_pending. Approving without a
   prior GET /device?user_code=... claim returns 400 invalid_request ("Device
   code has not been claimed by a verifying session"). Approving without an
   Origin header returns 403 MISSING_OR_NULL_ORIGIN. The full ceremony
   (GET /device claim, POST /device/approve with Origin, poll) returns 200 with
   a JWT access token whose aud includes the linked resource and the userinfo
   endpoint, plus a refresh token.

8. Refresh rotation: using a refresh token returns 200 with a new refresh token
   (rotation). Reusing the old refresh token returns 400 invalid_grant.

## Contract consequences

- Machine/human distinction: JWT access tokens carry client_id and azp equal to
  the OAuth client id, and sub equal to the client id for client_credentials
  (no user). Resource servers distinguish machine tokens by the absence of a
  user-bound sub and by client_id; no bespoke token format is needed.
- Revocation of access is not server-side for JWT access tokens. The contract
  must set short access-token TTLs and treat refresh-token revocation plus
  introspection as the revocation channel, or accept TTL-bounded staleness.
- The clientPrivileges hook is the only gate for assigning client_credentials
  scope ceilings. The kernel must wire it to its recorded admin authority;
  leaving it unset disables client_credentials entirely (fail closed).
- Device approval requires a signed-in session, an Origin header, and a prior
  code claim. The hosted device page is part of the security boundary.
