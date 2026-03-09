# Repository Guidelines

## Project Structure & Module Organization

- `public/index.html` is the Parcel entry and links the app stylesheet from `src/styles/base.scss`.
- `public/assets/icons/` stores static assets (manifest, favicon, apple touch icon, app svg).
- `src/app.js` is the JS entry file and imports `src/scripts/main.js`.
- `src/scripts/` contains ES modules:
    - `main.js` bootstraps the app, binds UI events, and refreshes safe-area vars.
    - `domain.js` manages state, RSS refresh, and business rules.
    - `ui.js` renders columns/settings and handles UI state helpers.
    - `app-actions.js` encapsulates app-level handlers (refresh, import/export, status updates).
    - `column-interactions.js` handles column header/scroll interactions and auto mark-as-read behavior.
    - `state-normalizers.js` normalizes imported state.
    - `storage.js`, `utils.js`, `constants.js` provide persistence and shared helpers.
- `src/styles/` holds SCSS: `base.scss` and partials `_columns.scss`, `_settings.scss` via `@use`.
- `tests/smoke/` contains smoke tests using `node:test`.
- `dist/` is generated build output; do not edit by hand.

## Build, Test, and Development Commands

- `npm install` installs Parcel and dev dependencies.
- `npm start` runs the Parcel dev server for `public/index.html`.
- `npm run dev` runs the Parcel dev server and opens a browser tab.
- `npm run build` removes `dist/*` and creates a production bundle.
- `npm run test:smoke` runs smoke tests from `tests/smoke/*.test.mjs` via `node --test`.

## Coding Style & Naming Conventions

- JavaScript and SCSS, formatted by Prettier (`.prettierrc`): 4-space indentation, single quotes, no semicolons, print width 80.
- Keep file names lowercase. JS and SCSS partials start with `_`.
- Use existing class naming patterns (BEM-ish).
- Prefer nested SCSS selectors (use `&` for BEM blocks/elements/modifiers) instead of flat, repeated selectors.
- For UI work in the existing app, preserve the established visual language: reuse existing components (`btn`, `icon-btn`, `control`) and current tokens before introducing new variants.
- Do not restyle global/base components or shared color tokens for a local screen unless the user explicitly asks for a broader visual refresh.
- When new UI is necessary, make it feel like the same product by matching existing spacing, borders, radii, contrast, and interaction patterns.

## Testing Guidelines

- Run `npm run test:smoke` before finishing changes that affect behavior.
- Add new tests under `tests/smoke/` (or introduce a dedicated test folder/script if coverage grows).

## Commit & Pull Request Guidelines

- Commit messages are short and imperative; many use Conventional Commit-style prefixes: `feat:`, `fix:`, `refactor:` (e.g., `feat: add day selector`).
- PRs should include a concise summary, manual test notes, and screenshots for UI or layout changes.
- After each completed task, propose a commit message.

## Data Storage & Configuration

- App state is client-side only (`localStorage`) with JSON import/export support.
- Avoid introducing server-side dependencies without a clear migration plan.
