import { describe, expect, it } from "vitest";
import {
  extractCanonicalTranscriptCourseCodes,
  normalizeTranscriptText,
} from "./transcriptParser";

describe("transcriptParser", () => {
  it("normalizes dot-like and invisible chars", () => {
    const raw = `110\u2024411\u200B`;
    expect(normalizeTranscriptText(raw)).toBe("110.411");
  });

  it("extracts and maps numeric transcript codes to AS/EN canonical codes", () => {
    const text = `
      Courses: 030.101, 110.411, 500.112, 601.226
      Also with spaces: 1 1 0 . 4 1 1
    `;
    expect(extractCanonicalTranscriptCourseCodes(text)).toEqual([
      "AS.030.101",
      "AS.110.411",
      "EN.500.112",
      "EN.601.226",
    ]);
  });
});

