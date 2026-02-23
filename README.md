# BizIntel MCP Server

[![MCP](https://img.shields.io/badge/MCP-Compatible-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/runtime-Bun-black)](https://bun.sh)

AI-powered business intelligence tools via the [Model Context Protocol (MCP)](https://modelcontextprotocol.io). Give your AI assistant the ability to research competitors, score websites, analyze reviews, and conduct market research — all in real time.

## Tools

| Tool | Description |
|------|-------------|
| `analyze_competitors` | Competitive landscape analysis with market positioning, SWOT insights, and strategic recommendations |
| `score_web_presence` | Website presence scoring (0-100) across SEO, performance, content, social media, and trust signals |
| `analyze_reviews` | Online review aggregation with sentiment analysis, theme extraction, and reputation insights |
| `market_research` | Industry research with market sizing, trends, opportunities, and customer segment analysis |

## Quick Start (Hosted)

**No installation required.** Use the hosted version:

1. Get a free API key at [mcp.ezbizservices.com/signup](https://mcp.ezbizservices.com/signup)
2. Add to your MCP client config (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "bizintel": {
      "url": "https://mcp.ezbizservices.com/mcp",
      "headers": {
        "x-api-key": "YOUR_API_KEY"
      }
    }
  }
}
```

3. Ask your AI assistant to analyze any business!

### Example Prompts

- "Analyze the competitive landscape for coffee shops in Austin, TX"
- "Score the web presence of example.com"
- "What do customers say about [Business Name] in their reviews?"
- "Research the market opportunity for AI consulting services"

## Self-Hosting

```bash
git clone https://github.com/ezbiz-services/mcp-business-intelligence.git
cd mcp-business-intelligence
bun install

cp .env.example .env
# Edit .env with your OpenAI API key and admin secret

bun run server.ts
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for AI-powered analysis |
| `ADMIN_SECRET` | Yes | Secret for admin API endpoints |
| `MCP_PORT` | No | Server port (default: 4200) |

## Pricing

| Tier | Price | Requests/Month |
|------|-------|----------------|
| **Free** | $0 | 10 |
| Starter | $19/mo | 200 |
| Pro | $49/mo | 1,000 |
| Business | $99/mo | 5,000 |

Start free at [mcp.ezbizservices.com](https://mcp.ezbizservices.com)

## Architecture

- **Runtime:** [Bun](https://bun.sh)
- **Protocol:** [MCP SDK](https://www.npmjs.com/package/@modelcontextprotocol/sdk) (Streamable HTTP transport)
- **AI:** OpenAI GPT-4o for analysis
- **Scraping:** Cheerio for web data extraction
- **Auth:** API key-based with tiered rate limiting

## Links

- **Homepage:** [mcp.ezbizservices.com](https://mcp.ezbizservices.com)
- **API Docs:** [mcp.ezbizservices.com/docs](https://mcp.ezbizservices.com/docs)
- **Sign Up:** [mcp.ezbizservices.com/signup](https://mcp.ezbizservices.com/signup)
- **Server Card:** [mcp.ezbizservices.com/.well-known/mcp/server-card.json](https://mcp.ezbizservices.com/.well-known/mcp/server-card.json)

## License

MIT — see [LICENSE](LICENSE)
