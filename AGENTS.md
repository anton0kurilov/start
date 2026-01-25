# Repository Guidelines

## Project Structure & Module Organization

- `public/index.html` is the Parcel entry and wires styles/scripts.
- `src/scripts/` contains ES modules: `main.js` bootstraps; `domain.js` logic; `ui.js` rendering; `storage.js` localStorage; `utils.js`, `constants.js`.
- `src/styles/` holds SCSS: `main.scss`, `mobile.scss`, partials `_tasks.scss`, `_stats.scss` via `@use`.
- `src/icons/` assets (manifest, favicon, bundled font).
- `dist/` is generated build output; do not edit by hand.

## Build, Test, and Development Commands

- `npm install` installs Parcel and dev dependencies.
- `npm run dev` (or `npm start`) runs the Parcel dev server for `public/index.html`.
- `npm run build` removes `dist/*` and creates a production bundle.
- No automated test script is configured.

## Coding Style & Naming Conventions

- JavaScript and SCSS, formatted by Prettier (`.prettierrc`): 4-space indentation, single quotes, no semicolons, print width 80.
- Keep file names lowercase. JS and SCSS partials start with `_`.
- Use existing class naming patterns (BEM-ish).
- Prefer nested SCSS selectors (use `&` for BEM blocks/elements/modifiers) instead of flat, repeated selectors.

## Testing Guidelines

- Manual verification in the browser is the current expectation.
- If adding tests, introduce a `tests/` or `src/**/__tests__` location and add an npm script.

## Commit & Pull Request Guidelines

- Commit messages are short and imperative; many use Conventional Commit-style prefixes: `feat:`, `fix:`, `refactor:` (e.g., `feat: add day selector`).
- PRs should include a concise summary, manual test notes, and screenshots for UI or layout changes.
- After each completed task, propose a commit message.

## Data Storage & Configuration

- Avoid introducing server-side dependencies without a clear migration plan.
