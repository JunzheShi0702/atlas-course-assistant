export interface TranscriptExtractionResult {
  extractedText: string;
  normalizedCodes: string[];
}

const DOT_LIKE_CHARS = /[\u2024\uFF0E\uFE52\u00B7\u2219]/g;
const INVISIBLE_CHARS = /[\u200B\u200C\u200D\u2060\u00AD\uFEFF]/g;
const FLEX_CODE_RE =
  /(^|[^0-9])([0-9])\s*([0-9])\s*([0-9])\s*\.\s*([0-9])\s*([0-9])\s*([0-9])(?![0-9])/g;

export function normalizeTranscriptText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(INVISIBLE_CHARS, "")
    .replace(DOT_LIKE_CHARS, ".");
}

/**
 * Finds catalog fragments "123.456" in transcript text and converts to
 * canonical JHU course codes:
 * - first block <= 499 => AS.xxx.xxx
 * - first block >= 500 => EN.xxx.xxx
 */
export function extractCanonicalTranscriptCourseCodes(text: string): string[] {
  const normalized = normalizeTranscriptText(text);
  const out: string[] = [];
  for (const match of normalized.matchAll(new RegExp(FLEX_CODE_RE.source, "g"))) {
    const left = Number(`${match[2]}${match[3]}${match[4]}`);
    const right = `${match[5]}${match[6]}${match[7]}`;
    if (!Number.isFinite(left)) continue;
    const prefix = left <= 499 ? "AS" : "EN";
    out.push(`${prefix}.${String(left).padStart(3, "0")}.${right}`);
  }
  return [...new Set(out)];
}

export async function extractTranscriptCoursesFromPdf(file: File): Promise<TranscriptExtractionResult> {
  const pdfjs = await import("pdfjs-dist");
  // Keep worker local to this app build.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  let allText = "";
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    // eslint-disable-next-line no-await-in-loop
    const page = await doc.getPage(pageNum);
    // eslint-disable-next-line no-await-in-loop
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
      .join(" ");
    allText += `\n${pageText}`;
  }

  return {
    extractedText: allText.trim(),
    normalizedCodes: extractCanonicalTranscriptCourseCodes(allText),
  };
}

