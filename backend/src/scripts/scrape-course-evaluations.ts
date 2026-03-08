/**
 * Course evaluations scraper
 *
 * Scrapes quantitative course evaluation metrics from the JHU EvaluationKit
 * public report and upserts them into the course_evaluations table.
 *
 * Usage:
 *   npm run scrape-evals                  # run scraper (headless)
 *   npm run scrape-evals -- --dry-run    # scrape without writing to DB
 *   npm run scrape-evals -- --discover   # open browser, save HTML/screenshot for inspection
 *
 * Requires in backend/.env:
 *   DATABASE_URL
 *
 * Source: https://asen-jhu.evaluationkit.com/Login/ReportPublic?id=THo7RYxiDOgppCUb8vkY%2bPMVFDNyK2ADK0u537x%2fnZsNvzOBJJZTTNEcJihG8hqZ
 */

import * as fs from "fs";
import * as path from "path";

import dotenv from "dotenv";
dotenv.config();

import { chromium, type Page } from "playwright";
import { pool } from "../db";

// ─── Constants ───────────────────────────────────────────────────────────────

const EVAL_BASE_URL =
  "https://asen-jhu.evaluationkit.com/Login/ReportPublic?id=THo7RYxiDOgppCUb8vkY%2bPMVFDNyK2ADK0u537x%2fnZsNvzOBJJZTTNEcJihG8hqZ";
const DISCOVER_OUTPUT_DIR = path.join(process.cwd(), "scrape-debug");

/** Course prefixes to search so we cover all courses (EN = Engineering, AS = Arts/Sciences, etc.). */
const SEARCH_COURSE_PREFIXES = ["AS.", "EN."];
const TARGET_YEARS = ["2025"];

/** Look like a normal browser so the public report doesn't show a login gate. */
const BROWSER_CONTEXT_OPTIONS = {
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 720 },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ScrapedEvalRow {
  itemIndex: number;
  course_code: string;
  section_number: string | null;
  semester: string;
  instructor: string | null;
  response_rate: number | null;
}

interface ScrapedMetrics {
  overall_quality: number | null;
  teaching_effectiveness: number | null;
  intellectual_challange: number | null;
  ta_quality: number | null;
  feedback_quality: number | null;
  work_load: number | null;
}

interface ReportQuestion {
  QuestionText: string;
  Mean: string;
  QuestionType: number;
}

// ─── Pure utilities ───────────────────────────────────────────────────────────

function isDiscoverMode(): boolean {
  return process.argv.includes("--discover");
}

function isDryRun(): boolean {
  return process.argv.includes("--dry-run");
}

/** Run tasks from `items` concurrently with at most `limit` in-flight at a time. */
async function withConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Retry an async operation up to `attempts` times with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 1000): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** i));
    }
  }
  throw lastError;
}

/**
 * Simple async mutex to serialize critical sections.
 * Used to prevent concurrent workers from racing on `page.waitForEvent("popup")`:
 * only one worker may register the popup listener + click at a time, so each
 * popup event is claimed by exactly the worker that opened it.
 */
class Mutex {
  private _chain: Promise<void> = Promise.resolve();

  async acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    const prev = this._chain;
    this._chain = prev.then(() => next);
    await prev;
    return release;
  }
}


/** Parse catalog course code from full offering string (e.g. EN.550.310.11.SU15 -> EN.550.310). */
function toCatalogCourseCode(fullCode: string): string {
  const match = fullCode.trim().match(/^([A-Z]{2}\.\d+\.\d+)/);
  return match ? match[1] : fullCode.trim();
}

/**
 * Parse section number from full offering string when present (e.g. EN.550.310.11.SU15 -> 11).
 * Returns null when there is no clear section segment.
 */
function toSectionNumber(fullCode: string): string | null {
  const parts = fullCode.trim().split(".");
  // Expect format like EN.550.310.11.SU15 (5 segments); when only 4 (e.g. EN.550.310.FA15), treat as no section.
  return parts.length >= 5 ? parts[3]?.trim() || null : null;
}

