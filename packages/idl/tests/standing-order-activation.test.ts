import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  SignedStandingOrderActivationSchema,
  StandingOrderActivationEventSchema,
  StandingOrderActivationSchema,
} from "../src/index.js";

const reference = (orn: string, fill: string) => ({ orn, sha256: fill.repeat(64) });
const activation = {
  profile: "dsg.kernel.standing-order-activation/1",
  activationId: "orn:dsg.core.kernel.standing-order:activation-1",
  expectedPreviousActivation: null,
  law: reference("orn:dsg.core.kernel.artifact:law", "b"),
  enrollment: reference("orn:dsg.core.kernel.artifact:enrollment", "c"),
  intent: reference("orn:dsg.core.kernel.artifact:intent", "d"),
  roots: reference("orn:dsg.core.kernel.artifact:roots", "e"),
  revocation: reference("orn:dsg.core.kernel.artifact:revocation", "f"),
  actor: "orn:dsg.core.kernel.actor:kernel-api",
  mode: "human-authority",
  activatedAt: "2026-09-08T20:00:00Z",
} as const;

describe("standing-order activation profile", () => {
  it("accepts a closed activation event with an explicit compare-and-set head", () => {
    expect(
      Value.Check(StandingOrderActivationEventSchema, {
        profile: "dsg.kernel.standing-order-activation/1",
        kind: "standing_order_activated",
        stream: "orn:dsg.core.kernel.standing-order:current",
        activation: reference("orn:dsg.core.kernel.standing-order:activation-1", "a"),
      }),
    ).toBe(true);
    expect(Value.Check(StandingOrderActivationSchema, { ...activation, unexpected: true })).toBe(
      false,
    );
  });

  it("rejects an activation that omits the actor or changes its mode", () => {
    expect(Value.Check(StandingOrderActivationSchema, { ...activation, actor: undefined })).toBe(
      false,
    );
    expect(Value.Check(StandingOrderActivationSchema, { ...activation, mode: "operator" })).toBe(
      false,
    );
  });

  it("requires a detached signature over the exact descriptor body", () => {
    expect(
      Value.Check(SignedStandingOrderActivationSchema, {
        body: activation,
        signer: "orn:dsg.core.kernel.actor:kernel-api",
        signature: "a".repeat(128),
      }),
    ).toBe(true);
    expect(
      Value.Check(SignedStandingOrderActivationSchema, {
        body: activation,
        signer: "orn:dsg.core.kernel.actor:kernel-api",
        signature: "A".repeat(128),
      }),
    ).toBe(false);
  });
});
