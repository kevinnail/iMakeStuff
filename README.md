# iMakeStuff

An iPhone app that records every piece made: what it is, when, how long it actually took, and a photo. See `docs/plans/pending/initial-build.md`.

## Run locally

Needs Node 24 (Expo SDK 58 supports 22.13+, 24.3+, or 26+; CI uses 24). Switching Node versions on this machine: `docs/node-versions.md`.

```bash
npm install
npm start          # Metro for the dev build; open the "iMakeStuff (Dev)" app on the phone
npm test           # Jest
npm run lint
npm run typecheck
npm run format:check
```

## Builds

There is no Mac, so iOS builds run on EAS:

```bash
eas device:create                                   # once per phone
eas build --profile development --platform ios      # dev build, installed from the QR code
```

All data is local on the phone in SQLite. No server, no accounts.
