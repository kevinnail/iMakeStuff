# CLAUDE.md

iMakeStuff (working name) is an iOS app for a self-employed maker that builds a record of every piece made: what it is, when it was made, how long it actually took, and a photo. Its purpose is accountability: showing worked time against time that wasn't work, so "that piece took a day" can't hide four hours of breaks. The number that matters is output per day against hours worked per day.

## Status

Partway through slice 0. The Node blocker was resolved 2026-10-30 (Node 24 through nvm-windows; see `docs/node-versions.md`). **Read `docs/RESUME.md` first**: it has the exact state and the next steps. The build plan is `docs/plans/pending/initial-build.md`. Plans live in `docs/plans/pending/` and move to `docs/plans/completed/` once built and signed off.

## Stack

Expo (React Native) with Expo Router and TypeScript strict, Zustand for in-memory state, `expo-sqlite` as the only data store, photos as files in the app's documents folder. Local only: no server, no accounts, no sync.

The stack is modeled on Kevin's Crop Planner app (`../Crop Planner/Crop Planner App/garden-tracker/garden-tracker`). When a pattern is needed (EAS dev variant, SQLite setup, photo storage, Jest with `better-sqlite3`), read how Crop Planner does it first and copy it rather than inventing a new one.

## Build

Kevin develops on Windows with no Mac or Xcode. Every iOS build goes through EAS cloud (`eas build --profile development --platform ios`). Never tell him to run `expo run:ios`.

The dev build installs as a separate app through a `.dev` bundle id, set in `app.config.js` when `APP_VARIANT=development`, so it never touches the App Store build's data. Same setup as Crop Planner.

## Rules for this app

- **The Work screen is for use mid-work.** Everything needed while working (start, break, done, photo, notes) happens on it with no navigation; forms there are panels that slide up from the bottom. The rest of the app (Pieces, Days) is ordinary navigation, like any other app.
- **A finished piece is always identifiable.** It needs a photo or a description; the database rejects one with neither.
- **The timer is timestamps, not a counter.** A running piece is a segment row with `started_at` and no `ended_at`. Elapsed time is computed from the clock, so iOS closing the app loses nothing.
- **Photos are stored by file name only.** iOS changes the app's folder path on every update, so a stored full path breaks. Store the file name and rebuild the path at use (Crop Planner's `rebaseNoteImageUri` in `src/utils/imageStorage.ts`).
- **Tests:** integration tests run the real SQL against an in-memory `better-sqlite3` database, the way Crop Planner does. No mocked data layer. Tests live in `__tests__/`, never beside the file they test.
