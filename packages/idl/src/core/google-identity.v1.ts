// dsg.core.google-identity/1
// Owner: dsg-kernel. A verified Google identity, as the kernel sees it:
// the Google account number is the only identity key and the email
// address is a display label. The kernel carries googleSubject in the
// shape "accounts.google.com:<digits>" and never compares email for
// identity after the claim.
//
// This profile ships beside dsg.core.identity-binding/1, which remains
// the frozen shape of the detached personal-key binding path. The real
// authority is Google-attested, so a separate profile names what a
// verified identity looks like on the wire today.
//
// googleSubject is required, email is optional. hostedDomain is set
// when the verified token carries the hd claim; absent is its own
// meaning, not the same as a missing value. audience is the client id
// the token was minted for and is required.
import { type Static, Type } from "@sinclair/typebox";
import { closed, NonEmptyString, type ProfileEntry } from "../primitives.js";

export const GOOGLE_IDENTITY_PROFILE = "dsg.core.google-identity/1" as const;
export const GOOGLE_SIGN_IN_ISSUER = "https://accounts.google.com" as const;

const GoogleAccountSubject = Type.String({
  pattern: "^accounts\\.google\\.com:[0-9]+$",
});

const GoogleIdentitySchemaValue = closed({
  profile: Type.Literal(GOOGLE_IDENTITY_PROFILE),
  issuer: Type.Literal(GOOGLE_SIGN_IN_ISSUER),
  googleSubject: GoogleAccountSubject,
  audience: NonEmptyString,
  hostedDomain: Type.Optional(NonEmptyString),
  email: Type.Optional(NonEmptyString),
});
export const GoogleIdentitySchema: typeof GoogleIdentitySchemaValue = GoogleIdentitySchemaValue;
export type GoogleIdentity = Static<typeof GoogleIdentitySchema>;

export const googleIdentityV1: ProfileEntry = {
  literal: GOOGLE_IDENTITY_PROFILE,
  rootDocument: "googleIdentity",
  documents: { googleIdentity: GoogleIdentitySchema },
};
