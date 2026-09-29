import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Subsets CJK fonts down to the characters a resume actually needs.
 *
 * react-pdf's `Font.register` fetches a font **whole** and ignores
 * `unicode-range`, so the browser's chunked-webfont trick does nothing on the
 * PDF path: a single Noto Sans SC face is ~10 MiB and a Chinese resume pulls
 * several faces. The only lever that works here is shipping a smaller file,
 * which also makes an offline / intranet install possible.
 *
 * Uses `pyftsubset` from fonttools — deliberately no new npm dependency.
 *
 * Usage:
 *   pnpm --dir tooling exec tsx fonts/subset.ts \
 *     --source ./NotoSansSC-Regular.ttf --source ./NotoSansSC-Bold.ttf \
 *     --family "Noto Sans SC" --charset gb2312
 */

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const defaultOutputDirectory = resolve(repositoryRoot, "apps", "web", "public", "fonts");
const publicDirectory = resolve(repositoryRoot, "apps", "web", "public");
const defaultSuffix = "-subset";
const manifestFilename = "subset-manifest.json";
const replacementCharacter = "\uFFFD";

const usage = `Usage: pnpm --dir tooling exec tsx fonts/subset.ts --source <file> [options]

Subsets TTF/OTF fonts to a target character set with pyftsubset (fonttools).

Options:
  -s, --source <path>     Source TTF/OTF. Repeat once per weight. Required.
  -c, --charset <value>   "gb2312" (6763 Hanzi + ASCII + CJK punctuation),
                          "common3500" (GB2312 level-1, the everyday tier), or
                          a path to a UTF-8 text file holding the characters
                          you want to keep. Default: gb2312.
  -o, --out <dir>         Output directory. Default: apps/web/public/fonts
      --family <name>     Family name, e.g. "Noto Sans SC". Used for the
                          paste-ready override table in the manifest.
      --name <slug>       Output filename base. Default: derived from the
                          source filename (NotoSansSC-Regular.ttf ->
                          noto-sans-sc-regular). Ignored when --source is
                          repeated: each source gets its own slug.
      --suffix <suffix>   Output filename suffix. Default: "-subset".
  -h, --help              Show this help message.

fonttools is required: pip install fonttools brotli`;

type CliOptions = {
	sources: string[];
	charset: string;
	out: string;
	family: string | null;
	name: string | null;
	suffix: string;
	help: boolean;
};

type SubsetResult = {
	family: string | null;
	weight: string | null;
	sourcePath: string;
	sourceBytes: number;
	filename: string;
	outputPath: string;
	publicPath: string;
	bytes: number;
};

type FontOverride = {
	family: string;
	weights: string[];
	files: Record<string, string>;
};

type SubsetManifest = {
	generatedAt: string;
	charset: string;
	charsetSize: number;
	outputDirectory: string;
	files: SubsetResult[];
	totalSourceBytes: number;
	totalBytes: number;
	savedBytes: number;
	overrides: FontOverride[];
};

type CommandResult = {
	status: number | null;
	stdout: string;
	stderr: string;
	error: string | null;
};

const weightByKeyword: Record<string, string> = {
	thin: "100",
	extralight: "100",
	ultralight: "200",
	light: "300",
	regular: "400",
	book: "400",
	normal: "400",
	medium: "500",
	semibold: "600",
	demibold: "600",
	bold: "700",
	extrabold: "800",
	ultrabold: "800",
	black: "900",
	heavy: "900",
};

const parseArgs = (argv: string[]): CliOptions => {
	const options: CliOptions = {
		sources: [],
		charset: "gb2312",
		out: defaultOutputDirectory,
		family: null,
		name: null,
		suffix: defaultSuffix,
		help: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = (): string => {
			const value = argv[index + 1];
			if (value === undefined) throw new Error(`${arg} requires a value.`);
			index += 1;
			return value;
		};

		switch (arg) {
			case "-s":
			case "--source":
				options.sources.push(next());
				break;
			case "-c":
			case "--charset":
				options.charset = next();
				break;
			case "-o":
			case "--out":
				options.out = next();
				break;
			case "--family":
				options.family = next();
				break;
			case "--name":
				options.name = next();
				break;
			case "--suffix":
				options.suffix = next();
				break;
			case "-h":
			case "--help":
				options.help = true;
				break;
			default:
				throw new Error(`Unknown argument: ${arg}\n\n${usage}`);
		}
	}

	return options;
};

/** Wraps a value in double quotes so cmd.exe and POSIX shells keep paths with spaces intact. */
const quote = (value: string): string => `"${value.replace(/(["\\])/g, "\\$1")}"`;

/**
 * Runs a command through the platform shell.
 * Async (not `spawnSync`) because the shell is needed to resolve
 * `pyftsubset.exe` / `pyftsubset.cmd` on Windows.
 */
