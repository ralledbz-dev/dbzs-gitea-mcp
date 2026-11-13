# Private plugin security boundary

The DBZS MCP server remains bound to loopback. Only an authenticated tunnel may bridge the connection to the owner's ChatGPT environment.

Do not expose a raw unauthenticated MCP HTTP listener to the internet. Maintain origin/host guards, repository-owner allowlists, workspace sandboxing, per-tool authorization, and user confirmation for mutations.

Never include secrets in plugin ZIPs, source control, logs, or skill files. Configure runtime secrets through environment variables.

The skill is guidance, not an enforcement mechanism. Authorization must be enforced in the MCP server or tunnel. Verify the live server's effective policies before granting remote access.
