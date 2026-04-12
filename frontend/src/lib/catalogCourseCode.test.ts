import { describe, expect, it } from "vitest";
import {
  catalogCourseCodeFromOfferingName,
  ensureCatalogCourseCode,
} from "./catalogCourseCode";

describe("catalogCourseCodeFromOfferingName", () => {
  it("takes the first three segments", () => {
    expect(catalogCourseCodeFromOfferingName("AS.110.304.01")).toBe("AS.110.304");
  });
});

describe("ensureCatalogCourseCode", () => {
  it("uppercases full catalog codes", () => {
    expect(ensureCatalogCourseCode("as.110.304")).toBe("AS.110.304");
  });

  it("fills school prefix from sisOfferingName when code is bare numeric", () => {
    expect(ensureCatalogCourseCode("110.304", "AS.110.304.01")).toBe("AS.110.304");
    expect(ensureCatalogCourseCode("553.171", "EN.553.171.02")).toBe("EN.553.171");
  });

  it("derives code from offering when code is N/A", () => {
    expect(ensureCatalogCourseCode("N/A", "AS.110.304.01")).toBe("AS.110.304");
  });
});
