# MCP Directory Submissions

Tracking file for Kastell's MCP directory listings.

## mcp.so

- **Status:** submitted
- **Submitted:** 2026-03-19
- **Issue URL:** https://github.com/chatmcp/mcpso/issues/927
- **Content:** Server provisioning, hardening and audit MCP server with 13 tools. 413-check security audit, 19-step hardening, CIS/PCI-DSS/HIPAA compliance. npm: `npx kastell-mcp`. GitHub: https://github.com/kastelldev/kastell

## Anthropic MCP Registry (registry.modelcontextprotocol.io)

> **Note:** DOCS-07 (Anthropic MCP Registry) and DOCS-08 (Open MCP Registry) are the SAME registry. The Open MCP Registry merged into registry.modelcontextprotocol.io. A single `mcp-publisher publish` satisfies both requirements.

- **Status:** pending
- **Namespace:** io.github.kastelldev/kastell
- **Published:** pending
- **server.json:** repo root (identical to glama.json)
- **Prerequisites:** npm publish v1.13.0 with mcpName field, GitHub OAuth with kastelldev org

### Publication Steps

1. Install mcp-publisher binary (see 71-RESEARCH.md Pattern 5)
2. `mcp-publisher login github` (GitHub device flow, authorize kastelldev org)
3. `mcp-publisher validate` (verify server.json)
4. `mcp-publisher publish`
5. Verify: `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.kastelldev/kastell"`
