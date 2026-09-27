# Project Guidelines

## Quota Optimization Rules

- NEVER read files outside of the `siphika-chauffeur/` directory unless explicitly asked.
- Avoid printing full code files back in the chat if only small sections are changed. Use concise git diffs or specific line updates.
- Keep conversational explanations extremely short. Prioritize direct solutions over conversational filler.

## Tech Stack & Code Conventions

- Language: JavaScript — ES modules on the client (`src/`), CommonJS in
  `functions/` (Cloud Functions). No TypeScript, no React/Vue/Angular — the
  UI is hand-written HTML with direct DOM manipulation (`getElementById`,
  `classList`), not a component framework.
- Build: Vite (`npm run dev` / `npm run build`), packaged as a Cordova
  hybrid app for Android/iOS via `cordova-android`.
- Backend: Firebase — Authentication, Firestore, and Cloud Functions
  (2nd gen, Node.js, region `africa-south1`).
- Integrations: Google Maps JavaScript API (Places + Routes) for
  booking/autocomplete/routing; PayFast for payments.
- Code style: camelCase, 2-space indentation, single quotes, semicolons,
  trailing commas (Prettier-style). One module per feature
  (`auth.module.js`, `maps.module.js`, `rides.module.js`, etc.), each
  exporting functions and exposing what inline `onclick` handlers need
  via `window.*`.

See `BACKLOG.md` for planned future work.
