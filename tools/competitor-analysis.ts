import { searchWeb, fetchPage } from "../lib/scraper";
import { analyze } from "../lib/openai";
import { log } from "../lib/logger";

export interface CompetitorAnalysisInput {
  business_name: string;
  industry: string;
  location?: string;
  website_url?: string;
}

export async function analyzeCompetitors(
  input: CompetitorAnalysisInput
): Promise<string> {
  const { business_name, industry, location, website_url } = input;
  await log("info", "Starting competitor analysis", { business_name, industry });

  // Step 1: Search for competitors
  const locationStr = location ? ` ${location}` : "";
  const queries = [
    `${industry} companies${locationStr} competitors`,
    `top ${industry} businesses${locationStr}`,
    `${business_name} competitors ${industry}`,
  ];

  const allResults: { title: string; url: string; snippet: string }[] = [];
  for (const q of queries) {
    const results = await searchWeb(q, 5);
    allResults.push(...results);
  }

  // Deduplicate by URL domain
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

  // Step 2: Fetch top competitor pages (limit to 5 to keep fast)
  const pagesToFetch = unique.slice(0, 5);
  const pages = await Promise.all(
    pagesToFetch.map((r) => fetchPage(r.url).catch(() => null))
  );

  // Step 3: If we have the user's website, analyze it too
  let ownPage = null;
  if (website_url) {
    ownPage = await fetchPage(website_url).catch(() => null);
  }

  // Step 4: Use OpenAI to analyze
  const competitorData = pages
    .filter(Boolean)
    .map((p) => ({
      url: p!.url,
      title: p!.title,
      description: p!.description,
      h1: p!.h1.slice(0, 3),
      hasSSL: p!.hasSSL,
      loadTimeMs: p!.loadTimeMs,
      textPreview: p!.textContent.slice(0, 500),
    }));

  const searchContext = unique
    .slice(0, 10)
    .map((r) => `- ${r.title}: ${r.snippet}`)
    .join("\n");

  const report = await analyze(
    `You are a competitive intelligence analyst. Analyze the competitive landscape for a business.
Provide actionable insights, not generic advice. Be specific about what each competitor does well and poorly.
Structure your response with clear sections: Executive Summary, Key Competitors, Competitive Advantages/Gaps, Strategic Recommendations.`,
    `Business: ${business_name}
Industry: ${industry}
${location ? `Location: ${location}` : ""}
${ownPage ? `\nOwn Website (${website_url}):\n- Title: ${ownPage.title}\n- Description: ${ownPage.description}\n- Load time: ${ownPage.loadTimeMs}ms\n- SSL: ${ownPage.hasSSL}\n- Text preview: ${ownPage.textContent.slice(0, 300)}` : ""}

Search Results:\n${searchContext}

Competitor Pages Analyzed:\n${JSON.stringify(competitorData, null, 2)}

Provide a detailed competitive analysis report.`,
    2500
  );

  await log("info", "Competitor analysis complete", {
    business_name,
    competitors_found: competitorData.length,
  });

  return report;
}
