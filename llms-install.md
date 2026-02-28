# Installing BizIntel MCP Server

This is a hosted MCP server — no local installation needed.

## Setup (30 seconds)

1. Get a free API key: https://mcp.ezbizservices.com/signup
2. Add this to your MCP client configuration:

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

## Available Tools

- `analyze_competitors` — Competitive landscape analysis
- `score_web_presence` — Website scoring (0-100) across SEO, performance, content, social, trust
- `analyze_reviews` — Online review aggregation with sentiment analysis
- `market_research` — Market sizing, trends, and opportunity analysis

## Requirements

- Any MCP-compatible client (Claude Desktop, Cursor, Cline, Windsurf, etc.)
- Free API key (no credit card required)
