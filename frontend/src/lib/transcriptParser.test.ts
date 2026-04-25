import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  extractCanonicalTranscriptCourseCodes,
  extractTranscriptCoursesFromPdfWithOptions,
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

  it("extracts expected courses from transcript_Chubie.pdf", async () => {
    const bytes = await readFile(
      resolve(process.cwd(), "test-fixtures", "transcript_Chubie.pdf"),
    );
    const file = new File([bytes], "transcript_Chubie.pdf", { type: "application/pdf" });
    const parsed = await extractTranscriptCoursesFromPdfWithOptions(file, { disableWorker: true });
    expect(parsed.normalizedCodes).toEqual([
      "AS.110.304",
      "EN.553.421",
      "EN.601.220",
      "EN.601.226",
      "AS.110.412",
      "EN.553.431",
      "EN.601.229",
      "EN.601.230",
    ]);
  });

  it("extracts expected courses from transcript_fake_Chubie.pdf", async () => {
    const bytes = await readFile(
      resolve(process.cwd(), "test-fixtures", "transcript_fake_Chubie.pdf"),
    );
    const file = new File([bytes], "transcript_fake_Chubie.pdf", { type: "application/pdf" });
    const parsed = await extractTranscriptCoursesFromPdfWithOptions(file, { disableWorker: true });
    expect(parsed.normalizedCodes).toEqual(
      expect.arrayContaining([
        "AS.110.415",
        "AS.110.441",
        "AS.110.631",
        "EN.601.415",
        "EN.601.226",
        "EN.553.431",
        "EN.601.229",
        "EN.601.230",
        "AS.110.399",
      ]),
    );
  });
});