/** Parse response rate from text like "18 of 19 responded (94.74%)" -> 0.9474 or null. */
function parseResponseRate(text: string): number | null {
  const match = text.match(/\(([\d.]+)%\)/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  return Number.isFinite(n) ? n / 100 : null;
}

function parseFirstNonEmptyLine(text: string | null): string | null {
  if (!text) return null;
  return text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? null;
}

function normalizeForMatch(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function emptyMetrics(): ScrapedMetrics {
  return {
    overall_quality: null,
    teaching_effectiveness: null,
    intellectual_challange: null,
    ta_quality: null,
    feedback_quality: null,
    work_load: null,
  };
}

function getMetricCount(metrics: ScrapedMetrics): number {
  return Object.values(metrics).filter((v) => v !== null).length;
}

// ─── Browser / page helpers ───────────────────────────────────────────────────

/**
 * Fill "Search by Course Code or Course Title" with a prefix (e.g. "EN." or "AS."),
 * submit the form, and wait for the Results page. Other filters appear after search.
 */
async function runSearchWithPrefix(page: Page, coursePrefix: string): Promise<void> {
  await withRetry(async () => {
    await page.fill("#Course", coursePrefix);
    await page.click('button[type="submit"].sr-search-btn');
    await page.waitForURL(/\/Report\/Public\/Results/i, { timeout: 15000 });
    await page.waitForLoadState("load");
    await page.waitForTimeout(2000);
  });
}

/** Click "Show more results" until all results are loaded (button hidden or count stops increasing). */
async function expandAllResults(page: Page): Promise<void> {
  // Wait for initial results to appear before trying to expand
  await page.locator("li.sr-dataitem").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});

  let prevCount = 0;
  let stableRounds = 0;
  const maxStable = 2;

  while (stableRounds < maxStable) {
    const more = page.locator("a#publicMore");
    if (!(await more.isVisible().catch(() => false))) break;

    const count = await page.locator("li.sr-dataitem").count();
    stableRounds = count === prevCount ? stableRounds + 1 : 0;
    prevCount = count;

    await more.click();
    await page.waitForFunction(`document.querySelectorAll("li.sr-dataitem").length > ${count}`, { timeout: 5000 }).catch(() => {});
  }
  console.log(`    Expanded to ${await page.locator("li.sr-dataitem").count()} total results.`);
}

/**
 * On the results page, select a specific year in the "Year" wm-select filter
 * and re-run the search so only that year's results are shown.
 */
async function applyYearFilter(page: Page, year: string): Promise<void> {
  const yearSelect = page.locator("wm-select#wmSelectYear");
  await yearSelect.waitFor({ state: "visible", timeout: 15000 });
  await yearSelect.click();

  const option = page.locator(`wm-select#wmSelectYear wm-option[value="${year}"]`);
  await option.waitFor({ state: "visible", timeout: 10000 });
  await option.click();

  const searchButton = page.locator("a.sr-search-btn-results");
  if (!(await searchButton.isVisible().catch(() => false))) return;

  await Promise.all([page.waitForLoadState("load"), searchButton.click()]);
  await page.waitForTimeout(2000);
}

/**
 * Extract eval rows from the results list (ul#sr-data li.sr-dataitem).
 * Numeric metrics (overall_quality, etc.) are in the View Report modal — not parsed here.
 */
async function parseResultsList(page: Page): Promise<ScrapedEvalRow[]> {
  const rows: ScrapedEvalRow[] = [];
  const items = page.locator("li.sr-dataitem");
  const count = await items.count();

  for (let i = 0; i < count; i++) {
    const item = items.nth(i);
    const fullCode = await item.locator(".sr-dataitem-info-code").first().textContent().then((s) => s ?? "").catch(() => "");
    const instructorText = await item.locator(".sr-dataitem-info-instr").first().innerText().catch(() => null);
    const smallText = await item.locator(".sr-dataitem-info p.small").first().innerText().catch(() => null);
    const responseText = await item.locator(".sr-avg p.small span").first().textContent().then((s) => s ?? "").catch(() => "");

    const course_code = toCatalogCourseCode(fullCode);
    const semester = parseFirstNonEmptyLine(smallText) ?? "";

    if (course_code && semester) {
      rows.push({
        itemIndex: i,
        course_code,
        section_number: toSectionNumber(fullCode),
        semester,
        instructor: parseFirstNonEmptyLine(instructorText),
        response_rate: parseResponseRate(responseText),
      });
    }
  }
  return rows;
}

