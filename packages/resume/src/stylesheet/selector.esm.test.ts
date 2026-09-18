import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("semantic selector native ESM compatibility", () => {
	it("loads the selector module through Node and tsx", () => {
		const entry = new URL("./selector.ts", import.meta.url).href;
		// The test file lives at `src/stylesheet/`, so two levels up is the package
		// root — where the child process must run for `tsx` to resolve.
		const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
		// Spawn `node --import tsx` rather than `pnpm exec tsx`: on Windows the
		// pnpm shim lives under a path containing a space, which cmd.exe splits
		// in half before it ever resolves.
		const result = spawnSync(process.execPath, ["--import", "tsx", "-e", `import(${JSON.stringify(entry)})`], {
			cwd: packageRoot,
			encoding: "utf8",
		});

		expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
	});
});
