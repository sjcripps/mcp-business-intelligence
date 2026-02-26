import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { validateApiKey, recordUsage, createApiKey, getKeyByEmail, upgradeKey, getKeyUsage, TIER_LIMITS, TIER_PRICES } from "./lib/auth";
import type { Tier } from "./lib/auth";
import { log } from "./lib/logger";
import { handleOAuthRoute, unauthorizedResponse, type OAuthConfig } from "./lib/oauth";
import { analyzeCompetitors } from "./tools/competitor-analysis";
import { conductIndustryResearch } from "./tools/industry-research";
import { conductSwotAnalysis } from "./tools/swot-analysis";
import { analyzeMarketTrends } from "./tools/market-trends";
// Pro/Business tier tools
import { buildCustomerPersona } from "./tools/customer-persona";
import { analyzePricing } from "./tools/pricing-analysis";
import { analyzeLocalMarket } from "./tools/local-market-analysis";
import { generateBusinessPlanSection } from "./tools/business-plan-section";

const PORT = parseInt(process.env.MCP_PORT || "4200");
const BASE_DIR = import.meta.dir;

// --- Page cache (load once at startup for performance) ---
const pageCache: Record<string, string> = {};
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function loadPage(name: string): Promise<string> {
  if (pageCache[name]) return pageCache[name];
  let content = await readFile(join(BASE_DIR, "pages", name), "utf-8");
  content = content.replace(/style\.css\?v=\d+/g, 'style.css?v=3');
  if (content.includes('</body>')) {
    content = content.replace('</body>', '<script src="/static/nav.js"></script>\n</body>');
  }
  pageCache[name] = content;
  return content;
}

