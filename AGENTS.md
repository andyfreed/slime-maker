# AGENTS.md

## Cursor Cloud specific instructions

**Slime Maker v2** is a React + TypeScript + Vite + PixiJS single-page app for creating virtual slimes. There is no custom backend server; the app connects directly to a hosted Supabase instance for auth and data (credentials are hardcoded in `src/lib/supabase.ts`).

### Running the app

- `npm run dev` — starts the Vite dev server (default port 5173). Use `-- --host 0.0.0.0` to expose on all interfaces.
- `npm run build` — TypeScript compile + Vite production build.
- `npm run preview` — serves the production build locally.

### Lint / Tests

- No ESLint or test framework is configured in this project. TypeScript strict mode (`tsc -b`) is the primary static check.
- There are no automated tests to run.

### Notes

- The Supabase URL and anon key have hardcoded defaults, so the app works without a `.env` file.
- PixiJS renders the slime characters using WebGL/WebGPU; headless environments without GPU may show rendering differences.
