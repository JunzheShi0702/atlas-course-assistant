const TAVILY_URL = "https://api.tavily.com/search";
const TIMEOUT_MS = 8_000;

export interface TavilyResult {
  title: string;
  url: string;
  content?: string;
  published_date?: string;
}

export interface RedditThread {
  title: string;
  url: string;
  snippet: string;
  subreddit?: string;
  publishedDate?: string;
}

export interface RedditSearchResult {
  found: true;
  query: string;
  threads: RedditThread[];
}

export interface RedditNoResult {
  found: false;
  message: string;
}

export type RedditResult = RedditSearchResult | RedditNoResult;

export function mapTavilyResult(raw: TavilyResult): RedditThread {
  const content = raw.content ?? "";
  const snippet =
    content.length > 300 ? content.slice(0, 300) + "..." : content;
  const subredditMatch = raw.url.match(/reddit\.com\/r\/([^/]+)/);
  const subreddit = subredditMatch ? `r/${subredditMatch[1]}` : undefined;
  return { title: raw.title, url: raw.url, snippet, subreddit, publishedDate: raw.published_date };
}

/**
 * Filter Reddit threads for relevance to a professor search.
 * Excludes threads mentioning other institutions or unrelated professors.
 */
function isRelevantProfessorThread(thread: RedditThread, query: string): boolean {
  const originalText = `${thread.title} ${thread.snippet}`;
  const searchText = originalText.toLowerCase();
  const inJhuSubreddit = (thread.subreddit || "").toLowerCase() === "r/jhu";

  // Extract professor last name from query (assumes format "Professor [FirstName] [LastName]" or just "[LastName]")
  const queryLower = query.toLowerCase();
  const profNameMatch = queryLower.match(/(?:professor\s+)?(\w+)(?:\s+(\w+))?/);
  const lastName = profNameMatch ? profNameMatch[profNameMatch.length - 1] : "";

  if (!lastName || lastName.length < 3) {
    return true; // If we can't extract a name, don't filter aggressively
  }

  // Check if the thread mentions the professor's last name.
  // To avoid matching common words (e.g., "more"), prefer a capitalized
  // appearance in the original text (likely a proper name). Fall back to
  // a case-insensitive match only if the last name is uncommon (length>4).
  let mentionsProfessor = false;
  try {
    const capitalized = `${lastName[0].toUpperCase()}${lastName.slice(1)}`;
    // Contextual patterns that indicate the last name is used as a person name
    const contextPatterns = [
      // "Professor More", "Prof. More", "Dr. More"
      `\\b(?:professor|prof\\.|dr\\.)\\s+${capitalized}\\b`,
      // "More, Sara" or "More, S."
      `\\b${capitalized}\\s*,\\s*[A-Z]` ,
      // "Sara More" (first name before last name)
      `\\b[A-Z][a-z]+\\s+${capitalized}\\b`,
      // "More (Professor)" or "More (EN.601.226)"
      `\\b${capitalized}\\s*\\(`,
      // "More teaches", "More taught"
      `\\b${capitalized}\\s+(?:teaches|taught|teaching|is|was|teaches|professor|lecturer)\\b`,
    ];

    let contextMatched = false;
    for (const pat of contextPatterns) {
      if (new RegExp(pat, "i").test(originalText)) {
        mentionsProfessor = true;
        contextMatched = true;
        break;
      }
    }

    // If no contextual hit, allow a plain capitalized occurrence for longer/less-ambiguous names
    if (!mentionsProfessor) {
      const plainCapitalized = new RegExp(`\\b${capitalized}\\b`).test(originalText);
      if (plainCapitalized) {
        // Only accept a plain capitalized hit if the thread mentions JHU, is in r/jhu,
        // or contains a professor indicator like "Prof" / "Professor".
        const mentionsJhu = /jhu|johns\s*hopkins/i.test(originalText);
        const inJhuSubreddit = (thread.subreddit || "").toLowerCase() === "r/jhu";
        const hasProfToken = /\bprof(?:essor|\.)?\b/i.test(originalText);
        if (mentionsJhu || inJhuSubreddit || hasProfToken) {
          mentionsProfessor = true;
        }
      }
    }
  } catch {
    mentionsProfessor = new RegExp(`\\b${lastName}\\b`, "i").test(searchText);
  }
  if (!mentionsProfessor) {
    return false; // Thread doesn't mention the professor as a proper name
  }

  // Require subreddit to be r/jhu for professor-focused queries.
  // This avoids pulling in threads from other communities even if they
  // mention the professor's last name in passing.
  if (!inJhuSubreddit) {
    return false;
  }

  // Filter out threads from unrelated institutions
  const irrelevantInstitutions = [
    "MIT",
    "Stanford",
    "Harvard",
    "Yale",
    "Princeton",
    "UC Berkeley",
    "Caltech",
    "Cornell",
    "Stephen Hawking",
    "Saybrook",
    "Visiting Professor",
  ];
  for (const institution of irrelevantInstitutions) {
    if (
      new RegExp(`\\b${institution}\\b`, "i").test(searchText) &&
      !new RegExp(`jhu|johns\\s*hopkins`, "i").test(searchText)
    ) {
      return false;
    }
  }

  return true;
}


export async function searchRedditForCourse(
  query: string,
): Promise<RedditResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { found: false, message: "Reddit search unavailable." };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(TAVILY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: `${query} JHU`,
          max_results: 5,
          search_depth: "basic",
          include_domains: ["reddit.com"],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      return { found: false, message: "Reddit search unavailable." };
    }

    const json = (await response.json()) as { results?: TavilyResult[] };
    const results = json.results ?? [];

    if (!results.length) {
      return { found: false, message: "No Reddit threads found." };
    }

    const threads = results
      .filter((r) => !r.url.includes("?tl="))
      .slice(0, 5)
      .map(mapTavilyResult)
      .filter((thread) => isRelevantProfessorThread(thread, query))
      .sort((a, b) => {
        if (!a.publishedDate && !b.publishedDate) return 0;
        if (!a.publishedDate) return 1;
        if (!b.publishedDate) return -1;
        return b.publishedDate.localeCompare(a.publishedDate);
      });
    if (!threads.length) {
      return { found: false, message: "No relevant Reddit threads found." };
    }

    return { found: true, query, threads };
  } catch {
    return { found: false, message: "Reddit search unavailable." };
  }
}
