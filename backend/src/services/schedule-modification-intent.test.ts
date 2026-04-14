import { describe, expect, it } from "vitest";
import { detectScheduleModificationIntent } from "./schedule-modification-intent";

describe("detectScheduleModificationIntent", () => {
  it("classifies add intent", () => {
    const result = detectScheduleModificationIntent("add EN.601.226 to my schedule");
    expect(result).toEqual({
      isScheduleModification: true,
      operation: "add",
    });
  });

  it("classifies drop intent", () => {
    const result = detectScheduleModificationIntent("please drop 553.291");
    expect(result).toEqual({
      isScheduleModification: true,
      operation: "drop",
    });
  });

  it("maps swap wording to replace intent", () => {
    const result = detectScheduleModificationIntent(
      "swap EN.601.226 with EN.553.291",
    );
    expect(result).toEqual({
      isScheduleModification: true,
      operation: "replace",
    });
  });

  it("classifies replace intent", () => {
    const result = detectScheduleModificationIntent(
      "replace EN.601.226 with EN.520.433",
    );
    expect(result).toEqual({
      isScheduleModification: true,
      operation: "replace",
    });
  });

  it("classifies common replace typos as replace intent", () => {
    const result = detectScheduleModificationIntent(
      "replcae EN.601.226 wiht EN.520.433",
    );
    expect(result).toEqual({
      isScheduleModification: true,
      operation: "replace",
    });
  });

  it("returns non-modification for non-edit chat", () => {
    const result = detectScheduleModificationIntent("is this workload too heavy?");
    expect(result).toEqual({ isScheduleModification: false });
  });

  it("keeps ambiguous add as operation-only classification", () => {
    const result = detectScheduleModificationIntent("add one");
    expect(result).toEqual({
      isScheduleModification: true,
      operation: "add",
    });
  });

  it("keeps ambiguous swap wording as operation-only classification", () => {
    const result = detectScheduleModificationIntent("swap it for something easier");
    expect(result).toEqual({
      isScheduleModification: true,
      operation: "replace",
    });
  });
});
