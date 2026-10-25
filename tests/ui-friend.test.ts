import { afterEach, describe, expect, it } from "vitest";
import { recordedSnapshot } from "@/lib/seed/fixtures";
import { friendCard, michelleDecides } from "@/lib/ui/friend";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

afterEach(removeFakeModel);

const plan = recordedSnapshot().plans[0];

describe("the simulated friend", () => {
  it("answers her card with one real model call and the card holds only the plan", async () => {
    const model = installFakeModel([{ calls: [{ name: "answer_card", args: { choice: "accept" } }] }]);
    const answer = await michelleDecides(plan);
    expect(answer.choice).toBe("accept");
    expect(model.calls).toHaveLength(1);
    const sent = JSON.stringify(model.calls[0]);
    expect(sent).toContain("Michelle");
    expect(sent).toContain("Shawarma Point");
    expect(sent).not.toMatch(/Northwind|Interview|Aaron|Lisa|calendar/);
  });

  it("can decline", async () => {
    installFakeModel([{ calls: [{ name: "answer_card", args: { choice: "decline" } }] }]);
    expect((await michelleDecides(plan)).choice).toBe("decline");
  });

  it("never fakes a decision: a model that does not answer throws", async () => {
    installFakeModel([{ text: "I would love to go!" }, { text: "Still no tool." }]);
    await expect(michelleDecides(plan)).rejects.toThrow();
  });

  it("never fakes a decision when the model API fails", async () => {
    installFakeModel([{ error: 500 }, { error: 500 }, { error: 500 }, { error: 500 }]);
    await expect(michelleDecides(plan)).rejects.toThrow();
  });

  it("describes the plan from its title and window", () => {
    expect(friendCard(plan)).toContain("Shawarma Point");
    expect(friendCard(plan)).toMatch(/Tue/);
  });
});
