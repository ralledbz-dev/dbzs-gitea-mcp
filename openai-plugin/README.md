# DBZS Developer — private OpenAI plugin integration

This folder contains a private-use skill for the existing DBZS Gitea MCP server. It does not replace the server or expose localhost publicly.

## Existing runtime
The repository uses Node.js >=24, MCP v2, and offers stdio and loopback HTTP transports. Its local HTTP endpoint is intended to remain bound to 127.0.0.1.

## Installation and connection
1. Build and start the existing server using its documented environment configuration. Keep secrets in environment variables.
2. Check /health, /ready, /version and MCP initialize/tools/list against the running local server, where supported.
3. Configure an authenticated OpenAI-compatible secure tunnel or supported remote MCP endpoint. A localhost URL alone cannot be reached by ChatGPT cloud services.
4. In the OpenAI plugin workflow, configure the reachable MCP endpoint and use the skill in skills/dbzs-developer/SKILL.md.
5. Keep this plugin private; never publish the endpoint or credentials.

## Readiness gates
- [ ] Live MCP initialize/tools/list succeeds through the selected transport.
- [ ] Remote authenticated tunnel endpoint is reachable by the intended ChatGPT client.
- [ ] Tool permissions and write approvals are enforced server-side.
- [ ] Plugin package format validated against the current official specification.
- [ ] Private installation and end-to-end read-only tool invocation succeed.

No tunnel, credentials, OpenAI installation, or submission is created by this repository-only change.
