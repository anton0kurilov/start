# Repository Guidelines

## Project Structure & Module Organization

- index.html is the Vite entry; src/main.ts mounts src/app.svelte.
- src/components/ contains lowercase Svelte 5 components, settings and UI primitives.
- src/app/ contains TypeScript types, the controller/read-only store, reading geometry,
  folder drag and the shared impression tracker.
- src/scripts/ keeps the JavaScript domain, RSS, storage, normalizers, model and utils.
- Components call controller commands; they do not mutate domain state/localStorage.
- Domain selectors are pure; prepareView explicitly performs scheduled model work.
- src/styles/base.scss loads _tokens.scss first, then the global component styles.
- public/assets/icons/ stores the manifest and install assets. dist/ is generated.
- tests/smoke/ uses node:test; tests/e2e/ uses Playwright with deterministic RSS fixtures.

## Build, Test, and Development Commands

- npm install installs dependencies. Use Node.js 22.12+.
- npm start / npm run dev runs Vite; dev also opens a browser.
- npm run check checks Svelte and TypeScript.
- npm run build generates a static dist/; npm run preview serves the build.
- npm run test:smoke runs domain, controller and geometry tests.
- npm run test:e2e runs against production preview; build first.
- Install the E2E browser with npx playwright install chromium.

## Coding Style & Naming Conventions

- TypeScript, Svelte, JavaScript and SCSS, formatted by Prettier (`.prettierrc`): 4-space indentation, single quotes, no semicolons, print width 80.
- Keep file names lowercase. JS and SCSS partials start with `_`.
- Use existing class naming patterns (BEM-ish).
- Keep design values in `src/styles/_tokens.scss`. Use its spacing, radius, typography, motion, and semantic color scales instead of adding near-duplicate literals or fractional spacing multipliers in components.
- Prefer nested SCSS selectors (use `&` for BEM blocks/elements/modifiers) instead of flat, repeated selectors.
- For UI work in the existing app, preserve the established visual language: reuse existing components (`btn`, `icon-btn`, `control`) and current tokens before introducing new variants.
- Do not restyle global/base components or shared color tokens for a local screen unless the user explicitly asks for a broader visual refresh.
- When new UI is necessary, make it feel like the same product by matching existing spacing, borders, radii, contrast, and interaction patterns.

## Testing Guidelines

- Run npm run check, npm run test:smoke and npm run build before finishing behavior changes. Run relevant Playwright scenarios for UI changes.
- Add new tests under `tests/smoke/` (or introduce a dedicated test folder/script if coverage grows).

## Commit & Pull Request Guidelines

- Commit messages are short and imperative; many use Conventional Commit-style prefixes: `feat:`, `fix:`, `refactor:` (e.g., `feat: add day selector`).
- PRs should include a concise summary, manual test notes, and screenshots for UI or layout changes.
- After each completed task, propose a commit message.

## Data Storage & Configuration

- App state is client-side only (`localStorage`) with JSON import/export support.
- Avoid introducing server-side dependencies without a clear migration plan.
