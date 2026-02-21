import { searchWeb, fetchPage } from "../lib/scraper";
import { analyze } from "../lib/openai";
import { log } from "../lib/logger";

export interface MarketResearchInput {
  industry: string;
  question?: string;
  location?: string;
}

export async function conductMarketResearch(
  input: MarketResearchInput
): Promise<string> {
  const { industry, question, location } = input;
  await log("info", "Starting market research", { industry, question });

  const locationStr = location ? ` ${location}` : "";

  // Step 1: Search for industry data
  const queries = [
    `${industry} market size trends 2025 2026`,
    `${industry}${locationStr} industry report`,
    `${industry} growth opportunities challenges`,
  ];

  if (question) {
    queries.push(`${industry} ${question}`);
  }

  const allResults: { title: string; url: string; snippet: string }[] = [];
  for (const q of queries) {
    const results = await searchWeb(q, 5);
    allResults.push(...results);
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = allResults.filter((r) => {
    try {
      const domain = new URL(r.url).hostname;
      if (seen.has(domain)) return false;
      seen.add(domain);
      return true;
    } catch {
      return false;
    }
  });

  // Step 2: Fetch top sources (limit to 5 for speed)
  const pages = await Promise.all(
    unique.slice(0, 5).map(async (r) => {
      const page = await fetchPage(r.url).catch(() => null);
      return page
        ? {
            source: new URL(r.url).hostname,
            title: r.title,
            snippet: r.snippet,
            content: page.textContent.slice(0, 2000),
          }
        : null;
    })
  );

  const validPages = pages.filter(Boolean);

  // Step 3: Generate research report
  const report = await analyze(
    `You are a market research analyst. Synthesize the available data into an actionable market research report.
Structure:
1. **Market Overview** — Size, growth rate, key players (cite specific numbers when found)
2. **Trends & Opportunities** — What's growing, emerging niches, technology shifts
3. **Challenges & Threats** — Market barriers, competition, regulatory issues
4. **Target Customer Segments** — Who buys, demographics, buying behavior
5. **Competitive Landscape** — Major players, market share insights, differentiation strategies
${question ? `6. **Specific Analysis: ${question}**` : ""}
7. **Strategic Recommendations** — 3-5 actionable recommendations for entering or growing in this market

Be data-driven. Cite specific statistics, percentages, and dollar amounts when available in the source material.
Clearly distinguish between verified data and estimates/projections.
If data is limited, state confidence levels honestly.`,
    `Industry: ${industry}
${location ? `Location: ${location}` : ""}
${question ? `Specific question: ${question}` : ""}

Search Results:
${unique.map((r) => `- ${r.title}: ${r.snippet}`).join("\n")}

Source Content:
${validPages.map((p) => `\n--- ${p!.source} ---\n${p!.content}`).join("\n")}`,
    3000
  );

  await log("info", "Market research complete", { industry });

  return report;
}
