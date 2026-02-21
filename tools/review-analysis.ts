import { searchWeb, fetchPage } from "../lib/scraper";
import { analyze } from "../lib/openai";
import { log } from "../lib/logger";

export interface ReviewAnalysisInput {
  business_name: string;
  location?: string;
  industry?: string;
}

export async function analyzeReviews(
  input: ReviewAnalysisInput
): Promise<string> {
  const { business_name, location, industry } = input;
  await log("info", "Starting review analysis", { business_name });

  const locationStr = location ? ` ${location}` : "";

  // Step 1: Search for reviews across platforms
  const queries = [
    `"${business_name}"${locationStr} reviews`,
    `"${business_name}" site:yelp.com OR site:trustpilot.com OR site:bbb.org`,
    `"${business_name}"${locationStr} customer experience`,
  ];

  const allResults: { title: string; url: string; snippet: string }[] = [];
  for (const q of queries) {
    const results = await searchWeb(q, 5);
    allResults.push(...results);
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = allResults.filter((r) => {
    if (seen.has(r.url)) return false;
    seen.add(r.url);
    return true;
  });

  // Step 2: Fetch review pages (limit to 5)
  const reviewPages = await Promise.all(
    unique.slice(0, 5).map(async (r) => {
      const page = await fetchPage(r.url).catch(() => null);
      return page
        ? {
            source: new URL(r.url).hostname,
            url: r.url,
            title: r.title,
            snippet: r.snippet,
            pageText: page.textContent.slice(0, 2000),
          }
        : null;
    })
  );

  const validPages = reviewPages.filter(Boolean);

  // Step 3: Analyze with OpenAI
  const report = await analyze(
    `You are a reputation and review analyst. Analyze the available review data for a business.
Even if direct review scores aren't available, analyze the search snippets and page content for sentiment signals.
Structure your response:
1. **Review Presence Summary** — Where the business appears in review searches
2. **Sentiment Analysis** — Overall sentiment from available data (positive/neutral/negative with estimated percentage)
3. **Key Themes** — What customers mention most (good and bad)
4. **Reputation Strengths** — What the business does well according to reviews
5. **Areas for Improvement** — Consistent complaints or gaps
6. **Competitive Position** — How their reviews compare to industry norms
7. **Recommendations** — 3-5 actionable steps to improve review presence and ratings

Be honest about data limitations. If data is sparse, say so and recommend how to improve review coverage.`,
    `Business: ${business_name}
${location ? `Location: ${location}` : ""}
${industry ? `Industry: ${industry}` : ""}

Search Results (${unique.length} found):
${unique.map((r) => `- [${r.title}](${r.url}): ${r.snippet}`).join("\n")}

Page Content Analysis:
${validPages.map((p) => `\n--- ${p!.source} (${p!.url}) ---\n${p!.pageText}`).join("\n")}`,
    2500
  );

  await log("info", "Review analysis complete", {
    business_name,
    sources_found: validPages.length,
  });

  return report;
}
