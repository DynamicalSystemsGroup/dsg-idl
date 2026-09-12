# Releases

Every wire profile is defined here once and consumed everywhere else, so a
consumer holding bytes has to be able to ask which commit produced them. This
file is that answer, and it records where the answer is missing.

## What is published

`@dynamicalsystems/idl` and `@dynamicalsystems/idl-conformance`, to the public
npm registry, at the same version as each other.

| Version | Tag      | Commit       | Consumed by                                    |
| ------- | -------- | ------------ | ---------------------------------------------- |
| 0.8.0   | `v0.8.0` | `ed30f94`    | the kernel and the plane, both pinned at 0.8.0 |
| 0.7.1   | none     | not recorded | nothing today                                  |
| 0.7.0   | none     | not recorded | nothing today                                  |
| 0.6.1   | `v0.6.1` | tagged       | superseded                                     |
| 0.6.0   | `v0.6.0` | tagged       | superseded                                     |

0.8.0 added the standing-order activation profile. It was published by hand
from the tip of an open pull request, which is why the rule below exists.

## The two versions with no provenance

0.7.0 and 0.7.1 are on npm and cannot be traced to a commit in this
repository. The registry records a publish-time head for 0.7.0 of `8ed90fd`,
and `packages/idl/package.json` at that commit still reads 0.6.1, so those
bytes were published from a working tree whose version bump was never
committed. 0.7.1 carries no recorded head at all. Neither is tagged and
neither will be: a tag naming a commit that did not produce the artifact is
worse than an absent tag, because it reads as provenance.

Nothing consumes either version. If something ever needs to, it has to be
republished from a commit.

## Tagged releases

An annotated `vMAJOR.MINOR.PATCH` tag triggers `.github/workflows/release.yml`.
Both package manifests must already contain that version, and the tagged commit
must be on `main`. The workflow refuses a dirty checkout, a version mismatch,
a lightweight tag or an unmerged commit.

The build job runs `just check`, including the frozen-profile gate with full
Git history. It packs both packages with the pinned pnpm version and writes
`release-manifest.json` with the source commit, tool versions and SHA-512
integrities. The separate publishing job publishes those exact archives through
npm trusted publishing. It downloads both npm tarballs and checks their bytes
before creating a GitHub Release with the archives and manifest attached.

The GitHub Release manifest records provenance for releases from 0.9.0 onward.
The table above retains the older release history. No second bookkeeping commit
is required to name the commit that produced a new release.

### Release with one command

From the clean delivery feature branch containing current `origin/main`, with
Node 24, pnpm, just, and authenticated `gh` available:

```sh
just release 0.12.0
```

Use the next unused version. This command prepares both package versions, runs
`just check`, commits the versions, pushes the current branch, creates or reuses
its main-targeted PR, waits for CI, and merges the exact checked head. It then
fast-forwards the feature checkout to that merge, creates and pushes an annotated
tag, and waits for the existing trusted-publishing workflow to verify both npm
archives and create the GitHub Release. Running it authorizes those external
actions; it does not update consumer pins or deploy services.

Dirty checkouts, missing main ancestry, existing tags or npm versions, changed PR
heads, and failed checks stop publication. Failures preserve the current state.
Before a tag exists, repair and commit the failure, then rerun the command. Once
a tag exists, use the failed-release procedure below; never move the tag.
`just release-version <version>` remains available for preparation without
publication.

### Configure npm once

Both existing packages need an npm trusted publisher configured for GitHub
Actions, repository `DynamicalSystemsGroup/dsg-idl`, workflow `release.yml`,
with publishing allowed and no environment name. The publishing job requests
`id-token: write`; no long-lived npm token is used or stored in GitHub.

An npm package administrator configures that trust. Having a local publish
token does not establish it. The workflow uses npm 11.16.0 and Node 24.18.0.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).

### Resume a failed release

Rerun the failed tag workflow. If the workflow itself needed a correction,
choose Run workflow on `main` and enter the existing tag. This uses the corrected
workflow while checking out and rebuilding the original tagged source. Before
any publish, it checks both package versions on npm. An existing version is skipped only when its registry integrity
and downloaded bytes match the tagged build. A mismatched existing version
stops the release; never overwrite the tag or reuse that version.

npm can take several minutes to expose an accepted publication. The workflow
allows ten minutes per package for registry visibility before failing.

If only one package published, the rerun verifies it and publishes the missing
package. A GitHub Release is created only after both are verified. An existing
GitHub Release must contain identical archives and the same manifest.

The frozen-profile tag is never deleted to retry publication. Authentication or
registry outages can be corrected and the same immutable tag retried. Source
or build corrections require a new version and tag.
