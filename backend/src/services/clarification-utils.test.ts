import { describe, expect, it } from "vitest";
import {
  buildClarificationChoicesForFailure,
  buildClarificationPayload,
  extractPendingClarificationFromPayload,
  isAmbiguousClarificationPayload,
  normalizeClarificationOptions,
  normalizePendingChoices,
  sortSlotsByOptions,
} from "./clarification-utils";

describe("clarification-utils", () => {
  it("detects ambiguous clarification payloads", () => {
    expect(
      isAmbiguousClarificationPayload({
        scheduleChanges: { failed: [{ reasonCode: "ambiguous_reference" }] },
      }),
    ).toBe(true);
    expect(
      isAmbiguousClarificationPayload({
        scheduleChanges: { failed: [{ reasonCode: "not_found" }] },
      }),
    ).toBe(false);
  });

  it("builds rich clarification choices from payload results when keys match", () => {
    const failed = [{ courseCode: "601.226", sisOfferingName: "EN.601.226", term: "Spring 2026" }];
    const payloadResults = [
      {
        courseCode: "601.226",
        sisOfferingName: "EN.601.226",
        title: "Data Structures",
        term: "Spring 2026",
      },
    ];
    expect(buildClarificationChoicesForFailure(failed, payloadResults)).toEqual(payloadResults);
  });

  it("falls back to failed candidates when no rich matches exist", () => {
    const failed = [{ courseCode: "553.100", sisOfferingName: "EN.553.100", term: "Fall 2026" }];
    const payloadResults = [{ courseCode: "601.226", sisOfferingName: "EN.601.226", term: "Spring 2026" }];
    expect(buildClarificationChoicesForFailure(failed, payloadResults)).toEqual(failed);
  });

  it("normalizes clarification options and synthesizes labels", () => {
    const normalized = normalizeClarificationOptions([
      { code: "601.226", offeringName: "EN.601.226", title: "Data Structures", term: "Spring 2026" },
    ]);
    expect(normalized[0]).toMatchObject({
      courseCode: "601.226",
      sisOfferingName: "EN.601.226",
      label: "EN.601.226 - Data Structures (Spring 2026)",
      value: "EN.601.226",
    });
  });

  it("normalizes pending choices to object-only entries", () => {
    expect(normalizePendingChoices([{ id: "a" }, "bad", null, 1])).toEqual([{ id: "a" }]);
  });

  it("builds clarification payload with normalized options", () => {
    const payload = buildClarificationPayload({
      prompt: "Which course?",
      slotKey: "addTarget",
      candidateOptions: {
        addTarget: [{ code: "601.226", offeringName: "EN.601.226", title: "Data Structures" }],
      },
    });
    expect(payload).toMatchObject({
      type: "clarification",
      question: "Which course?",
      message: "Which course?",
      slotKey: "addTarget",
    });
    expect(Array.isArray(payload.options)).toBe(true);
  });

  it("extracts missing slots and sorts slots with options first", () => {
    const extracted = extractPendingClarificationFromPayload({
      scheduleChanges: {
        operation: "replace",
        failed: [
          {
            action: "drop",
            reasonCode: "not_in_schedule",
            candidates: [],
          },
          {
            action: "add",
            reasonCode: "ambiguous_reference",
            candidates: [{ code: "601.226", offeringName: "EN.601.226", term: "Spring 2026" }],
          },
        ],
      },
      results: [{ code: "601.226", offeringName: "EN.601.226", title: "Data Structures", term: "Spring 2026" }],
    });
    expect(extracted).not.toBeNull();
    expect(extracted?.sortedMissingSlots).toEqual(["addTarget", "dropTarget"]);
    expect(extracted?.operation).toBe("replace");
  });

  it("sorts slots by candidate options availability", () => {
    expect(sortSlotsByOptions(["dropTarget", "addTarget"], { addTarget: [{ id: "1" }], dropTarget: [] })).toEqual([
      "addTarget",
      "dropTarget",
    ]);
  });
});
