import { env } from "@reactive-resume/env/server";

const DOCS_URL = "https://docs.rxresu.me";

type StaticSeoOptions = {
	head?: boolean;
};

function appUrl() {
	return env.APP_URL.replace(/\/+$/, "");
}

function textResponse(body: string, options: StaticSeoOptions = {}) {
	return new Response(options.head ? null : body, {
		headers: { "Content-Type": "text/plain; charset=UTF-8" },
	});
}

export function handleRobots(options?: StaticSeoOptions) {
	const baseUrl = appUrl();
	const body = [
		"User-agent: *",
		"Allow: /",
		"Disallow: /api/rpc",
		"Disallow: /api/auth",
		"Disallow: /mcp",
		"Disallow: /.well-known",
		"",
		`Sitemap: ${baseUrl}/sitemap.xml`,
		`Sitemap: ${DOCS_URL}/sitemap.xml`,
		"",
	].join("\n");

	return textResponse(body, options);
}

/**
 * Indexable public routes advertised in the sitemap.
 *
 * Mirrors `indexableAppPaths` in `./web.ts`. It is duplicated rather than imported because that
 * module resolves the web distribution and registers static middleware at import time.
 */
const SITEMAP_PATHS = ["/", "/ats-checker", "/privacy", "/terms"] as const;

export function handleSitemap(options?: StaticSeoOptions) {
	const baseUrl = appUrl();
	const urls = SITEMAP_PATHS.flatMap((path) => ["  <url>", `    <loc>${baseUrl}${path}</loc>`, "  </url>"]);
	const body = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...urls,
		"</urlset>",
		"",
	].join("\n");

	return new Response(options?.head ? null : body, {
		headers: { "Content-Type": "application/xml; charset=UTF-8" },
	});
}

export function handleLlms(options?: StaticSeoOptions) {
	const baseUrl = appUrl();
	const body = [
		"# Reactive Resume",
		"",
		"Reactive Resume is an open-source resume builder for creating, managing, and exporting resumes.",
		"",
		"## Links",
		"",
		`- Product: ${baseUrl}`,
		`- Documentation: ${DOCS_URL}`,
		`- Documentation sitemap: ${DOCS_URL}/sitemap.xml`,
		`- Documentation llms.txt: ${DOCS_URL}/llms.txt`,
		`- API documentation: ${DOCS_URL}/api-reference`,
		`- Resume schema: ${baseUrl}/schema.json`,
		`- MCP documentation: ${DOCS_URL}/guides/using-the-mcp-server`,
		`- OpenAPI specification: ${baseUrl}/api/openapi/spec.json`,
		"",
	].join("\n");

	return textResponse(body, options);
}
