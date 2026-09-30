// M6 · 环境变量一致性检查（Node ↔ Python）。
//
// 为什么要有这个脚本：总纲对 M6 的验收原话是「两边环境变量名必须一字不差（尤其
// `AUTH_SECRET`）」。这句话靠人眼比对 `app/config.py` 和 `packages/env/src/server.ts`
// 是守不住的 —— 两份文件都在长，漏一次就要到 PDF 下载 502 才暴露，而 502 的现象又
// 完全看不出是密钥配错了（Node 验签失败返 401，Python 翻成 502，见
// `docs/env-parity.md` §2.1）。所以把它做成一条命令，能进 CI 当门禁。
//
// 它回答三个问题：
//   1. Python 侧声明的每个环境变量，Node 侧有没有同名同语义的？
//   2. `AUTH_SECRET` / `DATABASE_URL` 这两个「必须一致」的项，名字与取值是否都对得上？
//   3. 有没有踩到 `PORT` 那个「同名不同义」的陷阱？
//
// 默认模式只做**文本解析**：不需要 Node 侧能跑，也不需要 Python venv，所以可以放进 CI。
// `--values` 会额外真起两边进程读一次 `AUTH_SECRET`，只比对 sha256 摘要、不打印明文 ——
// 名字一样而值不一样，恰恰是这个脚本唯一证明不了、又最致命的情况。
//
// 跑法：
//   node services/resume-api/tools/check_env_parity.mjs
//   node services/resume-api/tools/check_env_parity.mjs --strict   # 任何非「一致」都算失败
//   node services/resume-api/tools/check_env_parity.mjs --values    # 额外比对 AUTH_SECRET 实际取值
//
// 退出码：0 = 通过；1 = 用法错误；2 = 一致性检查失败。

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICE_ROOT = dirname(HERE);
const REPO_ROOT = dirname(dirname(SERVICE_ROOT));

const PYTHON_CONFIG = join(SERVICE_ROOT, "app", "config.py");
const PYTHON_CONFTEST = join(SERVICE_ROOT, "tests", "conftest.py");
const NODE_ENV_SCHEMA = join(REPO_ROOT, "packages", "env", "src", "server.ts");
const NODE_SERVER_ENTRY = join(REPO_ROOT, "apps", "server", "src", "index.ts");
const REPO_DOTENV = join(REPO_ROOT, ".env");

const MANAGED_PYTHON = "C:/Users/22586/.workbuddy/binaries/python/envs/reactive-resume/Scripts/python.exe";

// 两边必须**同名同值**的项。`AUTH_SECRET` 是硬失败项：它是 PDF 下载令牌的 HMAC-SHA256
// 密钥，两边不一致时 Node 返 401、Python 翻成 502，现象上完全看不出是配置错了。
const REQUIRED_SHARED = ["AUTH_SECRET", "DATABASE_URL"];

// Python 侧独有的项不是缺陷，是「Node 自己不需要知道这件事」。写清楚原因，
// 免得下一个人为了「对齐」去 Node 侧凭空补一个同名变量。
const PYTHON_ONLY_RATIONALE = {
	NODE_RENDER_BASE_URL: "Node 自己就是渲染方，不需要知道自己的地址；Python 要转发 PDF 渲染请求，所以得知道 Node 在哪",
	NODE_RENDER_TIMEOUT_SECONDS: "同上，Python 独有。默认 120 秒是因为实测 Node 冷启动首次渲染要 58 秒（要拉 CJK 字体）",
	RESUME_API_TEST_DATABASE_URL: "仅 pytest 用（tests/conftest.py），把测试指向临时库，避免误写生产库",
};

// `PORT` 是同名不同义的陷阱：Python 用它当 uvicorn 端口（默认 4000），Node dev 下根本
// 不读它（读 `SERVER_PORT`），只有 `NODE_ENV=production` 才裸读 `process.env.PORT`。
// 见 `docs/env-parity.md` §3。
const NODE_RUNTIME_READ = {
	PORT: `${NODE_SERVER_ENTRY.replace(`${REPO_ROOT}\\`, "")}:21-22 裸读 process.env.PORT，仅 NODE_ENV=production；dev 下读 SERVER_PORT`,
};

const PYTHON_USAGE = {
	DATABASE_URL: "SQLAlchemy 连接串（postgresql+psycopg://）",
	AUTH_SECRET: "限流 HMAC pepper + **PDF 下载令牌签名密钥**",
	PORT: "uvicorn 监听端口（默认 4000）",
	NODE_RENDER_BASE_URL: "转发 PDF 渲染请求的目标地址",
	NODE_RENDER_TIMEOUT_SECONDS: "单次渲染转发的超时秒数",
	RESUME_API_TEST_DATABASE_URL: "pytest 测试库连接串",
};

