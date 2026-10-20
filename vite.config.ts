import { defineConfig, type Plugin } from 'vite';

/** Link previews (WhatsApp, iMessage, Slack, X) ignore a relative og:image.
 *  On Vercel the production domain is known at build time (custom domain if
 *  there is one), so the share tags follow the site wherever it is deployed;
 *  anywhere else, set SITE_URL. Without either the tags stay relative. */
function shareTags(): Plugin {
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const site = (process.env.SITE_URL || (vercel ? `https://${vercel}` : '')).replace(/\/+$/, '');
  return {
    name: 'share-tags',
    apply: 'build',
    transformIndexHtml(html) {
      if (!site) return html;
      return html
        .replace(/(<meta (?:property|name)="(?:og|twitter):image" content=")\//g, `$1${site}/`)
        .replace('<meta property="og:type"',
          `<meta property="og:url" content="${site}/" />\n  <link rel="canonical" href="${site}/" />\n  <meta property="og:type"`);
    },
  };
}

export default defineConfig({
  plugins: [shareTags()],
  server: { host: true, port: 5173 },
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
});
