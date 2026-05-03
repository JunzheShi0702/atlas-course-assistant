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
      .sort((a, b) => {
        if (!a.publishedDate && !b.publishedDate) return 0;
        if (!a.publishedDate) return 1;
        if (!b.publishedDate) return -1;
        return b.publishedDate.localeCompare(a.publishedDate);
      });
    return { found: true, query, threads };
  } catch {
    return { found: false, message: "Reddit search unavailable." };
  }
}
