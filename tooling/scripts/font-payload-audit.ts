// Relative imports: `tooling` does not depend on the font/PDF packages and this
// script must stay dependency-free.
import { getFallbackFontVariants, getWebFontSource } from "../../packages/fonts/src/index.ts";

/**
 * Measures what a PDF render would download for fonts.
 *
 * Registrations are captured by stubbing `Font.register`, so the numbers come
 * from the real `registerFonts` code path rather than from a model of it.
 * Byte sizes come from `HEAD` requests (Content-Length only) — this script
 * never downloads a font.
 *
 * Run: cd tooling && ./node_modules/.bin/tsx scripts/font-payload-audit.ts
 */

type Registration = {
	family: string;
	fontWeight: number;
	fontStyle: string;
	src: string;
};

type Scenario = {
	name: string;
	locale: string;
	typography: {
		body: { fontSize: number; fontFamily: string; lineHeight: number; fontWeights: string[] };
		heading: { fontSize: number; fontFamily: string; lineHeight: number; fontWeights: string[] };
	};
};

const hookModuleUrl = new URL("../../packages/pdf/src/hooks/use-register-fonts.ts", import.meta.url).href;

// The weights the CJK fallback used to register: every weight the body/heading
// ranges could produce, in both styles.
const legacyCjkWeights = ["400", "500", "600", "700"] as const;

const scenarios: Scenario[] = [
	{
		name: "zh-CN, Latin body (IBM Plex Serif) + CJK fallback",
		locale: "zh-CN",
		typography: {
			body: { fontSize: 10, fontFamily: "IBM Plex Serif", lineHeight: 1.5, fontWeights: ["400", "600"] },
			heading: { fontSize: 14, fontFamily: "IBM Plex Serif", lineHeight: 1.5, fontWeights: ["600"] },
		},
	},
	{
		name: "zh-CN, CJK body (Noto Serif SC) — CJK is primary",
		locale: "zh-CN",
		typography: {
			body: { fontSize: 10, fontFamily: "Noto Serif SC", lineHeight: 1.5, fontWeights: ["400", "700"] },
			heading: { fontSize: 14, fontFamily: "Noto Serif SC", lineHeight: 1.5, fontWeights: ["400", "700"] },
		},
	},
	{
		name: "en-US, Latin only (control — must not change)",
		locale: "en-US",
		typography: {
			body: { fontSize: 10, fontFamily: "IBM Plex Serif", lineHeight: 1.5, fontWeights: ["400", "600"] },
			heading: { fontSize: 14, fontFamily: "IBM Plex Serif", lineHeight: 1.5, fontWeights: ["600"] },
		},
	},
];

const formatBytes = (bytes: number): string => {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
};

const contentLengthByUrl = new Map<string, number | null>();

/** HEAD only — reads Content-Length without transferring the font. */
const getContentLength = async (url: string): Promise<number | null> => {
	if (contentLengthByUrl.has(url)) return contentLengthByUrl.get(url) ?? null;

	try {
		const response = await fetch(url, { method: "HEAD" });
		const length = Number(response.headers.get("content-length"));
		const value = Number.isFinite(length) && length > 0 ? length : null;
		contentLengthByUrl.set(url, value);
		return value;
	} catch {
		contentLengthByUrl.set(url, null);
		return null;
	}
};

const measureScenario = async (scenario: Scenario): Promise<void> => {
	// Imported through the same specifier `use-register-fonts` resolves
	// (`#react-pdf-renderer` -> @react-pdf/renderer) so the stub below is the
	// very object `registerFonts` calls.
	// Imported by its real location under packages/pdf so Node hands back the
	// very module instance `use-register-fonts` imports via `#react-pdf-renderer`.
	const { Font } = (await import(
		new URL("../../packages/pdf/node_modules/@react-pdf/renderer/lib/react-pdf.js", import.meta.url).href
	)) as unknown as {
		Font: { register: (options: Registration) => void; registerHyphenationCallback: (callback: unknown) => void };
	};

	const registrations: Registration[] = [];
	const originalRegister = Font.register;
	const originalHyphenation = Font.registerHyphenationCallback;

	Font.register = (options: Registration) => {
		registrations.push(options);
	};
	Font.registerHyphenationCallback = () => {};

	try {
		const { registerFonts } = await import(`${hookModuleUrl}?scenario=${encodeURIComponent(scenario.name)}`);
		registerFonts(scenario.typography, scenario.locale);
	} finally {
		Font.register = originalRegister;
		Font.registerHyphenationCallback = originalHyphenation;
	}

	const uniqueUrls = [...new Set(registrations.map((registration) => registration.src))];
	const sizes = new Map<string, number | null>();
	for (const url of uniqueUrls) sizes.set(url, await getContentLength(url));

	const totalBytes = uniqueUrls.reduce((total, url) => total + (sizes.get(url) ?? 0), 0);
	const cjkRegistrations = registrations.filter((registration) =>
		/Noto (Sans|Serif) (SC|TC|JP|KR|HK)/.test(registration.family),
	);
	const cjkUrls = [...new Set(cjkRegistrations.map((registration) => registration.src))];
	const cjkBytes = cjkUrls.reduce((total, url) => total + (sizes.get(url) ?? 0), 0);

	console.log(`\n${scenario.name}`);
	console.log(`  locale: ${scenario.locale}`);
	console.log(`  registered variants (family x weight x style): ${registrations.length}`);
	console.log(`  distinct font files: ${uniqueUrls.length} — ${formatBytes(totalBytes)}`);
	console.log(
		`  of which CJK: ${cjkRegistrations.length} variants / ${cjkUrls.length} files — ${formatBytes(cjkBytes)}`,
	);

	for (const url of cjkUrls) {
		console.log(`    ${formatBytes(sizes.get(url) ?? 0).padStart(10)}  ${url.split("/").at(-1)}`);
	}

	// What the same CJK families would have registered before the weight budget:
	// every weight the ranges could produce, in both styles.
	const legacyUrls = new Set<string>();
	for (const family of new Set(cjkRegistrations.map((registration) => registration.family))) {
		for (const weight of legacyCjkWeights) {
			for (const italic of [false, true]) {
				const source = getWebFontSource(family, weight, italic);
				if (source) legacyUrls.add(source);
			}
		}
	}

	let legacyBytes = 0;
	for (const url of legacyUrls) legacyBytes += (await getContentLength(url)) ?? 0;

	const budgetVariants = getFallbackFontVariants(["200", "300", "400", "500", "600", "700", "800", "900"], {
		cjk: true,
		requestedWeights: [...legacyCjkWeights],
	}).length;

	if (cjkRegistrations.length > 0) {
		console.log(
			`  CJK before the weight budget: ${legacyUrls.size} files — ${formatBytes(legacyBytes)} ` +
				`(policy: ${budgetVariants} variants/family now vs ${legacyCjkWeights.length * 2} then)`,
		);
	}
};

const main = async (): Promise<void> => {
	console.log("Font payload audit — HEAD requests only, no font is downloaded.");

	for (const scenario of scenarios) {
		await measureScenario(scenario);
	}

	console.log("");
	console.log(
		"Note: @react-pdf/renderer loads fonts lazily, per (family, weight, style) that actually\n" +
			"appears in the rendered tree. The figures above are the worst case — the set that would\n" +
			"be fetched if every registered variant is used, and also the set of distinct files that\n" +
			"an offline install has to host.",
	);
};

await main();
