# Probe evidence for the shared authentication contract

The retained probe uses Better Auth 1.7.4, OAuth Provider 1.7.4, Kysely 0.29.5
and PostgreSQL. This is isolated library evidence. It does not exercise Google,
production applications, the installed desktop or the deployed front door.

## Reproduce

```sh
cd docs/auth-probe
npm ci
node probe.mjs
```

Use Node 24 and Docker. `probe.mjs` pins the PostgreSQL image by digest, starts
one uniquely named container on an ephemeral loopback port, and removes only
that container. It asserts outcomes, checks that every required scenario ran,
verifies container removal and exits nonzero on failure. It prints no tokens,
secrets or token response bodies. `package-lock.json` retains package integrity.

## Observed boundaries

| Case                                                | Result                                                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Machine scope and resource ceiling                  | Excess scope refuses with `invalid_scope`; unlinked resource with `invalid_target`.                                  |
| Machine secret rotation                             | Old secret refuses with `invalid_client`; old token remains active; new secret issues.                               |
| Machine client deletion                             | Existing token becomes inactive; new issuance refuses.                                                               |
| Device sign-out                                     | Approving browser session ends; device token stays active.                                                           |
| Device refresh revocation                           | Refresh reuse refuses; issued access token stays active.                                                             |
| Direct JWT revocation                               | `unsupported_token_type`.                                                                                            |
| PKCE sign-out                                       | Existing session-linked token becomes inactive in introspection and in-process validation.                           |
| PKCE refresh after sign-out                         | New access token issues and introspects active. Logout must revoke refresh as well.                                  |
| PKCE all-session revocation                         | Existing session-linked token becomes inactive.                                                                      |
| Wrong PKCE verifier, first exchange of a fresh code | **401 `invalid_request`**.                                                                                           |
| Correct verifier, separate fresh code               | 200.                                                                                                                 |
| Replay of a consumed code                           | **400 `invalid_grant`**.                                                                                             |
| Browser relay                                       | Skip-consent authorization returns a code; exchange produces a person token.                                         |
| Two-resource person token                           | Repeated `resource` parameters produce both audiences; independently linked plane and kernel validators both accept. |
| Kernel-only token at plane validator                | Inactive.                                                                                                            |
| Expired, signed-out or forged browser cookie        | Session read returns null.                                                                                           |

Revision 3's PKCE negative test exchanged the code before attempting the wrong
verifier. It measured replay, not PKCE. The revised `issueCode` helper returns
an unconsumed code, and `exchangeCode` performs its first exchange. Replacing
only the negative case's different verifier with the correct verifier must fail
the assertion with actual status 200. The valid control and replay stay separate.

## Why the refresh-age policy was withdrawn

The candidate middleware remains in the probe to make its limitations
reproducible. It is not production code or a proposed kernel policy.

| Boundary                                                               | Observed with the candidate policy enabled                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Fresh PKCE refresh                                                     | 200; original `auth_time` preserved.                                                 |
| PKCE refresh two seconds before the age limit                          | 200.                                                                                 |
| Access from that refresh after waiting 3.1 seconds                     | Introspection still active.                                                          |
| Next refresh after the age limit                                       | 400 `invalid_grant`.                                                                 |
| Browser session with `createdAt` backdated 30 days but still unexpired | Session read still succeeds.                                                         |
| New code from that old browser session                                 | Issues and exchanges; ID-token time retains the old session time.                    |
| Refresh of that new chain                                              | 400 `invalid_grant`.                                                                 |
| Device issuance approved with the old browser cookie                   | Succeeds; refresh row has null `authTime`.                                           |
| Device refresh with the candidate policy                               | Even a fresh refresh refuses with 400 `invalid_grant` because provenance is missing. |
| Device access with the candidate policy                                | Still active.                                                                        |
| Same device refresh after disabling the candidate policy               | 200.                                                                                 |

These measurements disprove an absolute upstream-authentication cutoff from a
refresh-only hook. They also show why application token expiry is not a finite
Workspace-offboarding bound. The current contract uses recorded suspension and
names Directory integration as the dependency for automatic removal detection.
No synthetic timestamp is treated as a Google membership observation.

## Source evidence

The lockfile-pinned package source supplies the mechanisms behind the probe:

- OAuth Provider `dist/authorize-zWEGx4ky.mjs`, `authorizeEndpoint`, copies
  `session.createdAt` into the authorization code's `authTime`.
- `dist/introspect-Dlc-aIaF.mjs`, `handleRefreshTokenGrant`, reads the refresh
  row and internal user without contacting Google. `createRefreshToken`
  preserves the supplied `authTime`, but expiration is calculated anew during
  each issuance.
- `dist/index.mjs`, `exchangeOAuthDeviceCode`, calls `provider.issueTokens`
  without `sessionId` or `authTime`.
- `handleAuthorizationCodeGrant` returns 401 `invalid_request` when the S256
  challenge does not match. A consumed or unknown code has a different failure.
- Better Auth `dist/api/routes/session.mjs` supports uncached session reads and
  `disableRefresh`. Session renewal does not replace `createdAt`.

The [session-management reference](https://better-auth.com/docs/concepts/session-management)
confirms the distinction between expiry, renewal and cookie caching. Google's
[Directory users.get reference](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/get)
identifies the lookup and read-only OAuth scope. Both were checked on
2026-09-10. Neither reference proves a Directory observation in this environment.

## Verification and remaining acceptance

On 2026-09-10 the full run exited 0 with 64 checks and zero failures. The
isolated correct-verifier mutation exited 1 with exactly the wrong-verifier
assertion failing, actual status 200. Both runs verified their containers gone.

```text
probe.summary: failures=0, scenarios=64
correct-verifier mutation: failures=1, scenarios=64, exit=1
```

To reproduce the mutation, copy `probe.mjs` beside the installed dependencies,
replace only `exchangeCode(bad, differentVerifier)` with
`exchangeCode(bad, bad.verifier)`, and run that copy. The retained source keeps
the negative verifier. Refusal compatibility was checked with seven assertions
against the actual TypeBox schemas:
each version accepts its own literal and rejects the other; an explicit union
accepts both and rejects unknown versions. No released schema bytes changed. `just check` passed the build, frozen-schema
check, generated-schema freshness, types, lint, formatting and all 25 tests.

Still requiring application or live acceptance: Google sign-in and identity
mapping; current-cookie checks around the actual console token cache; browser
cookie behavior; both service credentials across the deployed relay; stream
suspension; confirmation; installed-desktop custody and logout; Directory
permissions and observations. The probe proves library operations, not their
integration into those consumers.
