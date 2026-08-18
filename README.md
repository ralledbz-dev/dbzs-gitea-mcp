# DBZS Gitea MCP Server – Asset Pack

## Enthalten

- Original Branding Sheet
- App-Icons: 16, 24, 32, 48, 64, 128, 256, 512, 1024 px
- Multi-Resolution Windows `.ico`
- Tray-Icons: 16, 20, 24, 32, 48, 64, 128, 256 px
- Multi-Resolution Tray `.ico`
- Installer `.ico`
- Favicon `.ico`, 16×16, 32×32
- Apple Touch Icon 180×180
- `asset-manifest.json`

## Empfohlene Verwendung

### Electron

```json
{
  "build": {
    "win": {
      "icon": "assets/app/windows/dbzs-gitea-mcp.ico"
    },
    "nsis": {
      "installerIcon": "assets/installer/dbzs-gitea-mcp-installer.ico",
      "uninstallerIcon": "assets/installer/dbzs-gitea-mcp-installer.ico"
    }
  }
}
```

Tray:

```ts
const tray = new Tray(
  path.join(__dirname, "../assets/tray/windows/dbzs-gitea-mcp-tray.ico")
);
```

### Web UI

```html
<link rel="icon" href="/assets/favicon/favicon.ico">
<link rel="apple-touch-icon" href="/assets/favicon/apple-touch-icon.png">
```

## Branding

Primärmotiv:
- grüner Gitea-/Git-Bezug
- MCP-Klammern
- lokaler Server-/Infrastruktur-Charakter
- DBZS Neon/Cyber-Tech Look
