# AGENTS.md

## Cursor Cloud specific instructions

**Slime Maker v2** is a single-service **Vite + React 19 + TypeScript + PixiJS + Supabase** app. There is no custom backend server or Three.js usage; the rendering layer is PixiJS and the app connects directly to a hosted Supabase instance (credentials hardcoded in `src/lib/supabase.ts`, no `.env` needed).

### Quick reference

| Action | Command |
|--------|---------|
| Dev server | `npm run dev -- --host 0.0.0.0` (port 5173) |
| Type-check | `npx tsc -b` |
| Build | `npm run build` |
| Preview prod build | `npm run preview` |

### Fast startup path

The VM update script runs `npm ci --prefer-offline` on startup, which completes in ~2 s with a warm npm cache. To start developing immediately after:

```
npm run dev -- --host 0.0.0.0
```

Vite cold-starts in ~130 ms; subsequent HMR is near-instant.

### Lint / Tests

- No ESLint or test framework is configured. `npx tsc -b` (strict mode) is the only static check.
- No automated tests to run.

### Gotchas

- PixiJS renders via WebGL/WebGPU; headless or GPU-less environments may show rendering differences or canvas fallback.
- The lockfile is `package-lock.json` (npm). Always use `npm`, not yarn or pnpm.
- The `dist/` folder is git-ignored but may exist locally from prior builds; it does not affect the dev server.
