# Private installation — DBZS Developer

## What is included
This portable plugin contains the official root `plugin.json` and the `skills/dbzs-developer/SKILL.md` skill.

## Option A: install the skill locally
Use the ChatGPT desktop app / Codex plugin marketplace workflow described in the current OpenAI plugin packaging documentation. Place this plugin directory in a local marketplace source, then install it from the plugin directory.

## Option B: connect the MCP server to ChatGPT
1. Start the existing DBZS server with `MCP_TRANSPORT=http` and `MCP_HTTP_PORT=3939`.
2. Confirm the loopback endpoint `http://127.0.0.1:3939/mcp` works locally.
3. Create an authenticated OpenAI Secure MCP Tunnel and configure the tunnel client on the Windows machine. The tunnel must preserve a localhost Host header and satisfy the server's Origin validation; test this before use.
4. In ChatGPT Plugins, choose Add custom MCP server and enter the registered, reachable MCP endpoint and authentication settings.
5. Select Create as a plugin, then test a read-only tool call. Obtain the generated `plugin_asdk_app...` ID if you want a registered app mapping in the portable package.

## Important
A private local skill package does not automatically install or connect an MCP server. A remote URL, tunnel ID and authentication scheme cannot be inferred from source code. Do not put any tokens into the repository.

## Validation
- Parse `plugin.json` as JSON.
- Confirm the skill frontmatter is present.
- Check the live MCP initialize and tools/list before granting any write capabilities.
- Run a read-only repository-list call through the actual ChatGPT connection.
