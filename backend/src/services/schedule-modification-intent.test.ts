import { describe, expect, it } from "vitest";
import { detectScheduleModificationIntent } from "./schedule-modification-intent";

describe("detectScheduleModificationIntent", () => {
  it("classifies add intent", () => {
    const result = detectScheduleModificationIntent("add EN.601.226 to my schedule");
    expect(result).toEqual({
      isScheduleModification: true,
      operation: "add",
      needsClarification: false,
      clarificationQuestion: undefined,
    });
  });

  it("classifies drop intent", () => {
    const result = detectScheduleModificationIntent("please drop 553.291");
    expect(result).toEqual({
      isScheduleModification: true,
      operation: "drop",
      needsClarification: false,
      clarificationQuestion: undefined,
    });
  });

  it("maps swap wording to replace intent", () => {
    const result = detectScheduleModificationIntent(
      "swap EN.601.226 with EN.553.291",
    );
    expect(result).toEqual({
      isScheduleModification: true,
      operation: "replace",
      needsClarification: false,
      clarificationQuestion: undefined,
    });
  });

  it("classifies replace intent", () => {
    const result = detectScheduleModificationIntent(
      "replace EN.601.226 with EN.520.433",
    );
    expect(result).toEqual({
      isScheduleModification: true,
      operation: "replace",
      needsClarification: false,
      clarificationQuestion: undefined,
    });
  });

  it("returns non-modification for non-edit chat", () => {
    const result = detectScheduleModificationIntent("is this workload too heavy?");
    expect(result).toEqual({ isScheduleModification: false });
  });

  it("flags ambiguous add and asks for clarification", () => {
    const result = detectScheduleModificationIntent("add one");
    expect(result).toMatchObject({
      isScheduleModification: true,
      operation: "add",
      needsClarification: true,
    });
    expect(result).toHaveProperty("clarificationQuestion");
  });

  it("flags ambiguous swap wording and asks for clarification as replace", () => {
    const result = detectScheduleModificationIntent("swap it for something easier");
    expect(result).toMatchObject({
      isScheduleModification: true,
      operation: "replace",
      needsClarification: true,
    });
    expect(result).toHaveProperty("clarificationQuestion");
  });
});