const PHRASE_MAP = {
  overall_quality: ["the overall quality of this course is"],
  teaching_effectiveness: ["the instructor's teaching effectiveness is", "the instructors teaching effectiveness is"],
  intellectual_challange: ["the intellectual challenge of this course is"],
  ta_quality: ["the teaching assistant for this course is"],
  feedback_quality: ["feedback on my work for this course is useful"],
  work_load: ["the workload for this course is", "workload for this course is"],
} as const;

/**
 * Primary: parse metrics from #hdnReportData JSON (server-rendered into the initial HTML).
 * Returns null if the input is missing or empty (client-side rendered page).
 */
async function parseMetricsFromJson(reportPage: Page): Promise<ScrapedMetrics | null> {
  const raw = await reportPage.inputValue("#hdnReportData").catch(() => "");
  if (!raw || raw === "[]") return null;

  let questions: ReportQuestion[];
  try {
    questions = JSON.parse(raw);
  } catch {
    return null;
  }

  const metricFor = (phrases: string[]): number | null => {
    const normalizedPhrases = phrases.map(normalizeForMatch);
    const q = questions.find((q) => normalizedPhrases.some((p) => normalizeForMatch(q.QuestionText).includes(p)));
    if (!q) return null;
    const n = parseFloat(q.Mean);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  return {
    overall_quality: metricFor([...PHRASE_MAP.overall_quality]),
    teaching_effectiveness: metricFor([...PHRASE_MAP.teaching_effectiveness]),
    intellectual_challange: metricFor([...PHRASE_MAP.intellectual_challange]),
    ta_quality: metricFor([...PHRASE_MAP.ta_quality]),
    feedback_quality: metricFor([...PHRASE_MAP.feedback_quality]),
    work_load: metricFor([...PHRASE_MAP.work_load]),
  };
}

/**
 * Fallback: parse metrics from the rendered DOM for client-side pages that don't use #hdnReportData.
 * Looks for numbered question headings and extracts the Mean from the following stats table.
 * Uses a string-based evaluate to avoid TypeScript DOM lib requirements.
 */
async function parseMetricsFromDom(reportPage: Page): Promise<ScrapedMetrics> {
  const phrasesSerialized = JSON.stringify(
    (Object.entries(PHRASE_MAP) as [string, readonly string[]][]).map(([k, v]) => [k, [...v]]),
  );

  const extracted = (await reportPage.evaluate(`
    (() => {
      const phrases = ${phrasesSerialized};
      const result = {};

      const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,div,p"))
        .filter(el => {
          const text = el.textContent?.trim() ?? "";
          return /^\\d+\\s*[-\\u2013]\\s*.+/.test(text) && text.length < 200;
        });

      for (const heading of headings) {
        const headingText = (heading.textContent ?? "").toLowerCase().trim();

        let el = heading;
        let table = null;
        for (let i = 0; i < 10 && el; i++) {
          el = el.nextElementSibling;
          if (!el) break;
          if (el.tagName === "TABLE") { table = el; break; }
          const inner = el.querySelector("table");
          if (inner) { table = inner; break; }
        }
        if (!table) continue;

        // Find Mean: either "Mean" header with value in same row, or header row followed by data row
        const rows = Array.from(table.querySelectorAll("tr"));
        let mean = null;
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll("td,th"));
          const labels = cells.map(c => (c.textContent ?? "").trim().toLowerCase());
          const meanIdx = labels.indexOf("mean");
          if (meanIdx === -1) continue;
          // Try same row first (Mean header + value side by side)
          const sameRowVal = parseFloat(cells[meanIdx + 1]?.textContent ?? "");
          if (!isNaN(sameRowVal)) { mean = sameRowVal; break; }
          // Try next row (header row above data row)
          const nextCells = Array.from((row.nextElementSibling ?? {querySelectorAll:()=>[]}).querySelectorAll("td"));
          const nextVal = parseFloat(nextCells[meanIdx]?.textContent ?? "");
          if (!isNaN(nextVal)) { mean = nextVal; }
          break;
        }

        for (const [key, phrasesForKey] of phrases) {
          if (phrasesForKey.some(p => headingText.includes(p))) {
            result[key] = mean;
            break;
          }
        }
      }
      return result;
    })()
  `)) as Record<string, number | null>;

  return {
    overall_quality: extracted.overall_quality ?? null,
    teaching_effectiveness: extracted.teaching_effectiveness ?? null,
    intellectual_challange: extracted.intellectual_challange ?? null,
    ta_quality: extracted.ta_quality ?? null,
    feedback_quality: extracted.feedback_quality ?? null,
    work_load: extracted.work_load ?? null,
  };
}

async function parseReportMetrics(reportPage: Page): Promise<ScrapedMetrics> {
  return (await parseMetricsFromJson(reportPage)) ?? (await parseMetricsFromDom(reportPage));
}

async function saveReportDebugArtifacts(reportPage: Page, label: string): Promise<void> {
  if (!fs.existsSync(DISCOVER_OUTPUT_DIR)) fs.mkdirSync(DISCOVER_OUTPUT_DIR, { recursive: true });
  const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, "_");
  try {
    const html = await reportPage.content();
    fs.writeFileSync(path.join(DISCOVER_OUTPUT_DIR, `report-${safeLabel}.html`), html, "utf-8");
  } catch (e) {
    console.log(`    [debug] Could not save HTML for ${safeLabel}: ${e}`);
  }
  try {
    await reportPage.screenshot({ path: path.join(DISCOVER_OUTPUT_DIR, `report-${safeLabel}.png`), fullPage: true });
  } catch (e) {
    console.log(`    [debug] Could not save screenshot for ${safeLabel}: ${e}`);
  }
}

