# CLAUDE.md

iMakeStuff (working name) is an iOS app for a self-employed maker that builds a record of every piece made: what it is, when it was made, how long it actually took, and a photo. Its purpose is accountability: showing worked time against time that wasn't work, so "that piece took a day" can't hide four hours of breaks. The number that matters is output per day against hours worked per day.

## Status

**Start with the Status table at the top of `docs/plans/pending/initial-build.md`.** It says which slices are done and which is next. When a slice is built, tested, working on the phone, and committed, mark it Done there with the date and commit. Plans live in `docs/plans/pending/` and move to `docs/plans/completed/` once built and signed off.

This project runs on Node 24 through nvm-windows (`docs/node-versions.md`).

## Stack

Expo (React Native) with Expo Router and TypeScript strict, Zustand for in-memory state, `expo-sqlite` as the only data store, photos as files in the app's documents folder. Local only: no server, no accounts, no sync.

The stack is modeled on Kevin's Crop Planner app (`../Crop Planner/Crop Planner App/garden-tracker/garden-tracker`). When a pattern is needed (EAS dev variant, SQLite setup, photo storage, Jest with `better-sqlite3`), read how Crop Planner does it first and copy it rather than inventing a new one.

## Build

Kevin develops on Windows with no Mac or Xcode. Every iOS build goes through EAS cloud (`eas build --profile development --platform ios`). Never tell him to run `expo run:ios`.

The dev build installs as a separate app through a `.dev` bundle id, set in `app.config.js` when `APP_VARIANT=development`, so it never touches the App Store build's data. Same setup as Crop Planner.

## Installing packages

Every install follows the 2 week rule for the whole dependency tree:

- **Set the cutoff in the same command as the install:** `export NPM_CONFIG_BEFORE=<current UTC time minus 14 days>`. `npm view` ignores this setting, so check publish dates with `npm view <pkg> time --json`.
- **Expo packages go through `EXPO_OFFLINE=1 npx expo install <pkg>`.** Offline, versions come from the installed `expo`'s `bundledNativeModules.json`. Online, Expo picks the newest SDK 58 releases, which are often too new for the rule.
- **After any install, `npm ls --all` must show nothing `invalid` or `missing`.** EAS runs `npm ci`, which fails when npm considers the lock file out of sync.
- **npm 11 skips package install scripts until they're approved.** Approve only a package that needs its script: `npm install-scripts approve <pkg>` records it in `allowScripts` in `package.json`. Approved so far: `better-sqlite3`.
- **`expo doctor` on EAS flags two things that are expected:**
  - Newer SDK 58 patch versions held back by the rule.
  - Jest 29 against Expo's Jest 30. That's deliberate: the tests use `ts-jest` in plain Node, not `jest-expo`.

## Rules for this app

- **The Work screen is for use mid-work.** Everything needed while working (start, break, done, photo, notes) happens on it with no navigation; forms there are panels that slide up from the bottom. The rest of the app (Pieces, Days) is ordinary navigation, like any other app.
- **A finished piece is always identifiable.** It needs a photo or a description; the database rejects one with neither.
- **The timer is timestamps, not a counter.** A running piece is a segment row with `started_at` and no `ended_at`. Elapsed time is computed from the clock, so iOS closing the app loses nothing.
- **Photos are stored by file name only.** iOS changes the app's folder path on every update, so a stored full path breaks. Store the file name and rebuild the path at use (Crop Planner's `rebaseNoteImageUri` in `src/utils/imageStorage.ts`).
- **Tests:** integration tests run the real SQL against an in-memory `better-sqlite3` database, the way Crop Planner does. No mocked data layer. Tests live in `__tests__/`, never beside the file they test.
