# Probe evidence for the shared authentication contract

Every capability claim in `authentication-contract.md` comes from
`docs/auth-probe/`, which anyone can run from a clean checkout. This document
records the last full run: 48 of 48 assertions passed on 2026-09-10, and it
separates observation from documentation.

## How to reproduce

```
cd docs/auth-probe
npm ci
node probe.mjs
```

Node 24 and Docker. The probe pulls
`postgres:17-alpine@sha256:18cfe3ef…` (pinned in `probe.mjs`), starts a
PostgreSQL container under a unique name on an ephemeral loopback port
(`127.0.0.1:0`), runs every scenario over the in-process Better Auth handler,
prints one JSON line per scenario, and removes only the container it created.
It touches no shared service. It exits non-zero if any assertion fails, if any
required scenario did not run, or if teardown failed.

`package-lock.json` pins better-auth 1.7.4, @better-auth/oauth-provider 1.7.4,
kysely 0.29.5 and pg 8.23.0 with integrity hashes.

## The probe can fail

Verified on this revision: changing one expected value to a wrong one made the
run print the failing scenario and exit 1, and the container was still removed.
The run also fails when a required scenario is missing, because every scenario
name in the run is checked against a required list at the end.

No token or secret is printed. Each line carries a status, an OAuth error code,
or a boolean; response bodies that could contain tokens are never logged.

## What was observed

| Scenario                                                | Observed                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| machine token                                           | JWT, `aud` is the resource, `scope` `api:read`, no `sid`               |
| scope above the ceiling                                 | `invalid_scope`                                                        |
| unlinked resource                                       | `invalid_target`                                                       |
| introspection by a linked service client                | `active: true`                                                         |
| **rotate, then old secret**                             | `invalid_client`                                                       |
| **rotate, then old token (asked by a second client)**   | `active: true`                                                         |
| rotate, then new secret                                 | issues 200                                                             |
| delete the client                                       | token `active: false`, issuance `invalid_client`                       |
| device flow                                             | code 200, pending, claim 200, approve 200, token 200                   |
| device token                                            | JWT with no `sid`; introspection `active: true`                        |
| device, after signing out the approving session         | still `active: true`                                                   |
| device, after revoking its refresh token                | reuse `invalid_grant`; access token still `active: true`               |
| revoking the device JWT directly                        | `unsupported_token_type`                                               |
| PKCE authorize and consent                              | 302 to consent, consent 200, code issued                               |
| PKCE token                                              | JWT carrying `sid`; introspection `active: true`                       |
| PKCE in-process validation (`requireActiveAccessToken`) | `active: true`, equal to introspection                                 |
| PKCE after sign-out                                     | introspection `false` **and** in-process validation `false`            |
| **PKCE refresh after sign-out**                         | 200, and the new token introspects `active: true`                      |
| PKCE refresh revoked                                    | revoke 200, reuse `invalid_grant`                                      |
| PKCE all-session revoke                                 | before `true`, revoke 200, after `false`                               |
| refresh preserves `auth_time`                           | refreshed `id_token.auth_time` equals the original; stored row present |
| refresh-age policy, fresh chain                         | 200                                                                    |
| refresh-age policy, backdated `authTime`                | 400 `invalid_grant`                                                    |
| **browser relay with a cookie**                         | 302 with a code, no consent page                                       |
| browser relay exchange                                  | 200, `aud` contains the kernel resource                                |
| forged session cookie                                   | 200 with a null session                                                |
| PKCE verifier mismatch on a valid code                  | `invalid_grant`                                                        |
| teardown                                                | container removed, verified gone                                       |

Three findings that changed the contract rather than confirming it:

1. **Secret rotation is not revocation.** The old secret stops issuing at once,
   and the already-issued token keeps working. Client deletion is what makes an
   issued machine token stop validating.
2. **A refresh outlives its session.** After a sign-out, the refresh grant still
   returns a token the library accepts, because that grant never consults the
   session. Desktop and CLI logout must revoke the refresh token; sign-out alone
   is not logout.
3. **Refresh preserves the original upstream authentication time.** That stored
   provenance is what makes an absolute membership-age limit possible at all,
   and it is why the earlier claim about refresh fetching fresh Google claims
   was withdrawn.

## What remains documentation-derived

- Google's own behavior: `hd` claim contents, account selection, and the
  freshness of a confirmation proof. The kernel uses the library's verifier
  against Google's live endpoints; nothing here exercises Google.
- Workspace Directory membership reads, which need domain-wide delegation that
  does not exist yet (contract section 5.2).
- Browser cookie behavior in a real browser, and the deployed front door.
- Client disablement as an API. At 1.7.4 the admin update schema drops the
  field, so the probe does not test it; the contract specifies deletion instead.

These are the deferred acceptance cases in contract section 12.
