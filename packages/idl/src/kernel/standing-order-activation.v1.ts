// dsg.kernel.standing-order-activation/1
// Owner: dsg-kernel. The record event selects the one standing-order
// activation that API and worker may resolve. The revocation reference is
// the activation-time observation only; consumers must independently resolve
// the current revocation head before every authority use.
import { type Static, Type } from "@sinclair/typebox";
import { closed, Orn, Reference, UtcSecond, type ProfileEntry } from "../primitives.js";

export const STANDING_ORDER_ACTIVATION_PROFILE = "dsg.kernel.standing-order-activation/1" as const;
export const STANDING_ORDER_ACTIVATION_EVENT_KIND = "standing_order_activated" as const;

const StandingOrderModeSchemaValue = Type.Union([
  Type.Literal("synthetic-test-only"),
  Type.Literal("human-authority"),
]);
export const StandingOrderModeSchema: typeof StandingOrderModeSchemaValue =
  StandingOrderModeSchemaValue;
export type StandingOrderMode = Static<typeof StandingOrderModeSchema>;

/** The immutable descriptor retained with the activation event. */
const StandingOrderActivationSchemaValue = closed({
  profile: Type.Literal(STANDING_ORDER_ACTIVATION_PROFILE),
  /** Stable identity carried in the descriptor. The event's `activation`
   * reference points to this descriptor, avoiding a digest cycle. */
  activationId: Orn,
  /** Compare-and-set precondition. Null is valid only for the first head. */
  expectedPreviousActivation: Type.Union([Reference, Type.Null()]),
  law: Reference,
  enrollment: Reference,
  intent: Reference,
  roots: Reference,
  /** Activation-time observation. It never substitutes for a current read. */
  revocation: Reference,
  actor: Orn,
  mode: StandingOrderModeSchema,
  activatedAt: UtcSecond,
});
export const StandingOrderActivationSchema: typeof StandingOrderActivationSchemaValue =
  StandingOrderActivationSchemaValue;
export type StandingOrderActivation = Static<typeof StandingOrderActivationSchema>;

/** Append-only record event carrying the descriptor selected by the stream head. */
const StandingOrderActivationEventSchemaValue = closed({
  profile: Type.Literal(STANDING_ORDER_ACTIVATION_PROFILE),
  kind: Type.Literal(STANDING_ORDER_ACTIVATION_EVENT_KIND),
  stream: Orn,
  /** Reference to the canonical descriptor artifact. */
  activation: Reference,
});
export const StandingOrderActivationEventSchema: typeof StandingOrderActivationEventSchemaValue =
  StandingOrderActivationEventSchemaValue;
export type StandingOrderActivationEvent = Static<typeof StandingOrderActivationEventSchema>;

/** Detached signature over the canonical activation descriptor bytes. */
const SignedStandingOrderActivationSchemaValue = closed({
  body: StandingOrderActivationSchema,
  signer: Orn,
  signature: Type.String({ pattern: "^[0-9a-f]{128}$" }),
});
export const SignedStandingOrderActivationSchema: typeof SignedStandingOrderActivationSchemaValue =
  SignedStandingOrderActivationSchemaValue;
export type SignedStandingOrderActivation = Static<typeof SignedStandingOrderActivationSchema>;

export const standingOrderActivationV1: ProfileEntry = {
  literal: STANDING_ORDER_ACTIVATION_PROFILE,
  rootShape: "event",
  shapes: {
    activation: StandingOrderActivationSchema,
    signed: SignedStandingOrderActivationSchema,
    event: StandingOrderActivationEventSchema,
  },
};
