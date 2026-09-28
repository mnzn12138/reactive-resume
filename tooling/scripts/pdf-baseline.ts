import type { Template } from "@reactive-resume/schema/templates";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { templateSchema } from "@reactive-resume/schema/templates";

type RasterViewport = { width: number; height: number };

type RasterPage = {
	getViewport(input: { scale: number }): RasterViewport;
	render(input: { canvas: unknown; canvasContext: unknown; viewport: RasterViewport }): { promise: Promise<unknown> };
	cleanup(): void;
};

type RasterDocument = {
	numPages: number;
	getPage(pageNumber: number): Promise<RasterPage>;
};

type RasterLoadingTask = {
	promise: Promise<RasterDocument>;
	destroy(): Promise<void>;
};

type CanvasContext2D = {
	getImageData(x: number, y: number, width: number, height: number): { data: Uint8Array };
};

type CanvasLike = { getContext(kind: "2d"): CanvasContext2D };

type CanvasModule = { createCanvas(width: number, height: number): CanvasLike };

type RasterizedPage = {
	width: number;
	height: number;
	hash: string;
	data: Uint8Array;
};

type ManifestEntry = {
	file: string;
	pages: number;
	sizeBytes: number;
	pageRasterHashes: string[];
};

type BaselineManifest = {
	generatedAt: string;
	rasterScale: number;
	templates: Record<string, ManifestEntry>;
};

type SnapshotOptions = {
	outputDirectory: string;
	templates: Template[];
	raster: boolean;
};

type CompareOptions = {
	leftDirectory: string;
	rightDirectory: string;
	threshold: number;
};

type PageComparison = {
	pageNumber: number;
	differingPixels: number;
	maxChannelDelta: number;
};

type TemplateComparison = {
	template: string;
	status: "pass" | "fail";
	leftPages: number;
	rightPages: number;
	totalDifferingPixels: number;
	maxChannelDelta: number;
	note: string;
	pages: PageComparison[];
};

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const requireFromPdfPackage = createRequire(new URL("../../packages/pdf/package.json", import.meta.url));
const pdfHeader = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
const rasterScale = 1.5;
const manifestFilename = "manifest.json";
const usage = `Usage: pnpm --dir tooling exec tsx scripts/pdf-baseline.ts [snapshot|compare] [options]

Render deterministic sample resume data with the templates registered in the schema, or compare
two baseline directories page by page.

Snapshot options (default command):
  -o, --out <directory>       Output directory, relative paths resolve from the repository root.
                              Defaults to tooling/baseline/pre-migration (git tracked).
  -t, --template <name,...>   Render only the named template(s). May be repeated.
  --no-raster                 Skip page raster hashes (manifest still records page counts).

Compare options:
  compare <left> <right>      Compare two baseline directories (or use --left/--right).
  --threshold <value>         Per-channel tolerance before a pixel counts as differing. Default 0.

Common options:
  -h, --help                  Show this help message.

Available templates: ${templateSchema.options.join(", ")}`;

let samplePictureDataUrl = "";
let canvasModule: CanvasModule | null = null;

const loadPdfServer = async (): Promise<typeof import("@reactive-resume/pdf/server")> => {
	// The repository preserves JSX for its bundler, while tsx uses the classic React transform.
	// Supplying React globally keeps this standalone development script compatible with that setup.
	const runtimeGlobal = globalThis as typeof globalThis & { React?: unknown };
	runtimeGlobal.React ??= requireFromPdfPackage("react");
	return await import("@reactive-resume/pdf/server");
};

const loadCanvasModule = (): CanvasModule => {
	canvasModule ??= requireFromPdfPackage("@napi-rs/canvas") as CanvasModule;
	return canvasModule;
};

const createBaselineResumeData = async (): Promise<typeof sampleResumeData> => {
	const data = structuredClone(sampleResumeData);
	if (data.picture.url.startsWith("/")) {
		if (!samplePictureDataUrl) {
			const picturePath = resolve(repositoryRoot, "apps", "web", "public", data.picture.url.slice(1));
			samplePictureDataUrl = `data:image/jpeg;base64,${(await readFile(picturePath)).toString("base64")}`;
		}
		data.picture.url = samplePictureDataUrl;
	}
	return data;
};