async function serveStatic(pathname: string): Promise<Response | null> {
  // Only serve from /static/ or /.well-known/
  if (!pathname.startsWith("/static/") && !pathname.startsWith("/.well-known/")) return null;
  const filePath = pathname.startsWith("/.well-known/")
    ? join(BASE_DIR, "static", pathname)
    : join(BASE_DIR, pathname);
  try {
    const content = await readFile(filePath);
    const ext = pathname.substring(pathname.lastIndexOf("."));
    return new Response(content, {
      headers: {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return null;
  }
}

// --- MCP Server factory ---
function createMcpServer(tier: string = "free"): McpServer {
  const server = new McpServer({
    name: "ezbiz-business-intelligence",
    version: "1.0.0",
  });

  // Tool 1: Competitor Analysis
  server.tool(
    "analyze_competitors",
    "Analyze the competitive landscape for a business. Returns competitor profiles, market positioning, strengths/weaknesses, and strategic recommendations.",
    {
      business_name: z.string().describe("Name of the business to analyze (e.g., 'Acme Plumbing')"),
      industry: z
        .string()
        .describe("Industry or market sector (e.g., 'SaaS', 'local plumbing', 'e-commerce')"),
      location: z
        .string()
        .optional()
        .describe("Geographic location for local businesses (e.g., 'Austin, TX')"),
      website_url: z
        .string()
        .url()
        .optional()
        .describe("The business's website URL for comparison (e.g., 'https://example.com')"),
    },
    async (params) => {
      const result = await analyzeCompetitors({ ...params, tier });
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // Tool 2: Industry Research
  server.tool(
    "industry_research",
    "Research any industry in depth. Returns market size, growth trends, key players, customer segments, opportunities, challenges, and strategic recommendations.",
    {
      industry: z
        .string()
        .describe("The industry to research (e.g., 'residential HVAC', 'dental practices')"),
      location: z
        .string()
        .optional()
        .describe("Geographic focus area (e.g., 'Southeast US', 'Mississippi')"),
      focus_area: z
        .string()
        .optional()
        .describe("Specific research focus (e.g., 'market size', 'customer segments', 'growth drivers')"),
    },
    async (params) => {
      const result = await conductIndustryResearch({ ...params, tier });
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // Tool 3: SWOT Analysis
  server.tool(
    "swot_analysis",
    "Generate a comprehensive SWOT analysis for any business. Evaluates strengths, weaknesses, opportunities, and threats using real-time competitive data.",
    {
      business_name: z.string().describe("Name of the business to analyze (e.g., 'Acme Plumbing')"),
      industry: z
        .string()
        .describe("Industry category (e.g., 'residential plumbing')"),
      location: z
        .string()
        .optional()
        .describe("Business location for local competitive context"),
      website_url: z
        .string()
        .url()
        .optional()
        .describe("Business website URL for deeper analysis"),
    },
    async (params) => {
      const result = await conductSwotAnalysis({ ...params, tier });
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // Tool 4: Market Trends
  server.tool(
    "market_trends",
    "Track emerging market trends for any industry. Analyzes growth patterns, technology shifts, consumer behavior changes, and competitive dynamics.",
    {
      industry: z
        .string()
        .describe("The industry to track trends for (e.g., 'home services', 'dental technology')"),
      location: z
        .string()
        .optional()
        .describe("Geographic focus (e.g., 'United States', 'Southeast US')"),
      focus_area: z
        .string()
        .optional()
        .describe("Specific trend focus (e.g., 'technology adoption', 'pricing trends', 'consumer behavior')"),
    },
    async (params) => {
      const result = await analyzeMarketTrends({ ...params, tier });
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // --- Pro/Business tier tools (visible to all, gated on execution) ---
  const PRO_TIERS = ["pro", "business"];
  const upgradeMsg = (toolName: string) =>
    `🔒 ${toolName} requires a Pro or Business tier subscription.\n\nUpgrade at https://mcp.ezbizservices.com/pricing to unlock advanced tools including customer personas, pricing analysis, local market intelligence, and business plan generation.`;

  // Tool 5: Customer Persona Builder (Pro+)
  server.tool(
    "customer_persona",
    "🔒 [Pro] Build detailed customer personas with demographics, psychographics, buying behavior, and pain points. Uses real market data to create actionable buyer profiles.",
    {
      business_name: z.string().describe("Business name (e.g., 'Acme Plumbing')"),
      industry: z.string().describe("Industry (e.g., 'residential plumbing', 'SaaS')"),
      product_or_service: z.string().optional().describe("Specific product or service to build personas for"),
      location: z.string().optional().describe("Target market location"),
    },
    async (params) => {
      if (!PRO_TIERS.includes(tier)) {
        return { content: [{ type: "text" as const, text: upgradeMsg("Customer Persona Builder") }] };
      }
      const result = await buildCustomerPersona({ ...params, tier });
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // Tool 6: Pricing Analysis (Pro+)
  server.tool(
    "pricing_analysis",
    "🔒 [Pro] Analyze competitive pricing strategies. Compare market rates, identify pricing opportunities, and get data-backed pricing recommendations.",
    {
      industry: z.string().describe("Industry to analyze pricing for"),
      product_or_service: z.string().describe("Specific product or service to price"),
      location: z.string().optional().describe("Geographic market for pricing context"),
      current_price: z.string().optional().describe("Your current price point for comparison"),
    },
    async (params) => {
      if (!PRO_TIERS.includes(tier)) {
        return { content: [{ type: "text" as const, text: upgradeMsg("Pricing Analysis") }] };
      }
      const result = await analyzePricing({ ...params, tier });
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // Tool 7: Local Market Analysis (Pro+)
  server.tool(
    "local_market_analysis",
    "🔒 [Pro] Deep local market intelligence. Analyzes competition density, demographics, demand indicators, and growth opportunities in a specific geographic area.",
    {
      industry: z.string().describe("Industry to analyze (e.g., 'dental practices', 'HVAC')"),
      city: z.string().describe("City name (e.g., 'Austin')"),
      state: z.string().describe("State (e.g., 'TX')"),
      radius_miles: z.number().optional().describe("Analysis radius in miles (default: 25)"),
    },
    async (params) => {
      if (!PRO_TIERS.includes(tier)) {
        return { content: [{ type: "text" as const, text: upgradeMsg("Local Market Analysis") }] };
      }
      const result = await analyzeLocalMarket({ ...params, tier });
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // Tool 8: Business Plan Section Generator (Business only)
  server.tool(
    "business_plan_section",
    "🔒 [Business] Generate professional business plan sections with real market data. Covers executive summary, market analysis, financial projections, operations, and more.",
    {
      business_name: z.string().describe("Business name"),
      industry: z.string().describe("Industry"),
      section: z.string().describe("Section to generate (e.g., 'executive_summary', 'market_analysis', 'financial_projections', 'operations', 'marketing_strategy')"),
      context: z.string().optional().describe("Additional context about the business for more tailored output"),
    },
    async (params) => {
      if (tier !== "business") {
        return { content: [{ type: "text" as const, text: `🔒 Business Plan Section Generator requires a Business tier subscription.\n\nUpgrade at https://mcp.ezbizservices.com/pricing to unlock business plan generation and all other advanced tools.` }] };
      }
      const result = await generateBusinessPlanSection({ ...params, tier });
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  return server;
}

// Export for Smithery tool scanning (no real credentials needed)
export function createSandboxServer() {
  return createMcpServer();
}

// --- Session management ---
const transports: Record<
  string,
  { transport: WebStandardStreamableHTTPServerTransport; apiKey: string }
> = {};

// --- Stdio transport for MCP inspectors (Glama, CLI clients) ---
if (process.argv.includes("--stdio")) {
  const server = createMcpServer("free");
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
// --- Bun HTTP server (guarded for Smithery scanner compatibility) ---
else if (typeof Bun !== "undefined" && !process.env.SMITHERY_SCAN) Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return Response.json({
        status: "ok",
        server: "ezbiz-business-intelligence",
        version: "1.0.0",
        uptime: process.uptime(),
        activeSessions: Object.keys(transports).length,
      });
    }

    // CORS headers for storefront
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key, X-Admin-Secret, Mcp-Session-Id, Accept",
      "Access-Control-Expose-Headers": "Mcp-Session-Id",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // --- OAuth 2.0 + PKCE for MCP clients (Claude, etc.) ---
    const oauthConfig: OAuthConfig = {
      issuerUrl: "https://mcp.ezbizservices.com",
      serverName: "EzBiz Business Intelligence",
      validateKey: validateApiKey,
      corsHeaders,
    };
    const oauthResponse = await handleOAuthRoute(req, url, oauthConfig);
    if (oauthResponse) return oauthResponse;

    const ADMIN_SECRET = process.env.ADMIN_SECRET;
    if (!ADMIN_SECRET) {
      console.error("WARNING: ADMIN_SECRET not set in environment. Admin endpoints disabled.");
    }

    // --- API Key Management Endpoints ---

    // POST /api/keys/signup — Free tier signup (public)
    if (url.pathname === "/api/keys/signup" && req.method === "POST") {
      try {
        const body = await req.json();
        const { name, email } = body;
        if (!email || !name) {
          return Response.json({ error: "name and email required" }, { status: 400, headers: corsHeaders });
        }
        // Check if email already has a key — return it (same security model as signup)
        const existing = await getKeyByEmail(email);
        if (existing) {
          const month = new Date().toISOString().slice(0, 7);
          const used = existing.data.usage[month] || 0;
          const limit = TIER_LIMITS[existing.data.tier] || 10;
          return Response.json({
            key: existing.key,
            tier: existing.data.tier,
            limit,
            used,
            recovered: true,
          }, { headers: corsHeaders });
        }
        const key = await createApiKey(name, "free", email);
        await log("info", `New free signup: ${email}`, { name });
        return Response.json({ key, tier: "free", limit: TIER_LIMITS.free }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // POST /api/keys/provision — Create paid key (admin only, called by webhook)
    if (url.pathname === "/api/keys/provision" && req.method === "POST") {
      const adminSecret = req.headers.get("x-admin-secret");
      if (adminSecret !== ADMIN_SECRET) {
        return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
      }
      try {
        const body = await req.json();
        const { name, email, tier } = body;
        if (!email || !tier) {
          return Response.json({ error: "email and tier required" }, { status: 400, headers: corsHeaders });
        }
        // Try to upgrade existing key first
        const existing = await getKeyByEmail(email);
        if (existing) {
          await upgradeKey(email, tier as Tier);
          await log("info", `Upgraded ${email} to ${tier}`, { name });
          return Response.json({
            key: existing.key,
            tier,
            limit: TIER_LIMITS[tier],
            upgraded: true,
          }, { headers: corsHeaders });
        }
        // New key
        const key = await createApiKey(name || email, tier as Tier, email);
        await log("info", `Provisioned ${tier} key for ${email}`, { name });
        return Response.json({ key, tier, limit: TIER_LIMITS[tier], upgraded: false }, { headers: corsHeaders });
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
      }
    }

    // GET /api/keys/usage?key=sk_biz_... — Check usage (public, key as auth)
    if (url.pathname === "/api/keys/usage" && req.method === "GET") {
      const key = url.searchParams.get("key") || req.headers.get("x-api-key");
      if (!key) {
        return Response.json({ error: "key required" }, { status: 400, headers: corsHeaders });
      }
      const usage = await getKeyUsage(key);
      if (!usage) {
        return Response.json({ error: "Invalid key" }, { status: 404, headers: corsHeaders });
      }
      return Response.json(usage, { headers: corsHeaders });
    }

    // GET /api/pricing — Public pricing info
    if (url.pathname === "/api/pricing") {
      return Response.json({
        tiers: Object.entries(TIER_LIMITS).map(([tier, limit]) => ({
          tier,
          price: TIER_PRICES[tier],
          requestsPerMonth: limit,
        })),
      }, { headers: corsHeaders });
    }

    // MCP endpoint — accept on /mcp and also on / for POST (Smithery/scanners)
    if (url.pathname === "/mcp" || (url.pathname === "/" && req.method === "POST")) {
      const sessionId = req.headers.get("mcp-session-id");

      // --- GET/DELETE: session-based operations (SSE stream / session close) ---
      // These are part of the MCP Streamable HTTP protocol. The session was already
      // authenticated during the initial POST, so no re-auth is needed here.
      if (req.method === "GET") {
        if (sessionId && transports[sessionId]) {
          console.log(`[MCP] GET SSE stream | session: ${sessionId}`);
          return transports[sessionId].transport.handleRequest(req);
        }
        return Response.json(
          { jsonrpc: "2.0", error: { code: -32000, message: "Bad request: GET requires a valid mcp-session-id. Start with POST." }, id: null },
          { status: 400, headers: corsHeaders }
        );
      }

      if (req.method === "DELETE") {
        if (sessionId && transports[sessionId]) {
          console.log(`[MCP] DELETE session | session: ${sessionId}`);
          return transports[sessionId].transport.handleRequest(req);
        }
        return Response.json(
          { jsonrpc: "2.0", error: { code: -32000, message: "Session not found" }, id: null },
          { status: 404, headers: corsHeaders }
        );
      }

      // --- POST: API key auth (accept from multiple sources for proxy compatibility) ---
      const bearerToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      const apiKey =
        req.headers.get("x-api-key") ||
        req.headers.get("apikey") ||
        url.searchParams.get("api_key") ||
        url.searchParams.get("apiKey") ||
        url.searchParams.get("apikey") ||
        bearerToken;

      // Debug logging — include query params to diagnose proxy issues
      const qp = url.search || "none";
      console.log(`[MCP] POST ${url.pathname} | auth: ${bearerToken ? "Bearer " + bearerToken.slice(0, 12) + "..." : "none"} | x-api-key: ${req.headers.get("x-api-key") ? "yes" : "no"} | apikey-hdr: ${req.headers.get("apikey") ? "yes" : "no"} | query: ${qp} | session: ${sessionId || "none"} | accept: ${req.headers.get("accept") || "none"}`);

      // Auth required on ALL MCP requests (including initialize).
      // OAuth-capable clients (Smithery, Claude Desktop) will get 401 + WWW-Authenticate
      // and trigger the OAuth 2.0 + PKCE flow automatically.
      // Scanners use /.well-known/mcp/server-card.json for tool discovery instead.
      const authResult = await validateApiKey(apiKey);

      if (!authResult.valid) {
        console.log(`[MCP] AUTH FAILED: ${authResult.error} | key: ${apiKey ? apiKey.slice(0, 12) + "..." : "null"}`);
        return new Response(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32001, message: authResult.error },
            id: null,
          }), {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              ...corsHeaders,
            },
          }
        );
      }

      // Check for existing session (POST with session ID)

      if (sessionId && transports[sessionId]) {
        // Existing session — pass through to its transport
        const { transport } = transports[sessionId];

        // Record usage for tool calls and block unauthenticated tool calls
        if (req.method === "POST") {
          try {
            const cloned = req.clone();
            const body = await cloned.json();
            if (body?.method === "tools/call") {
              if (!apiKey) {
                return Response.json(
                  { jsonrpc: "2.0", error: { code: -32001, message: "API key required for tool calls. Get a free key at https://mcp.ezbizservices.com" }, id: body?.id || null },
                  { status: 401 }
                );
              }
              await recordUsage(apiKey);
            }
          } catch {}
        }

        return transport.handleRequest(req);
      }

      // New session — only allow POST with initialize
      if (req.method === "POST") {
        try {
          const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (sid: string) => {
              transports[sid] = { transport, apiKey: apiKey || "" };
              log("info", `New MCP session: ${sid}`, {
                tier: authResult.tier,
                name: authResult.name,
              });
            },
            onsessionclosed: (sid: string) => {
              delete transports[sid];
              log("info", `Session closed: ${sid}`);
            },
            enableJsonResponse: true,
          });

          const mcpServer = createMcpServer(authResult.tier || "free");
          await mcpServer.connect(transport);

          // Record init usage
          if (apiKey) await recordUsage(apiKey);

          return transport.handleRequest(req);
        } catch (err: any) {
          await log("error", `MCP init error: ${err.message}`, {
            stack: err.stack,
          });
          return Response.json(
            {
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal server error" },
              id: null,
            },
            { status: 500 }
          );
        }
      }

      return Response.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad request: send a POST with initialize to start a session.",
          },
          id: null,
        },
        { status: 400 }
      );
    }

    // --- Static files ---
    // Serve sitemap and robots from static dir
    if (url.pathname === "/sitemap.xml" || url.pathname === "/robots.txt") {
      const staticRes = await serveStatic("/static" + url.pathname);
      if (staticRes) return staticRes;
    }

    if (url.pathname.startsWith("/static/") || url.pathname.startsWith("/.well-known/")) {
      const staticRes = await serveStatic(url.pathname);
      if (staticRes) return staticRes;
    }

    // --- Short-URL redirects (underscore/slug variants → canonical tool pages) ---
    const REDIRECTS: Record<string, string> = {
      "/competitor_analysis": "/tools/analyze-competitors",
      "/competitor-analysis": "/tools/analyze-competitors",
      "/analyze_competitors": "/tools/analyze-competitors",
      "/analyze-competitors": "/tools/analyze-competitors",
      "/analyze": "/tools",
      "/industry_research": "/tools/industry-research",
      "/industry-research": "/tools/industry-research",
      "/swot_analysis": "/tools/swot-analysis",
      "/swot-analysis": "/tools/swot-analysis",
      "/market_trends": "/tools/market-trends",
      "/market-trends": "/tools/market-trends",
      // Legacy redirects for old tools
      "/web_presence": "/tools/score-web-presence",
      "/web-presence": "/tools/score-web-presence",
      "/score_web_presence": "/tools/score-web-presence",
      "/score-web-presence": "/tools/score-web-presence",
      "/review_analysis": "/tools/analyze-reviews",
      "/review-analysis": "/tools/analyze-reviews",
      "/analyze_reviews": "/tools/analyze-reviews",
      "/analyze-reviews": "/tools/analyze-reviews",
      "/reviews": "/tools/analyze-reviews",
      "/market_research": "/tools/market-research",
      "/market-research": "/tools/market-research",
    };

    const redirectTarget = REDIRECTS[url.pathname];
    if (redirectTarget) {
      return new Response(null, {
        status: 301,
        headers: { Location: redirectTarget },
      });
    }

    // --- Pages ---
    const PAGE_ROUTES: Record<string, string> = {
      "/": "index.html",
      "/docs": "docs.html",
      "/signup": "signup.html",
      "/pricing": "pricing.html",
      "/tools": "tools/index.html",
      "/tools/": "tools/index.html",
      "/tools/analyze-competitors": "tools/analyze-competitors.html",
      "/tools/competitor-analysis": "tools/competitor-analysis.html",
      "/tools/industry-research": "tools/industry-research.html",
      "/tools/swot-analysis": "tools/swot-analysis.html",
      "/tools/market-trends": "tools/market-trends.html",
      // Legacy tool pages (keep for SEO/backlinks)
      "/tools/score-web-presence": "tools/score-web-presence.html",
      "/tools/web-presence-scoring": "tools/web-presence-scoring.html",
      "/tools/analyze-reviews": "tools/analyze-reviews.html",
      "/tools/review-analysis": "tools/review-analysis.html",
      "/tools/market-research": "tools/market-research.html",
    };

    // Check static page routes first
    const pageName = PAGE_ROUTES[url.pathname];
    if (pageName) {
      try {
        const html = await loadPage(pageName);
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      } catch (err: any) {
        await log("error", `Page load error: ${pageName} - ${err.message}`);
        return new Response("Page not found", { status: 500 });
      }
    }

    // Dynamic blog routes: /blog → index, /blog/[slug] → blog post
    if (url.pathname === "/blog" || url.pathname === "/blog/") {
      try {
        const html = await loadPage("blog/index.html");
        return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
      } catch (err: any) {
        await log("error", `Blog index error: ${err.message}`);
        return new Response("Blog not found", { status: 404 });
      }
    }

    if (url.pathname.startsWith("/blog/")) {
      const slug = url.pathname.replace("/blog/", "");
      if (slug && /^[a-z0-9-]+$/.test(slug)) {
        try {
          const html = await loadPage(`blog/${slug}.html`);
          return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
        } catch (err: any) {
          return new Response("Post not found", { status: 404 });
        }
      }
    }

    return new Response("Not found", { status: 404 });
  },
});

if (typeof Bun !== "undefined" && !process.env.SMITHERY_SCAN && !process.argv.includes("--stdio")) console.log(`MCP Business Intelligence server running on port ${PORT}`);

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  for (const sid in transports) {
    try {
      await transports[sid].transport.close();
    } catch {}
    delete transports[sid];
  }
  process.exit(0);
});
