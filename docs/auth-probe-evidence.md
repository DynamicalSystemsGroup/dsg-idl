# Probe evidence for the shared authentication contract

Every capability claim in `authentication-contract.md` comes from
`docs/auth-probe/`, which anyone can run from a clean checkout. This document
records what that probe printed on 2026-09-10 and separates observation from
documentation.

## How to reproduce

```
cd docs/auth-probe
npm ci
node probe.mjs
```

Requirements: Node 24 and Docker. The probe pulls
`postgres:17-alpine@sha256:18cfe3ef…` (pinned in `probe.mjs`), starts a throwaway
container named `dsg-auth-probe-postgres` on port 55439, runs every scenario
against the in-process Better Auth handler over loopback `Request` objects,
prints one JSON line per scenario, and removes the container on exit, including
after a failure. It touches no shared service, no deployed resource and no
network beyond the container pull. It prints no secret: client secrets and
tokens live for one run and never appear in the output.

`package-lock.json` pins better-auth 1.7.4, @better-auth/oauth-provider 1.7.4,
kysely 0.29.5 and pg 8.23.0 with integrity hashes.

## What was observed

Results from that run, abridged to the fields the contract relies on.

### Machine clients

| Scenario                                     | Result                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| token issuance                               | 200, JWT, `expires_in` 3600, `sub` = client id, `aud` = the resource, `scope` = `api:read`, no `sid`              |
| scope above the ceiling                      | 400 `invalid_scope`                                                                                               |
| resource the client is not linked to         | 400 `invalid_target`                                                                                              |
| introspection by the client's own credential | 200 `active: true`                                                                                                |
| admin update carrying `disabled`             | 200, field silently dropped, client stays live, tokens still issue                                                |
| admin delete                                 | 200; introspection by a second linked client then answers `active: false`; new tokens answer 401 `invalid_client` |
| secret rotation                              | 200; the old secret immediately answers 401 `invalid_client`                                                      |

### Device grant (the CLI)

| Scenario                          | Result                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| device code                       | 200, `verification_uri` present                                                       |
| poll before approval              | 400 `authorization_pending`                                                           |
| claim then approve                | 200, 200 (approval body field is `userCode`)                                          |
| poll after approval               | 200, JWT plus refresh token; claims carry `aud` = resource, `scope`, and **no `sid`** |
| introspection by a service client | 200 `active: true`                                                                    |
| sign-out of the approving session | 200; introspection still `active: true`; the token's `exp` is 3600 s out              |
| refresh revoke then reuse         | 200, then 400 `invalid_grant`; the access token's introspection stays `active: true`  |
| revoking the JWT itself           | 400 `unsupported_token_type`                                                          |

### Authorization code with PKCE (the desktop)

| Scenario                              | Result                                        |
| ------------------------------------- | --------------------------------------------- |
| authorize                             | 302 to the consent page                       |
| consent                               | 200 with the redirect carrying the code       |
| exchange                              | 200, JWT plus refresh; claims carry **`sid`** |
| introspection before sign-out         | 200 `active: true`                            |
| introspection after sign-out          | 200 `active: false`                           |
| exchange with a wrong `code_verifier` | 401 `invalid_request`                         |

### Sessions

| Scenario                  | Result                  |
| ------------------------- | ----------------------- |
| fabricated session cookie | 200 with a null session |

## Adversarial cases in the probe

- A code exchanged with the wrong PKCE verifier is refused.
- A scope above the client ceiling is refused.
- A resource the client is not linked to is refused.
- A deleted client's token is refused online while its bytes are still
  unexpired, which is the offline-validity versus online-acceptance distinction
  the contract turns on.

## What remains documentation-derived

- Google's own behavior: Workspace `hd` claim contents, account selection, and
  the freshness of the confirmation proof. The kernel uses the library's
  verifier against Google's live endpoints; nothing here exercises Google.
- Workspace Directory API membership reads, which need domain-wide delegation
  that does not exist yet (contract section 5.1).
- Browser cookie behavior in a real browser, and the deployed front door.
- Client disablement as an API. At 1.7.4 the admin update schema drops the
  field; the contract therefore specifies deletion and rotation, and this is
  recorded as observed behavior at this version, not as intended library
  design.

These are the deferred acceptance cases in contract section 13, and they require
real people, real Google accounts and deployed infrastructure.
