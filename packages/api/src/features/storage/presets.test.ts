import { describe, expect, it } from "vitest";
import { describeStorageChannel, resolveStoragePreset } from "./presets";

describe("resolveStoragePreset", () => {
	describe("阿里云 OSS", () => {
		it("uses the virtual-hosted preset and the default region when nothing is supplied", () => {
			const result = resolveStoragePreset({ provider: "oss" });

			expect(result).toEqual({
				endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
				region: "oss-cn-hangzhou",
				forcePathStyle: false,
				kind: "oss",
				conflict: undefined,
			});
		});

		it("keeps virtual-hosted style even when the operator asked for path style", () => {
			const result = resolveStoragePreset({ provider: "oss", explicitForcePathStyle: true });

			expect(result.forcePathStyle).toBe(false);
			expect(result.endpoint).toBe("https://oss-cn-hangzhou.aliyuncs.com");
		});

		it("builds the endpoint from the region id", () => {
			const result = resolveStoragePreset({ provider: "oss", region: "oss-cn-shenzhen" });

			expect(result.endpoint).toBe("https://oss-cn-shenzhen.aliyuncs.com");
			expect(result.region).toBe("oss-cn-shenzhen");
		});

		it("accepts a bare city region and still produces a valid endpoint", () => {
			const result = resolveStoragePreset({ provider: "oss", region: "cn-beijing" });

			expect(result.endpoint).toBe("https://oss-cn-beijing.aliyuncs.com");
		});
	});

	describe("腾讯云 COS", () => {
		it("uses the path-style preset and the default region when nothing is supplied", () => {
			const result = resolveStoragePreset({ provider: "cos" });

			expect(result).toEqual({
				endpoint: "https://cos.ap-guangzhou.myqcloud.com",
				region: "ap-guangzhou",
				forcePathStyle: true,
				kind: "cos",
				conflict: undefined,
			});
		});

		it("builds the endpoint from the supplied region", () => {
			const result = resolveStoragePreset({ provider: "cos", region: "ap-shanghai" });

			expect(result.endpoint).toBe("https://cos.ap-shanghai.myqcloud.com");
			expect(result.region).toBe("ap-shanghai");
			expect(result.forcePathStyle).toBe(true);
		});
	});

	describe("华为云 OBS", () => {
		it("uses the path-style preset and the default region when nothing is supplied", () => {
			const result = resolveStoragePreset({ provider: "obs" });

			expect(result).toEqual({
				endpoint: "https://obs.cn-north-4.myhuaweicloud.com",
				region: "cn-north-4",
				forcePathStyle: true,
				kind: "obs",
				conflict: undefined,
			});
		});

		it("builds the endpoint from the supplied region", () => {
			const result = resolveStoragePreset({ provider: "obs", region: "cn-east-3" });

			expect(result.endpoint).toBe("https://obs.cn-east-3.myhuaweicloud.com");
			expect(result.region).toBe("cn-east-3");
		});
	});

	describe("explicit S3_ENDPOINT always wins", () => {
		it("uses the explicit endpoint and reports a conflict against the oss preset", () => {
			const result = resolveStoragePreset({
				provider: "oss",
				region: "oss-cn-hangzhou",
				explicitEndpoint: "https://oss-internal.aliyuncs.com",
			});

			expect(result.endpoint).toBe("https://oss-internal.aliyuncs.com");
			expect(result.conflict).toBe(
				"已显式设置 S3_ENDPOINT(https://oss-internal.aliyuncs.com),与 oss 预设(https://oss-cn-hangzhou.aliyuncs.com)不一致,按显式值处理",
			);
		});

		it("uses the explicit endpoint and reports a conflict against the cos preset", () => {
			const result = resolveStoragePreset({
				provider: "cos",
				explicitEndpoint: "https://cos.internal.example.com",
			});

			expect(result.endpoint).toBe("https://cos.internal.example.com");
			expect(result.kind).toBe("cos");
			expect(result.conflict).toContain("按显式值处理");
			expect(result.conflict).toContain("https://cos.ap-guangzhou.myqcloud.com");
		});

		it("uses the explicit endpoint and reports a conflict against the obs preset", () => {
			const result = resolveStoragePreset({
				provider: "obs",
				explicitEndpoint: "https://obs.internal.example.com",
			});

			expect(result.endpoint).toBe("https://obs.internal.example.com");
			expect(result.kind).toBe("obs");
			expect(result.conflict).toContain("按显式值处理");
		});

		it("keeps the preset path style when only the endpoint was overridden", () => {
			const result = resolveStoragePreset({
				provider: "cos",
				explicitEndpoint: "https://cos.internal.example.com",
			});

			expect(result.forcePathStyle).toBe(true);
		});

		it("reports no conflict when the explicit endpoint matches the preset", () => {
			const result = resolveStoragePreset({
				provider: "cos",
				region: "ap-guangzhou",
				explicitEndpoint: "https://cos.ap-guangzhou.myqcloud.com",
			});

			expect(result.endpoint).toBe("https://cos.ap-guangzhou.myqcloud.com");
			expect(result.conflict).toBeUndefined();
		});

		it("ignores a trailing slash when comparing the explicit endpoint with the preset", () => {
			const result = resolveStoragePreset({
				provider: "obs",
				region: "cn-north-4",
				explicitEndpoint: "https://obs.cn-north-4.myhuaweicloud.com/",
			});

			expect(result.endpoint).toBe("https://obs.cn-north-4.myhuaweicloud.com");
			expect(result.conflict).toBeUndefined();
		});
	});

	describe("auto / s3 keep the legacy behaviour", () => {
		it.each(["auto", "s3"] as const)("does not invent an endpoint for %s", (provider) => {
			const result = resolveStoragePreset({ provider });

			expect(result.endpoint).toBeUndefined();
			expect(result.region).toBe("us-east-1");
			expect(result.forcePathStyle).toBe(false);
			expect(result.kind).toBe("s3");
			expect(result.conflict).toBeUndefined();
		});

		it("passes the explicit endpoint through without a conflict", () => {
			const result = resolveStoragePreset({
				provider: "s3",
				explicitEndpoint: "http://localhost:8333",
			});

			expect(result.endpoint).toBe("http://localhost:8333");
			expect(result.conflict).toBeUndefined();
		});

		it("honours the supplied path style", () => {
			expect(resolveStoragePreset({ provider: "auto", explicitForcePathStyle: true }).forcePathStyle).toBe(true);
			expect(resolveStoragePreset({ provider: "s3", explicitForcePathStyle: true }).forcePathStyle).toBe(true);
			expect(resolveStoragePreset({ provider: "s3", explicitForcePathStyle: false }).forcePathStyle).toBe(false);
		});

		it("keeps the supplied region", () => {
			const result = resolveStoragePreset({ provider: "auto", region: "eu-west-1" });

			expect(result.region).toBe("eu-west-1");
			expect(result.endpoint).toBeUndefined();
		});

		it("falls back to the legacy behaviour for a provider it does not recognise", () => {
			// Guards the case where the env object is partial (e.g. a mocked env in tests).
			const result = resolveStoragePreset({ provider: undefined as unknown as "auto" });

			expect(result.endpoint).toBeUndefined();
			expect(result.kind).toBe("s3");
			expect(result.conflict).toBeUndefined();
		});
	});

	describe("region fallback", () => {
		it("falls back to each vendor's default region when the region is missing", () => {
			expect(resolveStoragePreset({ provider: "oss" }).region).toBe("oss-cn-hangzhou");
			expect(resolveStoragePreset({ provider: "cos" }).region).toBe("ap-guangzhou");
			expect(resolveStoragePreset({ provider: "obs" }).region).toBe("cn-north-4");
		});

		it("treats an empty region as missing", () => {
			expect(resolveStoragePreset({ provider: "cos", region: "   " }).region).toBe("ap-guangzhou");
			expect(resolveStoragePreset({ provider: "cos", region: "" }).region).toBe("ap-guangzhou");
		});
	});
});

describe("describeStorageChannel", () => {
	it("returns the Chinese vendor label for every channel", () => {
		expect(describeStorageChannel("local")).toBe("本地文件系统");
		expect(describeStorageChannel("s3")).toBe("S3 兼容存储");
		expect(describeStorageChannel("oss")).toBe("阿里云 OSS");
		expect(describeStorageChannel("cos")).toBe("腾讯云 COS");
		expect(describeStorageChannel("obs")).toBe("华为云 OBS");
	});
});