const isPdf = (bytes: Uint8Array): boolean =>
	bytes.byteLength >= pdfHeader.length && pdfHeader.every((value, index) => bytes[index] === value);

const hashPixels = (data: Uint8Array): string => createHash("sha256").update(data).digest("hex");

const openPdfDocument = (bytes: Uint8Array): RasterLoadingTask =>
	getDocument({ data: new Uint8Array(bytes) }) as unknown as RasterLoadingTask;

const rasterizePdfPages = async (bytes: Uint8Array): Promise<RasterizedPage[]> => {
	const { createCanvas } = loadCanvasModule();
	const loadingTask = openPdfDocument(bytes);
	const pages: RasterizedPage[] = [];

	try {
		const document = await loadingTask.promise;

		for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
			const page = await document.getPage(pageNumber);

			try {
				const viewport = page.getViewport({ scale: rasterScale });
				const width = Math.ceil(viewport.width);
				const height = Math.ceil(viewport.height);
				const canvas = createCanvas(width, height);
				const context = canvas.getContext("2d");

				await page.render({ canvas, canvasContext: context, viewport }).promise;

				const data = Uint8Array.from(context.getImageData(0, 0, width, height).data);
				pages.push({ width, height, hash: hashPixels(data), data });
			} finally {
				page.cleanup();
			}
		}
	} finally {
		await loadingTask.destroy();
	}

	return pages;
};

const readPdfPageCount = async (bytes: Uint8Array): Promise<number> => {
	const loadingTask = openPdfDocument(bytes);

	try {
		const document = await loadingTask.promise;
		return document.numPages;
	} finally {
		await loadingTask.destroy();
	}
};

const parseTemplateValue = (value: string): Template[] => {
	const names = value
		.split(",")
		.map((name) => name.trim())
		.filter((name) => name.length > 0);

	if (names.length === 0) throw new Error("--template requires at least one template name.");

	return names.map((name) => {
		const result = templateSchema.safeParse(name);
		if (!result.success) {
			throw new Error(`Unknown template "${name}". Valid templates: ${templateSchema.options.join(", ")}`);
		}
		return result.data;
	});
};

const readOptionValue = (args: string[], index: number, option: string): string => {
	const value = args[index + 1];
	if (!value || value.startsWith("-")) throw new Error(`${option} requires a value.`);
	return value;
};

const parseThreshold = (value: string): number => {
	const threshold = Number.parseInt(value, 10);
	if (!Number.isFinite(threshold) || threshold < 0) throw new Error(`Invalid threshold "${value}".`);
	return threshold;
};

const parseCompareOptions = (args: string[]): CompareOptions => {
	const positional: string[] = [];
	let leftDirectory = "";
	let rightDirectory = "";
	let threshold = 0;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];

		if (argument === "--left") {
			leftDirectory = resolve(repositoryRoot, readOptionValue(args, index, argument));
			index += 1;
			continue;
		}

		if (argument?.startsWith("--left=")) {
			leftDirectory = resolve(repositoryRoot, argument.slice("--left=".length).trim());
			continue;
		}

		if (argument === "--right") {
			rightDirectory = resolve(repositoryRoot, readOptionValue(args, index, argument));
			index += 1;
			continue;
		}

		if (argument?.startsWith("--right=")) {
			rightDirectory = resolve(repositoryRoot, argument.slice("--right=".length).trim());
			continue;
		}

		if (argument === "--threshold") {
			threshold = parseThreshold(readOptionValue(args, index, argument));
			index += 1;
			continue;
		}

		if (argument?.startsWith("--threshold=")) {
			threshold = parseThreshold(argument.slice("--threshold=".length));
			continue;
		}

		if (argument && !argument.startsWith("-")) {
			positional.push(argument);
			continue;
		}

		throw new Error(`Unknown argument "${argument ?? ""}". Use --help for usage information.`);
	}

	if (!leftDirectory) leftDirectory = positional[0] ? resolve(repositoryRoot, positional[0]) : "";
	if (!rightDirectory) rightDirectory = positional[1] ? resolve(repositoryRoot, positional[1]) : "";

	if (!leftDirectory || !rightDirectory) {
		throw new Error("compare requires two baseline directories: compare <left> <right>.");
	}

	return { leftDirectory, rightDirectory, threshold };
};

