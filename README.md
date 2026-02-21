# EzBiz Business Intelligence MCP Server

AI-powered business intelligence tools via the Model Context Protocol (MCP).

## Tools

- **analyze_competitors** — Competitive landscape analysis with market positioning and strategic recommendations
- **score_web_presence** — Website presence scoring (0-100) across SEO, performance, content, social, and trust
- **analyze_reviews** — Online review aggregation with sentiment analysis and reputation insights
- **market_research** — Industry research with market size, trends, opportunities, and customer segments

## Quick Start

1. Get a free API key at [mcp.ezbizservices.com/signup](https://mcp.ezbizservices.com/signup)
2. Add to your MCP client config:

```json
{
  "mcpServers": {
    "ezbiz-business-intelligence": {
      "url": "https://mcp.ezbizservices.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

3. Ask your AI assistant to analyze a business!

## Pricing

| Tier | Price | Requests/Month |
|------|-------|----------------|
| Free | $0 | 10 |
| Starter | $19/mo | 200 |
| Pro | $49/mo | 1,000 |
| Business | $99/mo | 5,000 |

Get your key at [mcp.ezbizservices.com](https://mcp.ezbizservices.com)

## Self-Hosting

```bash
# Clone and install
git clone https://github.com/sjcripps/ezbiz-bizintel-mcp.git
cd ezbiz-bizintel-mcp
bun install

# Configure
cp .env.example .env
# Edit .env with your OpenAI API key and admin secret

# Run
bun run server.ts
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key for AI analysis |
| `ADMIN_SECRET` | Yes | Secret for admin API endpoints |
| `MCP_PORT` | No | Port to run on (default: 4200) |

## Tech Stack

- [Bun](https://bun.sh) runtime
- [MCP SDK](https://modelcontextprotocol.io) (@modelcontextprotocol/sdk)
- OpenAI for analysis
- Cheerio for web scraping

## License

MIT
