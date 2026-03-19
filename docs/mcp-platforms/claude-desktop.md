# Kastell MCP -- Claude Desktop

## Prerequisites

- Node.js 20+ installed
- Claude Desktop app installed

## Configuration

Edit `claude_desktop_config.json`:

- macOS/Linux: `~/.config/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "kastell": {
      "command": "npx",
      "args": ["-y", "-p", "kastell", "kastell-mcp"],
      "env": {
        "HETZNER_TOKEN": "your-token"
      }
    }
  }
}
```

Provider tokens are optional. Add `DIGITALOCEAN_TOKEN`, `VULTR_TOKEN`, or `LINODE_TOKEN` as needed. Omit `env` entirely if no cloud provider is needed.

## Verify

Restart Claude Desktop. The hammer icon should show kastell tools.

## Troubleshooting

**Server not starting** -- Ensure Node.js 20+ is in your PATH. Check Claude Desktop logs: Help > Logs.

**"Could not connect"** -- On Windows, replace `"command": "npx"` with `"command": "cmd"` and prepend `"/c", "npx"` to args.
