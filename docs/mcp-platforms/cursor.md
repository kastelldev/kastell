# Kastell MCP -- Cursor

## Prerequisites

- Node.js 20+ installed
- Cursor editor installed

## Configuration

### Project-level (.cursor/mcp.json)

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "kastell": {
      "command": "npx",
      "args": ["-y", "-p", "kastell", "kastell-mcp"],
      "env": {
        "HETZNER_TOKEN": "${env:HETZNER_TOKEN}"
      }
    }
  }
}
```

### Global (~/.cursor/mcp.json)

Same format, placed at `~/.cursor/mcp.json` for all projects.

## Verify

Open Cursor Settings > MCP Servers. Kastell should show a green status indicator.

## Troubleshooting

**Server shows red status** -- Click the server name for error details. Most common cause: Node.js not in PATH.

**Tools not appearing in chat** -- Ensure "MCP" is enabled in Cursor settings. Restart Cursor after adding the config.
