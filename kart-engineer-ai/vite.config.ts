import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const ROUTES = ['/', '/app', '/privacidade', '/termos'];

/**
 * Gera sitemap.xml e completa o robots.txt somente quando VITE_SITE_URL
 * estiver definido. Sem domínio real configurado, não publicamos URLs inventadas.
 */
function sitemapPlugin(siteUrl: string | undefined): Plugin {
  return {
    name: 'kart-sitemap',
    apply: 'build',
    generateBundle() {
      const base = siteUrl?.replace(/\/$/, '');
      let robots = 'User-agent: *\nAllow: /\nDisallow: /app/\n';
      if (base) {
        const urls = ROUTES.map((r) => `  <url><loc>${base}${r}</loc></url>`).join('\n');
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
        });
        robots += `Sitemap: ${base}/sitemap.xml\n`;
      }
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), sitemapPlugin(env.VITE_SITE_URL)],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    worker: { format: 'es' },
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
  };
});
