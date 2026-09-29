#!/usr/bin/env node
/**
 * M1 · 契约导出
 *
 * 从运行中的 Node 服务（默认 http://localhost:3000/api/openapi/spec.json）拉全量
 * OpenAPI spec，只切出「简历 CRUD + 公开简历页」这一组 operation，落地成一份自包含的
 * services/resume-api/contract/resume-openapi.json。
 *
 * 用法（在 services/resume-api 目录下）：
 *   node tools/export_contract.mjs
 *   node tools/export_contract.mjs --url http://localhost:3000/api/openapi/spec.json
 *   OPENAPI_SPEC_URL=http://host:3000/api/openapi/spec.json node tools/export_contract.mjs
 *
 * 性质：纯 Node ESM，无第三方依赖；幂等（同样的 spec 输入 => 同样的文件字节）。
 * 注意：裸路径 `GET /api/openapi` 是 404，必须带 `/spec.json`（apps/server/src/openapi/handler.ts:26）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = resolve(HERE, "..");
const OUT_PATH = join(SERVICE_ROOT, "contract", "resume-openapi.json");

const DEFAULT_SPEC_URL = "http://localhost:3000/api/openapi/spec.json";

/**
 * 进 Python 的 operationId 白名单 —— 迁移范围只有「简历 CRUD + 公开简历页数据」。
 * 导入解析、管理后台、applications、AI、MCP、统计、Agent、全部鉴权与渲染都留在 Node。
 */
const WANTED_OPERATION_IDS = Object.freeze([
	"listResumes",
	"createResume",
	"getResume",
	"updateResume",
	"patchResume",
	"deleteResume",
	"getResumeBySlug",
]);

const HTTP_METHODS = Object.freeze(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/**
 * 解析命令行参数。
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{url: string, help: boolean}}
 */
function parseArgs(argv) {
	const result = { url: process.env.OPENAPI_SPEC_URL || DEFAULT_SPEC_URL, help: false };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--url") {
			index += 1;
			result.url = argv[index];
			continue;
		}
		if (arg.startsWith("--url=")) {
			result.url = arg.slice("--url=".length);
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			result.help = true;
			continue;
		}
		throw new Error(`未知参数: ${arg}`);
	}
	if (!result.url) throw new Error("spec 地址为空，请传 --url 或设置 OPENAPI_SPEC_URL");
	return result;
}

/**
 * 稳定序列化：对象 key 按字典序排序，保证幂等。
 * @param {unknown} value 任意 JSON 值
 * @returns {string} JSON 片段
 */
function stableStringify(value) {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const body = Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
			.join(",");
		return `{${body}}`;
	}
	return JSON.stringify(value);
}

/**
 * 递归收集一个 JSON 子树里所有 `$ref`。
 * @param {unknown} node 任意 JSON 值
 * @param {Set<string>} refs 收集结果
 * @returns {Set<string>} refs
 */
function collectRefs(node, refs) {
	if (Array.isArray(node)) {
		for (const item of node) collectRefs(item, refs);
		return refs;
	}
	if (node !== null && typeof node === "object") {
		for (const [key, value] of Object.entries(node)) {
			if (key === "$ref" && typeof value === "string") refs.add(value);
			else collectRefs(value, refs);
		}
	}
	return refs;
}

/**
 * 把 `#/components/schemas/Foo` 形式的 $ref 解析成 spec 里的实际对象。
 * @param {Record<string, unknown>} spec 全量 spec
 * @param {string} ref 形如 `#/components/schemas/Foo`
 * @returns {unknown} 目标对象；找不到返回 undefined
 */
function resolveRef(spec, ref) {
	if (!ref.startsWith("#/")) return undefined;
	let current = spec;
	for (const rawSegment of ref.slice(2).split("/")) {
		const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
		if (current === null || typeof current !== "object" || !(segment in current)) return undefined;
		current = current[segment];
	}
	return current;
}

/**
 * 从若干种子 $ref 出发做闭包，收集所有被引用的 components 条目。
 * @param {Record<string, unknown>} spec 全量 spec
 * @param {Iterable<string>} seedRefs 起始 $ref
 * @returns {{entries: Map<string, {group: string, name: string, value: unknown}>, missing: string[]}}
 */
function resolveClosure(spec, seedRefs) {
	const entries = new Map();
	const missing = [];
	const queue = [...seedRefs];
	while (queue.length > 0) {
		const ref = queue.pop();
		if (entries.has(ref)) continue;
		const value = resolveRef(spec, ref);
		if (value === undefined) {
			missing.push(ref);
			continue;
		}
		const segments = ref.slice(2).split("/");
		entries.set(ref, { group: segments[1], name: segments.slice(2).join("/"), value });
		for (const nextRef of collectRefs(value, new Set())) {
			if (!entries.has(nextRef)) queue.push(nextRef);
		}
	}
	return { entries, missing };
}

/**
 * 主流程。
 * @returns {Promise<void>}
 */