async function scrapeReportForItem(
  page: Page,
  itemIndex: number,
  options?: { keepOpenMs?: number; debugLabel?: string; popupMutex?: Mutex },
): Promise<ScrapedMetrics | null> {
  const viewBtn = page.locator("li.sr-dataitem").nth(itemIndex).locator("a.sr-view-report").first();
  if (!(await viewBtn.isVisible().catch(() => false))) return null;

  let reportPage: Page | null = null;
  try {
    // Serialize popup open: only one worker may register the popup listener + click at a time.
    // Without this, concurrent workers race on waitForEvent("popup") and claim each other's popups.
    const release = options?.popupMutex ? await options.popupMutex.acquire() : null;
    try {
      reportPage = await withRetry(async () => {
        const popupPromise = page.waitForEvent("popup", { timeout: 8000 });
        await viewBtn.click({ timeout: 8000 });
        return await popupPromise;
      });
    } finally {
      release?.();
    }
  } catch {
    return null;
  }

  if (!reportPage) return null;

  try {
    await reportPage.waitForLoadState("domcontentloaded", { timeout: 10000 });

    // Wait for hdnReportData; if empty (server error), reload up to 2 more times
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await reportPage.reload({ waitUntil: "domcontentloaded", timeout: 10000 });
      await reportPage.waitForFunction(
        `(document.querySelector("#hdnReportData")?.value ?? "").length > 2`,
        { timeout: 5000 },
      ).catch(() => {});
      const data = await reportPage.inputValue("#hdnReportData").catch(() => "");
      if (data && data !== "[]") break;
    }

    const metrics = await parseReportMetrics(reportPage);
    if ((isDiscoverMode() || isDryRun()) && getMetricCount(metrics) === 0) {
      await saveReportDebugArtifacts(reportPage, options?.debugLabel ?? `item-${itemIndex}`);
    }
    return metrics;
  } catch {
    if (isDiscoverMode() || isDryRun()) {
      await saveReportDebugArtifacts(reportPage, options?.debugLabel ?? `item-${itemIndex}-failed`);
    }
    return emptyMetrics();
  } finally {
    if (options?.keepOpenMs && options.keepOpenMs > 0) {
      await reportPage.waitForTimeout(options.keepOpenMs).catch(() => {});
    }
    await reportPage.close().catch(() => {});
  }
}

