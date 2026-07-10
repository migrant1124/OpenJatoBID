# Jato AI BID

`Jato AI BID` is the internal bid-document desktop application of Jato Digital Technology Co., Ltd. Its desktop window title is `佳图智能投标助手`.

## Usage

The application supports tender-file parsing, technical outline generation, global facts, content generation and editing, reusable document knowledge, document checks, and Word export.

The core workflow is unchanged:

Tender file upload -> parsing -> outline generation -> global facts -> content generation or editing -> Word export.

Windows releases use the installer name `Jato AI BID Setup ${version}.exe`. Internal releases are published through [migrant1124/OpenJatoBID](https://github.com/migrant1124/OpenJatoBID/releases).

## Development

Run client commands from `client/`:

```powershell
cd client
npm ci
npm run dev
npm run build
```

Read `AGENTS.md` and `client/开发说明.md` before modifying the client. Phase 1 preserves `window.yibiao`, `yibiao.sqlite`, existing IPC channels, the technical-plan workflow, OpenCode Agent, and analytics behavior.

Copyright 2026 Jato Digital Technology Co., Ltd.
