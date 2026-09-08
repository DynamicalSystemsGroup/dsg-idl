// dsg.core.identity-binding/1
// Owner: dsg-kernel. A binding is a signed act through the door.
// The CLI signs; the plane forwards; the kernel verifies and appends.
import { type Static, Type } from "@sinclair/typebox";
import { closed, NonEmptyString, Orn, UtcSecond, type ProfileEntry } from "../primitives.js";

export const IDENTITY_BINDING_PROFILE = "dsg.core.identity-binding/1" as const;
export const GOOGLE_SIGN_IN_ISSUER = "https://accounts.google.com" as const;

const IdentityBindingSchemaValue = closed({
  profile: Type.Literal(IDENTITY_BINDING_PROFILE),
  principal: Orn,
  issuer: Type.Literal(GOOGLE_SIGN_IN_ISSUER),
  subject: NonEmptyString,
  decider: Orn,
  boundAt: UtcSecond,
  signature: NonEmptyString,
});
export const IdentityBindingSchema: typeof IdentityBindingSchemaValue = IdentityBindingSchemaValue;
export type IdentityBinding = Static<typeof IdentityBindingSchema>;

export const identityBindingV1: ProfileEntry = {
  literal: IDENTITY_BINDING_PROFILE,
  rootShape: "binding",
  shapes: { binding: IdentityBindingSchema },
};