// ─── Database helpers ─────────────────────────────────────────────────────────

/**
 * Insert a fully-scraped eval row (including metrics) into course_evaluations.
 * Only called when metrics are non-empty — rows with no metrics are never written.
 * Skips duplicates via NOT EXISTS check.
 */
async function upsertEvalRow(row: ScrapedEvalRow, metrics: ScrapedMetrics): Promise<void> {
  await pool.query(
    `INSERT INTO course_evaluations
       (course_code, section_number, semester, instructor, response_rate,
        overall_quality, teaching_effectiveness, intellectual_challange,
        ta_quality, feedback_quality, work_load)
     SELECT $1::text, $2::text, $3::varchar, $4::text, $5::numeric,
            $6, $7, $8, $9, $10, $11
     WHERE NOT EXISTS (
       SELECT 1 FROM course_evaluations
       WHERE course_code = $1::text
         AND (section_number IS NOT DISTINCT FROM $2::text)
         AND semester = $3::varchar
         AND (instructor IS NOT DISTINCT FROM $4::text)
     )`,
    [
      row.course_code,
      row.section_number ?? null,
      row.semester,
      row.instructor ?? null,
      row.response_rate ?? null,
      metrics.overall_quality,
      metrics.teaching_effectiveness,
      metrics.intellectual_challange,
      metrics.ta_quality,
      metrics.feedback_quality,
      metrics.work_load,
    ],
  );
}

// ─── Orchestration ────────────────────────────────────────────────────────────

/**
 * Discovery mode: open the page, run the initial search, save HTML/screenshots
 * to backend/scrape-debug/ so you can inspect filters and results.
 */
