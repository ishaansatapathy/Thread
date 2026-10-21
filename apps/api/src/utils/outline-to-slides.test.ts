import { describe, expect, it } from "vitest";

import { outlineToSlidesRequests } from "./outline-to-slides";

describe("outlineToSlidesRequests", () => {
  it("creates one slide per outline entry with title and bullet text", () => {
    const requests = outlineToSlidesRequests(
      [
        { title: "Intro", bullets: ["Point one", "Point two"] },
        { title: "Next steps", bullets: [] },
      ],
      "default_slide",
    );

    const creates = requests.filter((r) => "createSlide" in r);
    expect(creates).toHaveLength(2);

    const firstInsert = requests.find(
      (r) => "insertText" in r && (r as { insertText: { objectId: string } }).insertText.objectId === "title_0",
    );
    expect(firstInsert).toMatchObject({ insertText: { objectId: "title_0", text: "Intro" } });

    const bodyInsert = requests.find(
      (r) => "insertText" in r && (r as { insertText: { objectId: string } }).insertText.objectId === "body_0",
    );
    expect(bodyInsert).toMatchObject({ insertText: { objectId: "body_0", text: "Point one\nPoint two" } });

    const bullets = requests.find((r) => "createParagraphBullets" in r);
    expect(bullets).toMatchObject({ createParagraphBullets: { objectId: "body_0" } });
  });

  it("skips body insert and bullets for a slide with no bullets", () => {
    const requests = outlineToSlidesRequests([{ title: "Just a title", bullets: [] }], "default_slide");
    const bodyInsert = requests.find(
      (r) => "insertText" in r && (r as { insertText: { objectId: string } }).insertText.objectId === "body_0",
    );
    expect(bodyInsert).toBeUndefined();
  });

  it("deletes the original default slide last", () => {
    const requests = outlineToSlidesRequests([{ title: "A", bullets: ["x"] }], "default_slide");
    expect(requests.at(-1)).toEqual({ deleteObject: { objectId: "default_slide" } });
  });

  it("places createSlide before its own insertText within the same batch", () => {
    const requests = outlineToSlidesRequests([{ title: "A", bullets: ["x"] }], "default_slide");
    const createIndex = requests.findIndex((r) => "createSlide" in r);
    const insertIndex = requests.findIndex((r) => "insertText" in r);
    expect(createIndex).toBeLessThan(insertIndex);
  });
});
