import { describe, expect, it } from "vitest";
import { copy } from "@/lib/ui/copy";

describe("the settle card's note field", () => {
  // The field is about 250 px wide inside a 390 px phone at 15 px type: past roughly 38 characters the
  // placeholder is cut off, which is what the live site showed on both phones.
  it("has a placeholder short enough to show whole", () => {
    expect(copy.settleNotePlaceholder.length).toBeLessThanOrEqual(38);
  });

  it("keeps a full-sentence label for screen readers, apart from the placeholder", () => {
    expect(copy.settleNoteLabel).not.toBe(copy.settleNotePlaceholder);
    expect(copy.settleNoteLabel.length).toBeGreaterThan(copy.settleNotePlaceholder.length);
  });
});
