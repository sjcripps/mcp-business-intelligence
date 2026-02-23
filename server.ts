import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import { join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

import { validateApiKey, recordUsage, createApiKey, getKeyByEmail, upgradeKey, getKeyUsage, TIER_LIMITS, TIER_PRICES } from "./lib/auth";
import type { Tier } from "./lib/auth";
import { log } from "./lib/logger";
import { handleOAuthRoute, unauthorizedResponse, type OAuthConfig } from "./lib/oauth";
import { analyzeCompetitors } from "./tools/competitor-analysis";
import { scoreWebPresence } from "./tools/web-presence-score";
import { analyzeReviews } from "./tools/review-analysis";
import { conductMarketResearch } from "./tools/market-research";

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
  const content = await readFile(join(BASE_DIR, "pages", name), "utf-8");
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
function createMcpServer(): McpServer {
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
      const result = await analyzeCompetitors(params);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // Tool 2: Web Presence Score
  server.tool(
    "score_web_presence",
    "Score a website's online presence (0-100) across SEO, performance, content, social media, and trust signals. Returns detailed breakdown and actionable recommendations.",
    {
      url: z.string().describe("Website URL to analyze (e.g., 'https://example.com')"),
      business_name: z
        .string()
        .optional()
        .describe("Business name to check social media presence and brand mentions"),
    },
    async (params) => {
      const result = await scoreWebPresence(params);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // Tool 3: Review Analysis
  server.tool(
    "analyze_reviews",
    "Analyze a business's online reviews and reputation. Returns sentiment analysis, key themes, strengths, weaknesses, and recommendations for review management.",
    {
      business_name: z.string().describe("Business name to search reviews for"),
      location: z
        .string()
        .optional()
        .describe("Business location for local search (e.g., 'Seattle, WA')"),
      industry: z
        .string()
        .optional()
        .describe("Industry context for comparison (e.g., 'restaurant', 'dentist')"),
    },
    async (params) => {
      const result = await analyzeReviews(params);
      return { content: [{ type: "text" as const, text: result }] };
    }
  );

  // Tool 4: Market Research
  server.tool(
    "market_research",
    "Conduct market research on an industry. Returns market size, trends, opportunities, challenges, customer segments, competitive landscape, and strategic recommendations.",
    {
      industry: z
        .string()
        .describe("Industry or market to research (e.g., 'telemedicine', 'EV charging')"),
      question: z
        .string()
        .optional()
        .describe("Specific question to answer (e.g., 'What is the TAM for residential solar in Texas?')"),
      location: z
        .string()
        .optional()
        .describe("Geographic focus for the research"),
    },
    async (params) => {
      const result = await conductMarketResearch(params);
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

// --- Bun HTTP server (guarded for Smithery scanner compatibility) ---
if (typeof Bun !== "undefined" && !process.env.SMITHERY_SCAN) Bun.serve({
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
      // --- API key auth (accept from multiple sources for proxy compatibility) ---
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
      console.log(`[MCP] ${req.method} ${url.pathname} | auth: ${bearerToken ? "Bearer " + bearerToken.slice(0, 12) + "..." : "none"} | x-api-key: ${req.headers.get("x-api-key") ? "yes" : "no"} | apikey-hdr: ${req.headers.get("apikey") ? "yes" : "no"} | query: ${qp} | session: ${req.headers.get("mcp-session-id") || "none"} | accept: ${req.headers.get("accept") || "none"}`);

      // Allow unauthenticated access for discovery methods (initialize, tools/list)
      // so directory scanners (Smithery, etc.) can inspect capabilities.
      // Auth is still enforced for tools/call (see usage recording below).
      let authResult: { valid: boolean; error?: string; tier?: string; name?: string } = { valid: false };
      let isDiscoveryRequest = false;

      if (req.method === "POST" && !apiKey) {
        try {
          const cloned = req.clone();
          const body = await cloned.json();
          const method = body?.method;
          if (method === "initialize" || method === "tools/list" || method === "notifications/initialized") {
            isDiscoveryRequest = true;
            authResult = { valid: true, tier: "discovery", name: "scanner" };
          }
        } catch {}
      }

      if (!isDiscoveryRequest) {
        authResult = await validateApiKey(apiKey);
      }

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
              "WWW-Authenticate": `Bearer resource_metadata="https://mcp.ezbizservices.com/.well-known/oauth-protected-resource"`,
              ...corsHeaders,
            },
          }
        );
      }

      // Check for existing session
      const sessionId = req.headers.get("mcp-session-id");

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

          const mcpServer = createMcpServer();
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

    // --- Pages ---
    const PAGE_ROUTES: Record<string, string> = {
      "/": "index.html",
      "/docs": "docs.html",
      "/signup": "signup.html",
      "/pricing": "pricing.html",
      "/tools/analyze-competitors": "tools/analyze-competitors.html",
      "/tools/competitor-analysis": "tools/competitor-analysis.html",
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

if (typeof Bun !== "undefined" && !process.env.SMITHERY_SCAN) console.log(`MCP Business Intelligence server running on port ${PORT}`);

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
