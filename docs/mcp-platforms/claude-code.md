# Kastell MCP -- Claude Code

## Prerequisites

- Node.js 20+ installed
- Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code`)

## Configuration

### Quick Setup (recommended)

```bash
claude mcp add kastell --scope user -- npx -y -p kastell kastell-mcp
```

### With provider tokens

```bash
claude mcp add kastell --scope user \
  --env HETZNER_TOKEN=your-token \
  -- npx -y -p kastell kastell-mcp
```

### Project-level (.mcp.json)

```json
{
  "mcpServers": {
    "kastell": {
      "command": "npx",
      "args": ["-y", "-p", "kastell", "kastell-mcp"],
      "env": { "HETZNER_TOKEN": "${HETZNER_TOKEN}" }
    }
  }
}
```

### Windows

On Windows (not WSL), use the cmd wrapper:

```json
{
  "mcpServers": {
    "kastell": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "-p", "kastell", "kastell-mcp"]
    }
  }
}
```

## Verify

Run `/mcp` in Claude Code -- kastell should appear with 13 tools.

## Troubleshooting

**"Connection closed" on Windows** -- Use the cmd wrapper config above. Windows cannot execute npx directly as a process.

**Tools not appearing** -- Run `claude mcp list` to verify kastell is registered. If missing, re-add with `claude mcp add`.
