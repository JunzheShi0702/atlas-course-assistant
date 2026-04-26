import { Profanity } from "@2toad/profanity";
import leoProfanity from "leo-profanity";

/**
 * Source-safety phrase blocklist used to sanitize low-quality/inappropriate
 * excerpts from external sources (e.g. Reddit/RMP).
 *
 * Keep patterns tightly scoped to appearance-focused, sexualized, or clearly
 * non-academic phrasing so we do not over-filter legitimate feedback.
 */
export const SOURCE_SAFETY_BLOCKLIST: RegExp[] = [
  // Appearance-focused slang (including common typos)
  /\bsilver[\s-]?fox\b/i,
  /\bsliver[\s-]?fox\b/i,
  /\bsilvr[\s-]?fox\b/i,
  /\blow[\s-]?key\b/i,
  /\bhigh[\s-]?key\b/i,

  // Sexualized / flirt-oriented terms
  /\b(sexy|hot|hottie|thirsty|smash|horny|seggs(y)?)\b/i,
  /\b(daddy|mommy|milf|dilf|baddie|bae)\b/i,
  /\b(he'?s|she'?s|they'?re)\s+(so\s+)?(fine|hot|sexy)\b/i,
  /\b(i('| a)m|we('| a)re)\s+(in love with|obsessed with)\b/i,

  // Body/objectifying phrases
  /\b(thicc|thiccc|snacc|snack)\b/i,
  /\b(eye candy|smoke show|piece of ass)\b/i,

  // Explicit/harassing language
  /\b(catcall|creep(ing|y)?|stalk(er|ing)?)\b/i,
  /\b(nudes?|onlyfans)\b/i,
];

const profanityFilter = new Profanity();
leoProfanity.loadDictionary();

function containsPackageProfanity(text: string): boolean {
  if (!text) return false;
  const badWordsHit = profanityFilter.exists(text);
  const leoHit = leoProfanity.check(text);
  return badWordsHit || leoHit;
}

export function containsInappropriateSourceText(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  return (
    containsPackageProfanity(value) ||
    SOURCE_SAFETY_BLOCKLIST.some((pattern) => pattern.test(value))
  );
}
