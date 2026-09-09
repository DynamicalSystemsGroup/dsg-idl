# Releases

Every wire profile is defined here once and consumed everywhere else, so a
consumer holding bytes has to be able to ask which commit produced them. This
file is that answer, and it records where the answer is missing.

## What is published

`@dynamicalsystems/idl` and `@dynamicalsystems/idl-conformance`, to the public
npm registry, at the same version as each other.

| Version | Tag | Commit | Consumed by |
| --- | --- | --- | --- |
| 0.8.0 | `v0.8.0` | `ed30f94` | the kernel and the plane, both pinned at 0.8.0 |
| 0.7.1 | none | not recorded | nothing today |
| 0.7.0 | none | not recorded | nothing today |
| 0.6.1 | `v0.6.1` | tagged | superseded |
| 0.6.0 | `v0.6.0` | tagged | superseded |

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

## The rule going forward

A release is a tag on a commit, and publishing happens from that tag through a
workflow that runs the repository check first. No release is made from a
working tree, and none from an unmerged branch.

That workflow does not exist yet: publishing here has always been a person
running a command, which is how 0.7.0 lost its provenance and how 0.8.0 came
off a pull request. Adding it needs a registry token in this repository's
secrets, which only Sayer can provision. Until it exists, a release is a
manual act and the person making it writes the version, the tag and the commit
into the table above in the same change that bumps the version.
