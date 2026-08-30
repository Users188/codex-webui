# Contributing

1. Use Node.js 20 or newer and PowerShell 7 or newer on Windows.
2. Run `npm install`, `npm run check`, and `npm test` before submitting changes.
3. Never commit tokens, access URLs, uploads, logs, PID files, conversation data, Cloudflare assertions, tunnel credentials, OpenAI credentials, or internal deployment records.
4. Preserve the single-writer design: WebUI shares the Desktop-owned app-server through the authenticated local bridge and must not silently start a competing app-server.
5. Add focused tests for protocol, access-control, synchronization, or lifecycle changes.

Contributions are provided under the repository's MIT License. Contributors must have the right to submit their changes.