const runCommand = (program: string, args: string[]): Promise<CommandResult> => {
	const command = [program, ...args.map(quote)].join(" ");

	return new Promise<CommandResult>((resolvePromise) => {
		const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";

		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdout += String(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr += String(chunk);
		});

		child.on("error", (error: Error) => {
			resolvePromise({ status: null, stdout, stderr, error: error.message });
		});

		child.on("close", (status: number | null) => {
			resolvePromise({ status, stdout, stderr, error: null });
		});
	});
};

/** Locates a working pyftsubset. Returns `[program, ...prefixArgs]`, or null. */
const findPyftsubset = async (): Promise<string[] | null> => {
	const candidates: string[][] = [
		["pyftsubset"],
		["python", "-m", "fontTools.subset"],
		["python3", "-m", "fontTools.subset"],
	];

	for (const candidate of candidates) {
		const result = await runCommand(candidate[0] ?? "", [...candidate.slice(1), "--help"]);
		if (result.status === 0) return candidate;
	}

	return null;
};

/** Decodes GB2312 byte pairs (zones `from`..`to`) with whatever decoder this Node build has. */
const decodeGb2312Zones = (fromZone: number, toZone: number): string => {
	const labels = ["gb2312", "gbk", "gb18030"];
	const bytes: number[] = [];

	for (let zone = fromZone; zone <= toZone; zone += 1) {
		for (let position = 0xa1; position <= 0xfe; position += 1) {
			bytes.push(zone, position);
		}
	}

	for (const label of labels) {
		try {
			return new TextDecoder(label).decode(new Uint8Array(bytes));
		} catch {
			// Try the next label.
		}
	}

	throw new Error(
		"This Node build cannot decode GB2312 (no TextDecoder support for gb2312/gbk/gb18030).\n" +
			"Pass a custom charset file instead: --charset ./my-characters.txt",
	);
};

/** Codepoints a Chinese resume needs beyond Hanzi: ASCII, CJK punctuation, full-width forms. */
const getCommonPunctuation = (): string => {
	const characters: string[] = [];

	for (let codePoint = 0x20; codePoint <= 0x7e; codePoint += 1) characters.push(String.fromCodePoint(codePoint));
	for (let codePoint = 0x3000; codePoint <= 0x303f; codePoint += 1) characters.push(String.fromCodePoint(codePoint));
	for (let codePoint = 0xff00; codePoint <= 0xffef; codePoint += 1) {
		// U+FFFD..U+FFFF are not real glyphs.
		if (codePoint >= 0xfffd) continue;
		characters.push(String.fromCodePoint(codePoint));
	}

	return characters.join("");
};

const dedupe = (characters: string): string =>
	[
		...new Set([...characters].filter((character) => character !== replacementCharacter && character !== "\u0000")),
	].join("");

const buildCharset = (charset: string): string => {
	if (charset === "gb2312") {
		// Zones 16-87 (0xB0-0xF7) hold all 6763 GB2312 Hanzi.
		return dedupe(decodeGb2312Zones(0xb0, 0xf7) + getCommonPunctuation());
	}

	if (charset === "common3500") {
		// GB2312 level-1 (zones 16-55) — the everyday-use tier conventionally
		// referred to as the "common 3500 characters".
		return dedupe(decodeGb2312Zones(0xb0, 0xd7) + getCommonPunctuation());
	}

	const charsetPath = resolve(process.cwd(), charset);
	if (!existsSync(charsetPath)) {
		throw new Error(`--charset must be "gb2312", "common3500" or an existing text file. Not found: ${charsetPath}`);
	}

	return dedupe(readFileSync(charsetPath, "utf8"));
};

const toSlug = (value: string): string =>
	value
		.replace(/\.[a-z0-9]+$/i, "")
		.replace(/([a-z\d])([A-Z])/g, "$1-$2")
		.replace(/[_\s]+/g, "-")
		.toLowerCase();

const inferWeight = (filename: string): string | null => {
	const explicit = /(?:^|[^a-z\d])(100|200|300|400|500|600|700|800|900)(?:[^a-z\d]|$)/i.exec(filename);
	if (explicit?.[1]) return explicit[1];

	for (const [keyword, weight] of Object.entries(weightByKeyword)) {
		if (new RegExp(`(?:^|[^a-z])${keyword}(?:[^a-z]|$)`, "i").test(filename)) return weight;
	}

	return null;
};

/** Web path for a file, derived from its position under apps/web/public when possible. */
const toPublicPath = (filePath: string): string => {
	const relativePath = relative(publicDirectory, filePath);
	if (!relativePath.startsWith("..")) return `/${relativePath.split("\\").join("/")}`;
	return `/${basename(filePath)}`;
};

