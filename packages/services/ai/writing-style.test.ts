import { describe, expect, it } from "vitest";

import { humanizeEmailBody } from "./writing-style";

describe("humanizeEmailBody", () => {
  it("drops stock openers and closers", () => {
    const body = [
      "Hi Priya,",
      "",
      "I hope this email finds you well. Thursday at 3pm works for me.",
      "",
      "Please don't hesitate to reach out if you have any questions.",
      "",
      "Ishaan",
    ].join("\n");
    expect(humanizeEmailBody(body)).toBe("Hi Priya,\n\nThursday at 3pm works for me.\n\nIshaan");
  });

  it("removes filler lines inside a greeting block", () => {
    expect(humanizeEmailBody("Hi Raj,\nI hope you're doing well.\nThe deck is attached.")).toBe(
      "Hi Raj,\nThe deck is attached.",
    );
  });

  it("replaces em dashes and strips markdown", () => {
    expect(humanizeEmailBody("**Quick note** — the call moved to 4pm.")).toBe("Quick note, the call moved to 4pm.");
    expect(humanizeEmailBody("## Update\nShipped—finally.")).toBe("Update\nShipped, finally.");
  });

  it("leaves real content, numbers and ranges untouched", () => {
    const body = "The budget is 3.5 lakh for 2–3 months. Can you confirm by Friday?";
    expect(humanizeEmailBody(body)).toBe(body);
  });

  it("never returns an empty body", () => {
    expect(humanizeEmailBody("I hope this email finds you well.")).toBe("I hope this email finds you well.");
  });
});
