/**
 * Builds a Google Slides batchUpdate request list from a simple title+bullets
 * outline. Each slide is created with a TITLE_AND_BODY layout and known
 * placeholder ids (via placeholderIdMappings), so title/body text can be
 * inserted in the same batchUpdate call without a round-trip to read back
 * generated object ids. The presentation's default first slide (created by
 * `presentations.create`) is deleted at the end since our own slides replace it.
 */
export type OutlineSlide = { title: string; bullets: string[] };

export function outlineToSlidesRequests(
  outline: OutlineSlide[],
  defaultSlideId: string,
): Record<string, unknown>[] {
  const requests: Record<string, unknown>[] = [];

  outline.forEach((slide, index) => {
    const slideId = `slide_${index}`;
    const titleId = `title_${index}`;
    const bodyId = `body_${index}`;

    requests.push({
      createSlide: {
        objectId: slideId,
        insertionIndex: index,
        slideLayoutReference: { predefinedLayout: "TITLE_AND_BODY" },
        placeholderIdMappings: [
          { layoutPlaceholder: { type: "TITLE", index: 0 }, objectId: titleId },
          { layoutPlaceholder: { type: "BODY", index: 0 }, objectId: bodyId },
        ],
      },
    });

    if (slide.title) {
      requests.push({ insertText: { objectId: titleId, text: slide.title.slice(0, 200) } });
    }

    const bodyText = slide.bullets.filter(Boolean).join("\n").slice(0, 4000);
    if (bodyText) {
      requests.push({ insertText: { objectId: bodyId, text: bodyText } });
      requests.push({
        createParagraphBullets: {
          objectId: bodyId,
          textRange: { type: "ALL" },
          bulletPreset: "BULLET_DISC_CIRCLE_SQUARE",
        },
      });
    }
  });

  requests.push({ deleteObject: { objectId: defaultSlideId } });
  return requests;
}