const buildOverrides = (family: string | null, results: SubsetResult[]): FontOverride[] => {
	if (!family || results.length === 0) return [];

	const files: Record<string, string> = {};
	const weights: string[] = [];

	for (const result of results) {
		if (!result.weight) continue;
		files[result.weight] = result.publicPath;
		weights.push(result.weight);
	}

	return [{ family, weights: [...new Set(weights)].sort(), files }];
};

const run = async (): Promise<void> => {
	const options = parseArgs(process.argv.slice(2));

	if (options.help) {
		console.log(usage);
		return;
	}

	if (options.sources.length === 0) throw new Error(`At least one --source is required.\n\n${usage}`);

	const outputDirectory = resolve(process.cwd(), options.out);
	const characters = buildCharset(options.charset);
	if (characters.length === 0) throw new Error("The target character set is empty — nothing to subset.");

	const subsetter = await findPyftsubset();
	if (!subsetter) {
		throw new Error(
			[
				"pyftsubset (fonttools) was not found on this machine.",
				"",
				"Install it with:",
				"  pip install fonttools brotli",
				"",
				"On Windows, if pip installed it outside PATH, this script also accepts",
				"  python -m fontTools.subset  (make sure `python` is on PATH)",
				"",
				"Nothing was written — re-run this command after installing.",
			].join("\n"),
		);
	}

	console.log(`Subsetter: ${subsetter.join(" ")}`);
	console.log(`Character set: ${options.charset} (${characters.length} characters)`);

	mkdirSync(outputDirectory, { recursive: true });

	const temporaryDirectory = mkdtempSync(join(tmpdir(), "rr-subset-"));
	const charsetFile = join(temporaryDirectory, "charset.txt");
	writeFileSync(charsetFile, characters, "utf8");

	const results: SubsetResult[] = [];

	try {
		for (const source of options.sources) {
			const sourcePath = resolve(process.cwd(), source);
			if (!existsSync(sourcePath)) throw new Error(`Source font not found: ${sourcePath}`);

			const sourceBytes = statSync(sourcePath).size;
			const slug = options.name ?? toSlug(basename(source));
			const filename = `${slug}${options.suffix}${extname(source) || ".ttf"}`;
			const outputPath = join(outputDirectory, filename);

			const result = await runCommand(subsetter[0] ?? "", [
				...subsetter.slice(1),
				sourcePath,
				`--text-file=${charsetFile}`,
				`--output-file=${outputPath}`,
				"--no-hinting",
				"--desubroutinize",
				"--drop-tables+=DSIG",
			]);

			if (result.error) throw new Error(`Failed to run pyftsubset: ${result.error}`);
			if (result.status !== 0) {
				const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
				throw new Error(
					`pyftsubset failed for ${basename(sourcePath)} (exit ${result.status}).\n${detail || "(no output)"}`,
				);
			}

			if (!existsSync(outputPath)) {
				throw new Error(`pyftsubset reported success but produced no file at ${outputPath}`);
			}

			const bytes = statSync(outputPath).size;
			if (bytes === 0) throw new Error(`pyftsubset produced an empty file at ${outputPath}`);

			const weight = inferWeight(basename(source));
			if (!weight) {
				console.warn(`  ! could not infer a weight from "${basename(source)}" — add it to the override table by hand.`);
			}

			console.log(`  ${filename}: ${sourceBytes} B -> ${bytes} B`);

			if (bytes >= sourceBytes) {
				console.warn(
					`  ! ${filename} is not smaller than its source (${sourceBytes} B). ` +
						"Check that the source really contains these characters.",
				);
			}

			results.push({
				family: options.family,
				weight,
				sourcePath,
				sourceBytes,
				filename,
				outputPath,
				publicPath: toPublicPath(outputPath),
				bytes,
			});
		}
	} finally {
		rmSync(temporaryDirectory, { recursive: true, force: true });
	}

	const totalSourceBytes = results.reduce((total, result) => total + result.sourceBytes, 0);
	const totalBytes = results.reduce((total, result) => total + result.bytes, 0);
	const overrides = buildOverrides(options.family, results);

	const manifest: SubsetManifest = {
		generatedAt: new Date().toISOString(),
		charset: options.charset,
		charsetSize: characters.length,
		outputDirectory,
		files: results,
		totalSourceBytes,
		totalBytes,
		savedBytes: totalSourceBytes - totalBytes,
		overrides,
	};

	const manifestPath = join(outputDirectory, manifestFilename);
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

	console.log("");
	console.log(`Total: ${totalSourceBytes} B -> ${totalBytes} B (saved ${manifest.savedBytes} B)`);
	console.log(`Manifest: ${manifestPath}`);
	console.log("");
	console.log("Paste this into packages/fonts/src/self-hosted.ts -> selfHostedFontOverrides:");
	console.log(JSON.stringify(overrides, null, 2));
};

try {
	await run();
} catch (error) {
	console.error(`\n${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
}
