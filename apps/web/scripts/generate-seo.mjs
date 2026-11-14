import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(appRoot, "dist");
const routes = JSON.parse(await readFile(join(appRoot, "src/app/seo-pages.json"), "utf8"));
const template = await readFile(join(dist, "index.html"), "utf8");
async function readSiteUrl() {
  if (process.env.VITE_SITE_URL) return process.env.VITE_SITE_URL;
  for (const envPath of [join(appRoot, ".env"), join(appRoot, "../../.env")]) {
    try {
      const contents = await readFile(envPath, "utf8");
      const match = contents.match(/^\s*VITE_SITE_URL\s*=\s*["']?([^\r\n"']+)["']?\s*$/m);
      if (match?.[1]) return match[1].trim();
    } catch {
      // A deployed base URL is optional for local builds.
    }
  }
  return undefined;
}

const siteUrl = (await readSiteUrl())?.replace(/\/+$/, "");

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function renderHead(page) {
  const title = escapeHtml(page.title);
  const description = escapeHtml(page.description);
  const indexable = page.indexable !== false;
  const canonical = indexable && siteUrl ? `<link rel="canonical" href="${escapeHtml(`${siteUrl}${page.path}`)}" />` : "";
  const openGraphUrl = indexable && siteUrl ? `<meta property="og:url" content="${escapeHtml(`${siteUrl}${page.path}`)}" />` : "";
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Cap-It",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    description: "A developer dashboard for exploring and monitoring a distributed token-bucket rate limiter.",
    ...(siteUrl ? { url: `${siteUrl}/overview` } : {}),
  }).replaceAll("<", "\\u003c");
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}" />`,
    `<meta name="robots" content="${indexable ? "index,follow,max-image-preview:large" : "noindex,follow"}" />`,
    canonical,
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Cap-It" />',
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    openGraphUrl,
    '<meta name="twitter:card" content="summary" />',
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<script type="application/ld+json">${structuredData}</script>`,
  ].filter(Boolean).join("\n    ");
}

for (const page of routes) {
  const routeDir = join(dist, page.path.slice(1));
  await mkdir(routeDir, { recursive: true });
  const html = template.replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, `<!-- seo:start -->\n    ${renderHead(page)}\n    <!-- seo:end -->`);
  await writeFile(join(routeDir, "index.html"), html);
}

await writeFile(join(dist, "index.html"), template.replace(
  /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/,
  `<!-- seo:start -->\n    ${renderHead(routes[0])}\n    <!-- seo:end -->`,
));

if (siteUrl) {
  const sitemapEntries = routes.map(({ path }) => `  <url><loc>${escapeHtml(`${siteUrl}${path}`)}</loc></url>`).join("\n");
  await writeFile(join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapEntries}\n</urlset>\n`);
  await writeFile(join(dist, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`);
  console.log(`SEO pages and sitemap generated for ${siteUrl}`);
} else {
  await writeFile(join(dist, "robots.txt"), "User-agent: *\nAllow: /\n");
  console.log("SEO pages generated. Set VITE_SITE_URL to generate canonical URLs and sitemap.xml for your deployed domain.");
}

const notFound = {
  path: "/404",
  title: "Page not found | Cap-It",
  description: "The requested Cap-It dashboard page could not be found.",
  indexable: false,
};
const notFoundHtml = template.replace(/<!-- seo:start -->[\s\S]*?<!-- seo:end -->/, `<!-- seo:start -->\n    ${renderHead(notFound)}\n    <!-- seo:end -->`);
await writeFile(join(dist, "404.html"), notFoundHtml);