async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (args.help) {
		console.log("用法: node tools/export_contract.mjs [--url <openapi spec url>]");
		return;
	}

	console.log(`[export-contract] 拉取全量 spec: ${args.url}`);
	const response = await fetch(args.url);
	if (!response.ok) {
		throw new Error(`拉取 spec 失败: HTTP ${response.status} ${response.statusText} (${args.url})`);
	}
	/** @type {Record<string, any>} */
	const spec = await response.json();
	if (!spec || typeof spec !== "object" || !spec.paths) {
		throw new Error("spec 结构异常：缺少 paths");
	}

	const allPaths = Object.keys(spec.paths || {});
	console.log(`[export-contract] 全量 spec: openapi=${spec.openapi ?? "?"} 共 ${allPaths.length} 个 path`);

	// 1) 按 operationId 白名单切片
	/** @type {Map<string, {method: string, path: string, operation: Record<string, any>}>} */
	const kept = new Map();
	/** @type {{method: string, path: string, operationId: string}[]} */
	const ignored = [];
	/** @type {string[]} */
	const seedRefs = [];
	/** @type {Set<string>} */
	const securitySchemeNames = new Set();

	for (const path of allPaths) {
		const pathItem = spec.paths[path] || {};
		for (const method of HTTP_METHODS) {
			const operation = pathItem[method];
			if (!operation || typeof operation !== "object") continue;
			const operationId = typeof operation.operationId === "string" ? operation.operationId : "";
			if (WANTED_OPERATION_IDS.includes(operationId)) {
				kept.set(operationId, { method, path, operation });
				seedRefs.push(...collectRefs(operation, new Set()));
				for (const requirement of operation.security || []) {
					if (requirement && typeof requirement === "object") {
						for (const name of Object.keys(requirement)) securitySchemeNames.add(name);
					}
				}
			} else {
				ignored.push({ method, path, operationId: operationId || "(无 operationId)" });
			}
		}
	}

	const missingOperationIds = WANTED_OPERATION_IDS.filter((id) => !kept.has(id));
	if (missingOperationIds.length > 0) {
		console.error(
			`[export-contract] 错误：白名单中的 operationId 在 spec 中不存在 -> ${missingOperationIds.join(", ")}`,
		);
		process.exitCode = 1;
		return;
	}

	// 2) 递归内联被引用的 components（schemas / parameters / requestBodies / responses ...）
	//    securitySchemes 不走 $ref，按名称单独收集。
	const allSecuritySchemes = spec.components?.securitySchemes || {};
	for (const name of securitySchemeNames) {
		if (name in allSecuritySchemes) {
			seedRefs.push(`#/components/securitySchemes/${name}`);
		}
	}
	const { entries, missing } = resolveClosure(spec, seedRefs);
	if (missing.length > 0) {
		console.error(`[export-contract] 错误：以下 $ref 无法解析 -> ${missing.join(", ")}`);
		process.exitCode = 1;
		return;
	}

	/** @type {Record<string, Record<string, unknown>>} */
	const groupedComponents = {};
	for (const { group, name, value } of entries.values()) {
		groupedComponents[group] = groupedComponents[group] || {};
		groupedComponents[group][name] = value;
	}

	// 3) 组装输出文档
	/** @type {Record<string, Record<string, unknown>>} */
	const slicedPaths = {};
	for (const { path } of kept.values()) {
		slicedPaths[path] = slicedPaths[path] || {};
	}
	for (const { method, path, operation } of kept.values()) {
		slicedPaths[path][method] = operation;
	}

	const sliced = {
		openapi: spec.openapi ?? "3.1.1",
		info: {
			title: `${spec.info?.title ?? "Reactive Resume"} — Resume CRUD slice`,
			version: spec.info?.version ?? "0.0.0",
			description:
				"由 services/resume-api/tools/export_contract.mjs 从 Node 服务 GET /api/openapi/spec.json 自动切出的子集，只含「简历 CRUD + 公开简历页」这组 operation。这是切片产物，不是权威 spec；权威 spec 始终以运行中的 Node 服务为准。",
			license: spec.info?.license,
		},
		paths: slicedPaths,
		components: groupedComponents,
		"x-slice": {
			sourceSpecUrl: args.url,
			sourceOpenapiVersion: spec.openapi ?? "3.1.1",
			operationIds: [...WANTED_OPERATION_IDS].sort(),
			generator: "services/resume-api/tools/export_contract.mjs",
			note: "M1 契约导出。M4 起 Python 侧按这份契约实现路由。",
		},
	};

	const json = `${stableStringify(sliced).replace(/\n/g, "")}`;
	const pretty = `${JSON.stringify(JSON.parse(json), null, 2)}\n`;
	mkdirSync(dirname(OUT_PATH), { recursive: true });
	writeFileSync(OUT_PATH, pretty, "utf8");

	// 4) 打印「导出了哪些 / 忽略了哪些」
	console.log(`[export-contract] 导出 operationId（${kept.size} 个）：`);
	for (const operationId of WANTED_OPERATION_IDS) {
		const item = kept.get(operationId);
		console.log(`  ${item.method.toUpperCase().padEnd(6)} ${item.path.padEnd(30)} -> ${operationId}`);
	}
	console.log(`[export-contract] 忽略 operation（${ignored.length} 个，全部留在 Node）：`);
	for (const item of ignored.sort((a, b) => `${a.path}${a.method}`.localeCompare(`${b.path}${b.method}`))) {
		console.log(`  ${item.method.toUpperCase().padEnd(6)} ${item.path.padEnd(30)} -> ${item.operationId}`);
	}
	for (const group of Object.keys(groupedComponents).sort()) {
		console.log(`[export-contract] 内联 components.${group}: ${Object.keys(groupedComponents[group]).length} 个`);
	}
	console.log(`[export-contract] 已写入 ${OUT_PATH}（${Buffer.byteLength(pretty, "utf8")} 字节）`);
}

main().catch((error) => {
	console.error(`[export-contract] 失败: ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