const parseSnapshotOptions = (args: string[]): SnapshotOptions => {
	let outputDirectory = resolve(repositoryRoot, "tooling", "baseline", "pre-migration");
	const requestedTemplates: Template[] = [];
	let raster = true;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];

		if (argument === "--out" || argument === "-o") {
			outputDirectory = resolve(repositoryRoot, readOptionValue(args, index, argument));
			index += 1;
			continue;
		}

		if (argument?.startsWith("--out=")) {
			const value = argument.slice("--out=".length).trim();
			if (!value) throw new Error("--out requires a value.");
			outputDirectory = resolve(repositoryRoot, value);
			continue;
		}

		if (argument === "--template" || argument === "-t") {
			requestedTemplates.push(...parseTemplateValue(readOptionValue(args, index, argument)));
			index += 1;
			continue;
		}

		if (argument?.startsWith("--template=")) {
			requestedTemplates.push(...parseTemplateValue(argument.slice("--template=".length)));
			continue;
		}

		if (argument === "--no-raster") {
			raster = false;
			continue;
		}

		throw new Error(`Unknown argument "${argument ?? ""}". Use --help for usage information.`);
	}

	return {
		outputDirectory,
		raster,
		templates: requestedTemplates.length > 0 ? [...new Set(requestedTemplates)] : [...templateSchema.options],
	};
};