function usage() {
	console.error(
		"usage: check_env_parity.mjs [--strict] [--values]\n" +
			"  (default)  只解析两边源码 + 仓库根 .env，比对变量名\n" +
			"  --strict   任何非「一致」的分类都算失败\n" +
			"  --values   额外真起 Node 与 Python 进程，比对 AUTH_SECRET 的取值（只比 sha256 摘要）",
	);
	process.exit(1);
}

/** 从 Python 源码里抽出它读的环境变量名。 */
function extractPythonEnvNames(filePath) {
	const source = readFileSync(filePath, "utf8");
	const names = new Set();
	const pattern = /os\.environ(?:\.get|\.setdefault)?\s*[[(]\s*["']([A-Z][A-Z0-9_]*)["']/g;
	for (const match of source.matchAll(pattern)) names.add(match[1]);
	return [...names].sort();
}

/**
 * 从 `{` 开始找到配对的 `}`。
 *
 * 为什么要自己配平而不是正则取到下一个 `}`：server.ts 里 `z.url({ protocol: /https?/ })`
 * 这类写法自带嵌套括号，简单的「数到 depth 归零」也会算错 —— 还得跳过字符串与注释里的
 * 大括号。这里做一个够用的扫描器（本项目没有在正则字面量里写大括号）。
 */
function findMatchingBrace(source, open) {
	let depth = 0;
	let index = open;

	while (index < source.length) {
		const char = source[index];

		if (char === "/" && source[index + 1] === "/") {
			const newline = source.indexOf("\n", index);
			index = newline < 0 ? source.length : newline;
			continue;
		}

		if (char === "/" && source[index + 1] === "*") {
			const close = source.indexOf("*/", index + 2);
			index = close < 0 ? source.length : close + 2;
			continue;
		}

		if (char === '"' || char === "'" || char === "`") {
			let cursor = index + 1;
			while (cursor < source.length) {
				if (source[cursor] === "\\") {
					cursor += 2;
					continue;
				}
				if (source[cursor] === char) break;
				cursor++;
			}
			index = cursor + 1;
			continue;
		}

		if (char === "{") depth++;
		else if (char === "}") {
			depth--;
			if (depth === 0) return index;
		}

		index++;
	}

	return -1;
}

/** 从 `packages/env/src/server.ts` 的 `server: { ... }` 里抽出顶层变量名。 */
function extractNodeEnvNames() {
	const source = readFileSync(NODE_ENV_SCHEMA, "utf8");
	const start = source.search(/server:\s*\{/);
	if (start < 0) {
		throw new Error(`在 ${NODE_ENV_SCHEMA} 里找不到 \`server: {\`，zod schema 结构变了？`);
	}

	const open = source.indexOf("{", start);
	const close = findMatchingBrace(source, open);
	if (close < 0) throw new Error(`${NODE_ENV_SCHEMA} 的 server 对象括号不配平`);

	// server 对象的 key 是**两个 tab**缩进（Biome 格式化保证），用它区分顶层与嵌套。
	const body = source.slice(open + 1, close);
	const names = new Set();
	for (const match of body.matchAll(/^\t\t([A-Z][A-Z0-9_]*):/gm)) names.add(match[1]);

	if (names.size === 0) {
		throw new Error(`${NODE_ENV_SCHEMA} 里一个顶层变量都没抽出来 —— 缩进约定可能变了（原本是两个 tab）`);
	}

	return [...names].sort();
}

/** 读 `KEY=VALUE` 形式的 .env，剥掉包裹的引号。 */
function readDotEnv(filePath) {
	const values = new Map();
	if (!existsSync(filePath)) return values;

	for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		const separator = line.indexOf("=");
		if (separator < 0) continue;

		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		for (const quote of ['"', "'"]) {
			if (value.startsWith(quote) && value.endsWith(quote) && value.length >= 2) {
				value = value.slice(1, -1);
			}
		}
		values.set(key, value);
	}

	return values;
}

/** 编辑距离，用来找「疑似差一个字」的名字（只作提示，不当失败）。 */
function editDistance(left, right) {
	const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

	for (let i = 1; i <= left.length; i++) {
		let diagonal = previous[0];
		previous[0] = i;
		for (let j = 1; j <= right.length; j++) {
			const temp = previous[j];
			previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
			diagonal = temp;
		}
	}

	return previous[right.length];
}

function digest(value) {
	return createHash("sha256")
		.update(value ?? "")
		.digest("hex")
		.slice(0, 12);
}

/**
 * 异步跑一条命令并拿到 stdout。
 *
 * 为什么不用 `spawnSync`：Windows 上 `spawnSync`/`execFileSync` 在某些宿主环境里会以
 * `EBUSY` 直接失败（同步等待会占住 stdio 管道），而异步 `spawn` 不受影响。这个脚本要能
 * 在 CI 和本机都跑起来，所以走异步 + `await`。
 */
function runCommand(command, args, cwd) {
	return new Promise((resolve) => {
		const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			resolve({ ok: false, stdout: "", stderr: error.message });
		});
		child.on("close", (code) => {
			resolve({ ok: code === 0, stdout, stderr });
		});
	});
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const compareValues = args.includes("--values");
const unknown = args.filter((arg) => !arg.startsWith("--") || !["--strict", "--values"].includes(arg));
if (unknown.length > 0) usage();

let pythonNames;
let nodeNames;
try {
	pythonNames = extractPythonEnvNames(PYTHON_CONFIG);
	nodeNames = extractNodeEnvNames();
} catch (error) {
	console.error(`读取失败：${error.message}`);
	process.exit(2);
}

// conftest.py 里读的变量单列：它只在 pytest 里生效，不属于运行期配置。
const testOnlyNames = extractPythonEnvNames(PYTHON_CONFTEST).filter((name) => !pythonNames.includes(name));
const allPythonNames = [...pythonNames, ...testOnlyNames];

const nodeSet = new Set([...nodeNames, ...Object.keys(NODE_RUNTIME_READ)]);
const dotenv = readDotEnv(REPO_DOTENV);

console.log("=== 环境变量一致性检查（Node ↔ Python）===");
console.log(`Python 侧来源: app/config.py（${pythonNames.length} 项）`);
if (testOnlyNames.length > 0) {
	console.log(`               tests/conftest.py（仅测试，${testOnlyNames.length} 项）`);
}
console.log(`Node   侧来源: packages/env/src/server.ts（${nodeNames.length} 项）`);
console.log(`               apps/server/src/index.ts 裸读 ${Object.keys(NODE_RUNTIME_READ).join(", ")}`);
console.log(`共享配置源   : ${existsSync(REPO_DOTENV) ? ".env（两边读同一份）" : ".env **不存在**"}`);
console.log("");

const rows = [];
let matched = 0;
let pythonOnly = 0;
let diverged = 0;

for (const name of allPythonNames) {
	const isTestOnly = testOnlyNames.includes(name);
	const usageText = PYTHON_USAGE[name] ?? "（未见登记用途）";

	if (nodeSet.has(name)) {
		const note = NODE_RUNTIME_READ[name];
		if (note) {
			// 名字对上了，但两边解释的不是同一件事 —— 这类最容易被当成「一致」而放过。
			diverged++;
			rows.push([name, "同名不同义", `${usageText}；但 Node 侧：${note}`]);
		} else {
			matched++;
			rows.push([name, "一致", `${usageText}；Node 侧同名：${name}`]);
		}
		continue;
	}

	const suspects = nodeNames.filter((candidate) => editDistance(name, candidate) <= 2);
	if (suspects.length > 0) {
		diverged++;
		rows.push([name, "名字不一致", `${usageText}；Node 侧没有同名项，疑似：${suspects.join(", ")}`]);
		continue;
	}

	pythonOnly++;
	const rationale = PYTHON_ONLY_RATIONALE[name] ?? "Python 侧独有（未登记原因）";
	rows.push([name, isTestOnly ? "Python 侧独有（仅测试）" : "Python 侧独有", rationale]);
}

const NAME_WIDTH = Math.max(...rows.map((row) => row[0].length), 8);
console.log(`${"变量".padEnd(NAME_WIDTH)}  判定                  说明`);
console.log("-".repeat(Math.max(NAME_WIDTH + 60, 80)));
for (const [name, verdict, note] of rows) {
	console.log(`${name.padEnd(NAME_WIDTH)}  ${verdict.padEnd(20)}  ${note}`);
}
console.log("");

const nodeOnly = nodeNames.filter((name) => !allPythonNames.includes(name));
console.log(`Node 侧独有 ${nodeOnly.length} 项（属「尚未迁移的能力」，**不要**为了对齐在 Python 侧新增）:`);
console.log(`  ${nodeOnly.slice(0, 24).join(", ")}${nodeOnly.length > 24 ? `, …另 ${nodeOnly.length - 24} 项` : ""}`);
console.log("");

// --- 硬校验 ---------------------------------------------------------------

const failures = [];

for (const name of REQUIRED_SHARED) {
	if (!nodeSet.has(name)) {
		failures.push(`${name}：Node 侧没有同名变量 —— 两边必须一字不差`);
		continue;
	}

	const value = process.env[name] ?? dotenv.get(name) ?? "";
	if (!value) {
		failures.push(`${name}：在仓库根 .env 里缺失或为空 —— Node 的 zod 要求 min(1)，Python 侧拿空串签令牌会直接报错`);
	}
}

// --- PORT 陷阱告警（不失败，但必须看见） -----------------------------------

const portValue = process.env.PORT ?? dotenv.get("PORT") ?? "4000";
const serverPort = process.env.SERVER_PORT ?? dotenv.get("SERVER_PORT") ?? "3001";
const appUrlPort = (dotenv.get("APP_URL") ?? "").match(/:(\d+)\s*$/)?.[1] ?? "";

const portWarnings = [];
if (portValue === serverPort) {
	portWarnings.push(`与 SERVER_PORT=${serverPort} 相同（Node dev 的实际监听端口）`);
}
if (appUrlPort && portValue === appUrlPort) {
	portWarnings.push(`与 APP_URL 的端口 ${appUrlPort} 相同（前端 dev 端口）`);
}
if (portWarnings.length > 0) {
	console.log(`⚠ PORT=${portValue} ${portWarnings.join("；")}`);
	console.log(
		"  → Python 从 .env 继承了这个 PORT，直接起 uvicorn 会和 Node/前端抢端口（EADDRINUSE）。\n" +
			"    启动时必须显式覆盖：PORT=4000 <起服务命令>",
	);
	console.log("");
}

// --- --values：名字一样而值不一样，是名字比对唯一证明不了的情况 --------------

if (compareValues) {
	console.log("=== AUTH_SECRET 取值比对（只比 sha256 摘要，不打印明文）===");

	const python = await runCommand(
		MANAGED_PYTHON,
		["-c", "from app.config import get_settings; print(get_settings().auth_secret, end='')"],
		SERVICE_ROOT,
	);

	// 必须从 apps/server 发起：`@reactive-resume/env/server` 只在那里解析得到 ——
	// 这一点 tools/verify_pdf_token_parity.mjs 的注释里也强调过。
	const node = await runCommand(
		"node",
		[
			"--import",
			"tsx",
			"-e",
			"import {env} from '@reactive-resume/env/server'; process.stdout.write(env.AUTH_SECRET ?? '')",
		],
		join(REPO_ROOT, "apps", "server"),
	);

	const pythonSecret = python.ok ? python.stdout : null;
	const nodeSecret = node.ok ? node.stdout : null;

	if (pythonSecret === null) {
		console.log(`  Python 侧: SKIP（跑不动托管 venv ${MANAGED_PYTHON}）`);
		console.log(`             ${python.stderr.trim().split("\n")[0] ?? ""}`);
	} else {
		console.log(`  Python 侧: ${digest(pythonSecret)}（长度 ${pythonSecret.length}）`);
	}

	if (nodeSecret === null) {
		console.log("  Node   侧: SKIP（node --import tsx 起不来；确认 apps/server 装了 tsx）");
		console.log(`             ${node.stderr.trim().split("\n")[0] ?? ""}`);
	} else {
		console.log(`  Node   侧: ${digest(nodeSecret)}（长度 ${nodeSecret.length}）`);
	}

	if (pythonSecret !== null && nodeSecret !== null) {
		// 比摘要而不是比原文：两边 stdout 都可能被平台追加换行，而摘要已经在上面打印出来了，
		// 「脚本说的」和「脚本判的」必须一致，否则排查的人会被自己骗。
		if (digest(pythonSecret) === digest(nodeSecret)) {
			console.log("  结论: 一致 ✅（两边读的是同一个值）");
		} else {
			failures.push("AUTH_SECRET：两边**取值**不一致 —— PDF 令牌签名会对不上，Node 返 401 / Python 翻成 502");
		}
	} else {
		console.log("  结论: SKIP（有一侧没跑起来，本轮只完成了变量名比对）");
	}
	console.log("");
}

// --- 结论 ---------------------------------------------------------------

if (strict && (pythonOnly > 0 || diverged > 0)) {
	failures.push(`--strict：存在 ${pythonOnly} 项 Python 独有、${diverged} 项不一致`);
}

console.log(`结论：一致 ${matched} 项，Python 侧独有 ${pythonOnly} 项，同名不同义/名字不一致 ${diverged} 项`);

if (failures.length > 0) {
	console.error("");
	for (const failure of failures) console.error(`✗ ${failure}`);
	process.exit(2);
}

console.log("✅ 通过：两边环境变量名一字不差（AUTH_SECRET / DATABASE_URL 均已核对）");
if (!compareValues) {
	console.log("   提示：加 --values 可再核对一次 AUTH_SECRET 的实际取值。");
}
process.exit(0);
