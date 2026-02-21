import { fetchPage, searchWeb } from "../lib/scraper";
import { analyzeJSON } from "../lib/openai";
import { log } from "../lib/logger";

export interface WebPresenceInput {
  url: string;
  business_name?: string;
}

interface ScoreBreakdown {
  overall_score: number;
  seo_score: number;
  performance_score: number;
  content_score: number;
  social_presence_score: number;
  trust_score: number;
  details: {
    seo: string[];
    performance: string[];
    content: string[];
    social: string[];
    trust: string[];
  };
  recommendations: string[];
}

export async function scoreWebPresence(
  input: WebPresenceInput
): Promise<string> {
  const { url, business_name } = input;
  await log("info", "Starting web presence scoring", { url });

  // Normalize URL
  let normalizedUrl = url;
  if (!normalizedUrl.startsWith("http")) {
    normalizedUrl = "https://" + normalizedUrl;
  }

  // Step 1: Fetch the main page
  const page = await fetchPage(normalizedUrl);

  // Step 2: Check for common pages
  const baseUrl = new URL(normalizedUrl).origin;
  const subpages = ["/about", "/contact", "/blog", "/sitemap.xml", "/robots.txt"];
  const subpageResults = await Promise.all(
    subpages.map(async (path) => {
      try {
        const resp = await fetch(baseUrl + path, {
          method: "HEAD",
          redirect: "follow",
          signal: AbortSignal.timeout(5000),
        });
        return { path, status: resp.status, exists: resp.ok };
      } catch {
        return { path, status: 0, exists: false };
      }
    })
  );

  // Step 3: Search for social presence
  let socialResults: { title: string; url: string; snippet: string }[] = [];
  if (business_name) {
    socialResults = await searchWeb(
      `"${business_name}" site:linkedin.com OR site:facebook.com OR site:twitter.com OR site:instagram.com`,
      5
    );
  }

  // Step 4: Analyze with OpenAI
  const analysisData = {
    url: normalizedUrl,
    page: {
      title: page.title,
      description: page.description,
      h1: page.h1,
      h2: page.h2.slice(0, 5),
      hasSSL: page.hasSSL,
      loadTimeMs: page.loadTimeMs,
      images: page.images,
      metaTags: page.metaTags,
      ogTags: page.ogTags,
      schemaOrg: page.schemaOrg.length > 0,
      textLength: page.textContent.length,
      error: page.error,
    },
    subpages: subpageResults,
    socialPresence: socialResults.map((r) => ({
      platform: new URL(r.url).hostname,
      url: r.url,
    })),
  };

  const rawScores = await analyzeJSON<Partial<ScoreBreakdown>>(
    `You are a web presence auditor. Score the following website data and return a JSON object.
Scoring criteria:
- seo_score (0-100): Title tag, meta description, H1s, schema.org, robots.txt, sitemap, OG tags
- performance_score (0-100): Load time (<1s=100, <2s=80, <3s=60, <5s=40, >5s=20), SSL, error-free
- content_score (0-100): Text content length, heading structure, images, blog presence, about/contact pages
- social_presence_score (0-100): Social media profiles found, consistency across platforms
- trust_score (0-100): SSL, contact page, about page, schema.org, professional appearance
- overall_score: Weighted average (SEO 25%, Performance 15%, Content 25%, Social 15%, Trust 20%)

For each category, provide 2-4 specific findings in the details arrays.
Provide 3-5 actionable recommendations sorted by impact.`,
    `Website data:\n${JSON.stringify(analysisData, null, 2)}`,
    2000
  );

  // Apply defaults for missing fields
  const scores: ScoreBreakdown = {
    overall_score: rawScores.overall_score ?? 0,
    seo_score: rawScores.seo_score ?? 0,
    performance_score: rawScores.performance_score ?? 0,
    content_score: rawScores.content_score ?? 0,
    social_presence_score: rawScores.social_presence_score ?? 0,
    trust_score: rawScores.trust_score ?? 0,
    details: {
      seo: rawScores.details?.seo ?? ["No data"],
      performance: rawScores.details?.performance ?? ["No data"],
      content: rawScores.details?.content ?? ["No data"],
      social: rawScores.details?.social ?? ["No data"],
      trust: rawScores.details?.trust ?? ["No data"],
    },
    recommendations: rawScores.recommendations ?? ["No recommendations available"],
  };

  // Format the response
  const report = `# Web Presence Score: ${scores.overall_score}/100

**URL:** ${normalizedUrl}
${business_name ? `**Business:** ${business_name}` : ""}

## Score Breakdown
- **SEO:** ${scores.seo_score}/100
- **Performance:** ${scores.performance_score}/100
- **Content:** ${scores.content_score}/100
- **Social Presence:** ${scores.social_presence_score}/100
- **Trust & Credibility:** ${scores.trust_score}/100

## Findings

### SEO
${scores.details.seo.map((d) => `- ${d}`).join("\n")}

### Performance
${scores.details.performance.map((d) => `- ${d}`).join("\n")}

### Content
${scores.details.content.map((d) => `- ${d}`).join("\n")}

### Social Presence
${scores.details.social.map((d) => `- ${d}`).join("\n")}

### Trust & Credibility
${scores.details.trust.map((d) => `- ${d}`).join("\n")}

## Top Recommendations
${scores.recommendations.map((r, i) => `${i + 1}. ${r}`).join("\n")}`;

  await log("info", "Web presence scoring complete", {
    url,
    score: scores.overall_score,
  });

  return report;
}