const renderTemplate = async (
	template: Template,
	outputDirectory: string,
	raster: boolean,
): Promise<{ sizeBytes: number; pages: number; pageRasterHashes: string[] }> => {
	const filename = `${template}.pdf`;

	try {
		const { createResumePdfFile } = await loadPdfServer();
		const file = await createResumePdfFile({ data: await createBaselineResumeData(), filename, template });
		const bytes = new Uint8Array(await file.arrayBuffer());
		if (!isPdf(bytes)) throw new Error("Renderer returned an empty or invalid PDF buffer.");
		await writeFile(resolve(outputDirectory, filename), bytes);

		if (raster) {
			const pages = await rasterizePdfPages(bytes);
			return {
				sizeBytes: bytes.byteLength,
				pages: pages.length,
				pageRasterHashes: pages.map((page) => page.hash),
			};
		}

		return { sizeBytes: bytes.byteLength, pages: await readPdfPageCount(bytes), pageRasterHashes: [] };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to render template "${template}": ${message}`, { cause: error });
	}
};

const readManifest = async (manifestPath: string): Promise<BaselineManifest> => {
	let raw: string;

	try {
		raw = await readFile(manifestPath, "utf-8");
	} catch (error) {
		// A missing manifest is the normal first-run case, so start from an empty one.
		// Any other read failure is real and must not be swallowed.
		const code = (error as { code?: string } | null)?.code;
		if (code === "ENOENT") return { generatedAt: "", rasterScale, templates: {} };
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Could not read manifest at ${manifestPath}: ${message}`, { cause: error });
	}

	try {
		return JSON.parse(raw) as BaselineManifest;
	} catch (error) {
		// Refuse to continue: treating a corrupt manifest as empty would silently discard
		// the already-recorded baseline entries on the next merge-write.
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Manifest at ${manifestPath} exists but could not be parsed: ${message}. ` +
				"Refusing to continue, because treating it as empty would silently discard recorded entries. " +
				"Fix or delete the file, then re-run.",
			{ cause: error },
		);
	}
};

/** Renders every selected template into the output directory and writes a merged manifest. */
export const createBaselineSnapshot = async (options: SnapshotOptions): Promise<BaselineManifest> => {
	await mkdir(options.outputDirectory, { recursive: true });
	const entries: Record<string, ManifestEntry> = {};

	for (const template of options.templates) {
		console.log(`Rendering ${template}...`);
		const result = await renderTemplate(template, options.outputDirectory, options.raster);
		entries[template] = {
			file: `${template}.pdf`,
			pages: result.pages,
			sizeBytes: result.sizeBytes,
			pageRasterHashes: result.pageRasterHashes,
		};
	}

	const existingManifest = await readManifest(resolve(options.outputDirectory, manifestFilename));

	// Drop entries for templates that no longer exist in the project, so stale records do not
	// linger. Judge against the schema's full template list, NOT the templates requested in this
	// run -- otherwise a filtered run (e.g. -t onyx) would wipe every other entry.
	const knownTemplates = new Set<string>(templateSchema.options);
	const retained: Record<string, ManifestEntry> = {};
	const dropped: string[] = [];

	for (const [name, entry] of Object.entries(existingManifest.templates)) {
		if (knownTemplates.has(name)) retained[name] = entry;
		else dropped.push(name);
	}

	if (dropped.length > 0) {
		console.log(`Dropping stale manifest entries (no longer in template list): ${dropped.join(", ")}`);
	}

	const manifest: BaselineManifest = {
		generatedAt: new Date().toISOString(),
		rasterScale,
		templates: { ...retained, ...entries },
	};
	await writeFile(resolve(options.outputDirectory, manifestFilename), `${JSON.stringify(manifest, null, "\t")}\n`);

	return manifest;
};

const diffPages = (left: RasterizedPage, right: RasterizedPage, threshold: number): PageComparison => {
	if (left.width !== right.width || left.height !== right.height) {
		const pixelCount = Math.max(left.data.length, right.data.length) / 4;
		return {
			pageNumber: 0,
			differingPixels: Math.ceil(pixelCount),
			maxChannelDelta: 255,
		};
	}

	let differingPixels = 0;
	let maxChannelDelta = 0;

	for (let index = 0; index < left.data.length; index += 4) {
		let isDiffering = false;

		// Compare all four channels (RGBA). Alpha is constant with today's rasterizer, but
		// skipping it would silently hide diffs if a future one emits transparency.
		for (let channel = 0; channel < 4; channel += 1) {
			const delta = Math.abs((left.data[index + channel] ?? 0) - (right.data[index + channel] ?? 0));
			if (delta > maxChannelDelta) maxChannelDelta = delta;
			if (delta > threshold) isDiffering = true;
		}

		if (isDiffering) differingPixels += 1;
	}

	return { pageNumber: 0, differingPixels, maxChannelDelta };
};

const listPdfFiles = async (directory: string): Promise<string[]> => {
	try {
		return (await readdir(directory))
			.filter((name) => name.endsWith(".pdf"))
			.map((name) => name.replace(/\.pdf$/, ""))
			.sort();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot read baseline directory "${directory}": ${message}`, { cause: error });
	}
};

const readPdfBytes = async (directory: string, template: string): Promise<Uint8Array> =>
	new Uint8Array(await readFile(resolve(directory, `${template}.pdf`)));

const compareTemplate = async (template: string, options: CompareOptions): Promise<TemplateComparison> => {
	const leftBytes = await readPdfBytes(options.leftDirectory, template);
	const rightBytes = await readPdfBytes(options.rightDirectory, template);
	const leftPages = await rasterizePdfPages(leftBytes);
	const rightPages = await rasterizePdfPages(rightBytes);

	if (leftPages.length !== rightPages.length) {
		return {
			template,
			status: "fail",
			leftPages: leftPages.length,
			rightPages: rightPages.length,
			totalDifferingPixels: 0,
			maxChannelDelta: 0,
			note: `page count differs (${leftPages.length} vs ${rightPages.length})`,
			pages: [],
		};
	}

	const pages: PageComparison[] = [];
	let totalDifferingPixels = 0;
	let maxChannelDelta = 0;

	for (let index = 0; index < leftPages.length; index += 1) {
		const leftPage = leftPages[index];
		const rightPage = rightPages[index];
		if (!leftPage || !rightPage) continue;

		const comparison = diffPages(leftPage, rightPage, options.threshold);
		comparison.pageNumber = index + 1;
		pages.push(comparison);
		totalDifferingPixels += comparison.differingPixels;
		if (comparison.maxChannelDelta > maxChannelDelta) maxChannelDelta = comparison.maxChannelDelta;
	}

	return {
		template,
		status: totalDifferingPixels === 0 && maxChannelDelta <= options.threshold ? "pass" : "fail",
		leftPages: leftPages.length,
		rightPages: rightPages.length,
		totalDifferingPixels,
		maxChannelDelta,
		note: "",
		pages,
	};
};

