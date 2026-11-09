# Project notes

- Vite + React + TypeScript + Tailwind CSS v4. `npm run dev` serves the app on http://localhost:5204.
- Browser testing: `@playwright/test` is installed and configured in `playwright.config.ts` to drive the installed Google Chrome (no browser download needed). Put browser tests in `e2e/` and run `npx playwright test`; it starts the dev server itself.
- To look at the app yourself, save screenshots from a Playwright test or script (`await page.screenshot({ path: 'shots/home.png' })`) and open the PNG with the Read tool.
