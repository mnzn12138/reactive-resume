import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { Template } from "@reactive-resume/schema/templates";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { templateSchema } from "@reactive-resume/schema/templates";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, "../..");

const requireFromPdfPackage = (name: string) => createRequire(join(repositoryRoot, "packages/pdf/package.json"))(name);

const JPEG_SCALE = 1.5;

const domesticCustomFields = [
	{ id: "cn-gender", icon: "user", text: "性别：男", link: "" },
	{ id: "cn-birth", icon: "user", text: "出生年月：1998-06", link: "" },
	{ id: "cn-ethnicity", icon: "user", text: "民族：汉族", link: "" },
	{ id: "cn-political", icon: "user", text: "政治面貌：中共党员", link: "" },
	{ id: "cn-native", icon: "user", text: "籍贯：浙江杭州", link: "" },
] as const;

const dataUrlForPicture = async (path: string): Promise<string> => {
	const absolute = resolve(repositoryRoot, path.replace(/^\//, "apps/web/public/"));
	const bytes = await readFile(absolute);
	return `data:image/jpeg;base64,${bytes.toString("base64")}`;
};

const createChinesePreviewData = async (template: Template): Promise<ResumeData> => {
	const data = structuredClone(sampleResumeData) as ResumeData;

	if (data.picture.url.startsWith("/")) {
		data.picture.url = await dataUrlForPicture(data.picture.url);
	}

	data.basics.name = "张伟";
	data.basics.headline = "软件工程师";
	data.basics.location = "中国 · 上海";

	if (template === "xuanwu") {
		data.basics.customFields = [...domesticCustomFields];
	} else {
		data.basics.customFields = [{ id: "cn-github", icon: "github-logo", text: "github.com/zhangwei", link: "" }];
	}

	return data;
};

const renderPdf = async (data: ResumeData, template: Template): Promise<Uint8Array> => {
	// The repository keeps JSX as "preserve", and tsx transpiles it with the classic
	// React transform. Provide React globally before loading the PDF package so the
	// rendered component tree does not throw "React is not defined".
	const runtimeGlobal = globalThis as typeof globalThis & { React?: unknown };
	runtimeGlobal.React ??= requireFromPdfPackage("react");

	const { createResumePdfFile } = await import("@reactive-resume/pdf/server");
	const file = await createResumePdfFile({ data, filename: `${template}.pdf`, template });
	return new Uint8Array(await file.arrayBuffer());
};

const renderFirstPageJpeg = async (bytes: Uint8Array): Promise<Uint8Array> => {
	const { createCanvas } = requireFromPdfPackage("@napi-rs/canvas") as {
		createCanvas: (
			width: number,
			height: number,
		) => {
			getContext: (type: "2d") => {
				getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8Array };
			};
			encode: (format: string, quality?: number) => Promise<Buffer>;
		};
	};

	const loadingTask = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
	const document = await loadingTask.promise;
	const page = await document.getPage(1);

	try {
		const viewport = page.getViewport({ scale: JPEG_SCALE });
		const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
		const context = canvas.getContext("2d");

		await page.render({ canvas, canvasContext: context, viewport }).promise;

		const jpeg = await canvas.encode("jpeg", 0.92);
		return new Uint8Array(jpeg);
	} finally {
		page.cleanup();
		await loadingTask.destroy();
	}
};

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const generateForTemplate = async (template: Template): Promise<void> => {
	console.log(`[template-preview] rendering ${template}...`);

	const data = await createChinesePreviewData(template);
	const pdf = await renderPdf(data, template);
	const jpeg = await renderFirstPageJpeg(pdf);

	await mkdir(join(repositoryRoot, "apps/web/public/templates/pdf"), { recursive: true });
	await mkdir(join(repositoryRoot, "apps/web/public/templates/jpg"), { recursive: true });

	const pdfPath = join(repositoryRoot, "apps/web/public/templates/pdf", `${template}.pdf`);
	const jpgPath = join(repositoryRoot, "apps/web/public/templates/jpg", `${template}.jpg`);

	await writeFile(pdfPath, pdf);
	await writeFile(jpgPath, jpeg);

	console.log(
		`[template-preview] ${template}: pdf ${pdf.byteLength} bytes (${sha256(pdf).slice(0, 16)}...), jpg ${jpeg.byteLength} bytes (${sha256(jpeg).slice(0, 16)}...)`,
	);
};

const parseTemplateNames = (raw: string): Template[] =>
	raw.split(",").map((name) => {
		const parsed = templateSchema.safeParse(name.trim());
		if (!parsed.success) throw new Error(`Unknown template "${name.trim()}"`);
		return parsed.data;
	});

const main = async (): Promise<void> => {
	const args = process.argv.slice(2);
	const templates =
		args.length > 0 ? args.flatMap((arg) => parseTemplateNames(arg)) : (["zhuque", "qinglong", "xuanwu"] as Template[]);

	const seen = new Set<Template>();
	for (const template of templates) {
		if (seen.has(template)) continue;
		seen.add(template);
		await generateForTemplate(template);
	}
};

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