const missingComparison = (template: string, note: string): TemplateComparison => ({
	template,
	status: "fail",
	leftPages: 0,
	rightPages: 0,
	totalDifferingPixels: 0,
	maxChannelDelta: 0,
	note,
	pages: [],
});

/** Rasterizes both baseline directories and reports per-page pixel differences. */
export const compareBaselines = async (options: CompareOptions): Promise<TemplateComparison[]> => {
	const leftTemplates = await listPdfFiles(options.leftDirectory);
	const rightTemplates = await listPdfFiles(options.rightDirectory);
	const comparisons: TemplateComparison[] = [];

	for (const template of leftTemplates) {
		if (!rightTemplates.includes(template)) {
			comparisons.push(missingComparison(template, "missing in right baseline"));
			continue;
		}

		console.log(`Comparing ${template}...`);
		comparisons.push(await compareTemplate(template, options));
	}

	for (const template of rightTemplates) {
		if (!leftTemplates.includes(template)) {
			comparisons.push(missingComparison(template, "missing in left baseline"));
		}
	}

	return comparisons;
};

const printSnapshotReport = (manifest: BaselineManifest, outputDirectory: string): void => {
	console.log("\nPDF baseline complete.");
	console.log(`Output: ${outputDirectory}`);
	console.log(`Manifest: ${resolve(outputDirectory, manifestFilename)}`);
	console.log("Files:");
	for (const entry of Object.values(manifest.templates)) {
		console.log(
			`  ${entry.file}: ${entry.sizeBytes.toLocaleString("en-US")} bytes, ${entry.pages} page(s), ${entry.pageRasterHashes.length} raster hash(es)`,
		);
	}
};

const printCompareReport = (comparisons: TemplateComparison[], options: CompareOptions): boolean => {
	console.log("\nPDF baseline comparison.");
	console.log(`Left:  ${options.leftDirectory}`);
	console.log(`Right: ${options.rightDirectory}`);
	console.log(`Threshold: ${options.threshold}`);

	for (const comparison of comparisons) {
		if (comparison.note) {
			console.log(`  ${comparison.template}: FAIL (${comparison.note})`);
			continue;
		}

		console.log(
			`  ${comparison.template}: ${comparison.status.toUpperCase()} (pages ${comparison.leftPages}/${comparison.rightPages}, differingPixels ${comparison.totalDifferingPixels}, maxChannelDelta ${comparison.maxChannelDelta})`,
		);
		for (const page of comparison.pages) {
			console.log(
				`    page ${page.pageNumber}: differingPixels ${page.differingPixels}, maxChannelDelta ${page.maxChannelDelta}`,
			);
		}
	}

	const failed = comparisons.filter((comparison) => comparison.status === "fail");
	console.log(`\nResult: ${failed.length === 0 ? "PASS" : `FAIL (${failed.length} template(s) differ)`}`);
	return failed.length === 0;
};

const main = async (): Promise<void> => {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(usage);
		return;
	}

	if (args[0] === "compare") {
		const options = parseCompareOptions(args.slice(1));
		const isPassing = printCompareReport(await compareBaselines(options), options);
		if (!isPassing) process.exitCode = 1;
		return;
	}

	const options = parseSnapshotOptions(args[0] === "snapshot" ? args.slice(1) : args);
	const startedAt = performance.now();
	const manifest = await createBaselineSnapshot(options);
	printSnapshotReport(manifest, options.outputDirectory);
	console.log(`Total elapsed: ${((performance.now() - startedAt) / 1_000).toFixed(2)}s`);
};

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