async function discover(): Promise<void> {
  console.log("Discovery mode: opening browser (visible). Output →", DISCOVER_OUTPUT_DIR);
  if (!fs.existsSync(DISCOVER_OUTPUT_DIR)) fs.mkdirSync(DISCOVER_OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  try {
    const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
    const page = await context.newPage();

    await page.goto(EVAL_BASE_URL, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(2000);
    fs.writeFileSync(path.join(DISCOVER_OUTPUT_DIR, "page.html"), await page.content(), "utf-8");

    for (const prefix of SEARCH_COURSE_PREFIXES) {
      console.log(`  Search prefix "${prefix}"…`);
      await runSearchWithPrefix(page, prefix);

      for (const year of TARGET_YEARS) {
        console.log(`    Year filter "${year}"…`);
        await applyYearFilter(page, year);

        const visibleRows = await parseResultsList(page);
        console.log(`    ${visibleRows.length} visible rows.`);

        if (visibleRows.length > 0) {
          const first = visibleRows[0];
          const metrics = await scrapeReportForItem(page, first.itemIndex, {
            keepOpenMs: 8000,
            debugLabel: `${prefix.replace(/\./g, "")}-${year}-item-${first.itemIndex}`,
          });
          console.log(`    First report: ${metrics ? getMetricCount(metrics) : 0} metric(s).`);
        }

        const more = page.locator("a#publicMore");
        if (await more.isVisible().catch(() => false)) {
          await more.click();
          await page.waitForTimeout(2000);
        }
      }

      const safeName = prefix.replace(/\./g, "");
      fs.writeFileSync(path.join(DISCOVER_OUTPUT_DIR, `results-${safeName}.html`), await page.content(), "utf-8");
      await page.screenshot({ path: path.join(DISCOVER_OUTPUT_DIR, `results-${safeName}.png`), fullPage: true });

      await page.goto(EVAL_BASE_URL, { waitUntil: "load", timeout: 20000 });
      await page.waitForTimeout(1000);
    }

    await context.close();
  } finally {
    await browser.close();
  }
}

/**
 * 1. Launch browser, navigate to EVAL_BASE_URL
 * 2. For each prefix/year: get course list, open each report, extract metrics
 * 3. Upsert into course_evaluations keyed by (course_code, semester, instructor).
 */
async function scrape(): Promise<void> {
  console.log(`Scraping course evaluations from ${EVAL_BASE_URL}${isDryRun() ? " (dry run — no DB writes)" : ""}…`);

  if (!isDryRun()) {
    await pool.query("SELECT 1").catch((err) => {
      console.error("DB connection failed:", err.message);
      process.exit(1);
    });
    console.log("  DB connection OK.");
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);
    const page = await context.newPage();
    await page.goto(EVAL_BASE_URL, { waitUntil: "load", timeout: 20000 });

    let totalInserted = 0;
    let totalWithMetrics = 0;
    const permanentlyFailed: ScrapedEvalRow[] = [];

    for (const prefix of SEARCH_COURSE_PREFIXES) {
      console.log(`  Search prefix "${prefix}"…`);
      await runSearchWithPrefix(page, prefix);

      for (const year of TARGET_YEARS) {
        console.log(`    Year filter "${year}"…`);
        await applyYearFilter(page, year);
        await expandAllResults(page);

        const allRows = await parseResultsList(page);
        const rows = allRows.filter((r) => r.semester.includes(year));
        console.log(`    ${rows.length}/${allRows.length} rows for year ${year}.`);

        const popupMutex = new Mutex();
        const failedRows: ScrapedEvalRow[] = [];

        const processRow = async (r: ScrapedEvalRow, label?: string): Promise<boolean> => {
          const metrics = await scrapeReportForItem(page, r.itemIndex, { debugLabel: r.course_code, popupMutex });
          if (!metrics) return false;
          const filled = getMetricCount(metrics);
          if (isDryRun()) {
            const tag = label ?? "dry-run";
            console.log(
              `      [${tag}] ${r.course_code} | ${r.semester} | ${r.instructor ?? "no instructor"}` +
              ` | response_rate=${r.response_rate ?? "null"} | metrics=${filled}/6` +
              (filled > 0 ? ` (${Object.entries(metrics).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${v}`).join(", ")})` : " (none — skipping DB write)"),
            );
          } else {
            if (label) console.log(`      [${label}] ${r.course_code} | ${r.semester} | ${r.instructor ?? "no instructor"} | metrics=${filled}/6`);
            if (filled > 0) {
              await upsertEvalRow(r, metrics);
              totalInserted++;
            }
          }
          if (filled > 0) totalWithMetrics++;
          return filled > 0;
        };

        await withConcurrency(rows, 4, async (r) => {
          const ok = await processRow(r, isDryRun() ? "dry-run" : undefined);
          if (!ok) failedRows.push(r);
        });

        if (failedRows.length > 0) {
          console.log(`    Retrying ${failedRows.length} rows with 0/6 metrics…`);
          const stillFailed: ScrapedEvalRow[] = [];
          await withConcurrency(failedRows, 2, async (r) => {
            const ok = await processRow(r, isDryRun() ? "retry" : undefined);
            if (!ok) stillFailed.push(r);
          });
          permanentlyFailed.push(...stillFailed);
        }
      }

      await page.goto(EVAL_BASE_URL, { waitUntil: "load", timeout: 20000 });
      await page.waitForTimeout(1000);
    }

    console.log(`Inserted ${totalInserted} new rows; ${totalWithMetrics} with metrics.`);

    if (permanentlyFailed.length > 0) {
      const failedLogPath = path.join(process.cwd(), "scrape-failed.json");
      fs.writeFileSync(failedLogPath, JSON.stringify(permanentlyFailed, null, 2), "utf-8");
      console.warn(`  ${permanentlyFailed.length} rows permanently failed (0/6 metrics after retry). Written to ${failedLogPath}`);
    }

    await context.close();
  } finally {
    await browser.close();
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (isDiscoverMode()) {
    await discover();
    return;
  }
  await scrape();
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});
