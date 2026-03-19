# Kastell MCP -- VS Code / GitHub Copilot

## Prerequisites

- Node.js 20+ installed
- VS Code with GitHub Copilot extension

## Configuration

Create `.vscode/mcp.json` in your project root:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "hetzner-token",
      "description": "Hetzner Cloud API token",
      "password": true
    }
  ],
  "servers": {
    "kastell": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "-p", "kastell", "kastell-mcp"],
      "env": {
        "HETZNER_TOKEN": "${input:hetzner-token}"
      }
    }
  }
}
```

If your tokens are already in environment variables, you can omit the `inputs` block:

```json
{
  "servers": {
    "kastell": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "-p", "kastell", "kastell-mcp"]
    }
  }
}
```

## Verify

Open Copilot Chat (Ctrl+Shift+I). Type `@kastell` -- tools should appear.

## Troubleshooting

**"Failed to start server"** -- Check that `npx kastell-mcp` works in your terminal first.

**No tools in Copilot** -- Reload VS Code window (Ctrl+Shift+P > "Reload Window"). MCP servers start on workspace open.
