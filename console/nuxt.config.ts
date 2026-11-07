// The console: Nuxt 4 on Nitro. `pnpm build` sets NITRO_PRESET to
// cloudflare-module (the deployable Worker, console/wrangler.jsonc); Nitro
// reads the preset from that variable, so a bare `nuxt dev` stays on its
// node server. `#nightwatch` is the root package's src/: the console's
// server routes import its application, domain, ports and adapters from
// there, and Nitro bundles them into the Worker.
import { fileURLToPath } from 'node:url';

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  devtools: { enabled: false },
  alias: { '#nightwatch': fileURLToPath(new URL('../src', import.meta.url)) },
  // An email links a Follow-up Page as /follow-up/<reference> (domain followUpUrl); /reports/<reference> is the same page.
  routeRules: { '/reports/**': { redirect: '/follow-up/**' } },
  // worker-configuration.d.ts (`pnpm cf-types`) carries the Worker's bindings and runtime types. The app's
  // tsconfig picks it up as a root .d.ts, since its typed $fetch reads the server routes' types.
  nitro: { cloudflare: { deployConfig: false }, typescript: { tsConfig: { include: ['../worker-configuration.d.ts'] } } },
  typescript: { strict: true },
});
