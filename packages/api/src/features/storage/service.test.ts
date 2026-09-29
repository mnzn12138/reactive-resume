import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({
	APP_URL: "https://example.com",
	LOCAL_STORAGE_PATH: "",
	STORAGE_PROVIDER: "auto" as "auto" | "oss" | "cos" | "obs" | "s3",
	S3_ACCESS_KEY_ID: undefined as string | undefined,
	S3_SECRET_ACCESS_KEY: undefined as string | undefined,
	S3_REGION: "us-east-1",
	S3_ENDPOINT: undefined as string | undefined,
	S3_BUCKET: undefined as string | undefined,
	S3_FORCE_PATH_STYLE: false,
	FLAG_DISABLE_IMAGE_PROCESSING: false,
}));

// Hoisted so the mock survives `vi.resetModules()` — the factory below is re-executed on every
// fresh import, but these two spies stay the same objects and keep their recorded calls.
const s3ClientMock = vi.hoisted(() => vi.fn());
const s3SendMock = vi.hoisted(() => vi.fn());

// A class, not an arrow function: `new S3Client(...)` inside the service must be able to
// construct it, and Vitest refuses to `new` a mock backed by an arrow function.
class FakeS3Client {
	send = s3SendMock;
}

vi.mock("@reactive-resume/env/server", () => ({ env: envMock }));
// sharp is exercised by processImageForUpload; keep it out of the import graph entirely
// because resolving it loads native bindings we can't rely on in CI.
vi.mock("sharp", () => {
	const chain = {
		resize: () => chain,
		jpeg: () => chain,
		rotate: () => chain,
		toBuffer: async () => Buffer.from("processed"),
		metadata: async () => ({ width: 100, height: 100 }),
	};
	return { default: () => chain };
});
vi.mock("@aws-sdk/client-s3", () => ({
	S3Client: s3ClientMock,
	PutObjectCommand: vi.fn(),
	GetObjectCommand: vi.fn(),
	DeleteObjectCommand: vi.fn(),
	ListObjectsV2Command: vi.fn(),
}));

const { getStorageService, inferContentType, isImageFile, processImageForUpload } = await import("./service");

const makeFile = (bytes: Uint8Array, type = "image/png") =>
	({
		arrayBuffer: async () => bytes.buffer,
		type,
	}) as unknown as File;

describe("inferContentType", () => {
	it("maps common image extensions to their MIME types", () => {
		expect(inferContentType("photo.jpg")).toBe("image/jpeg");
		expect(inferContentType("photo.jpeg")).toBe("image/jpeg");
		expect(inferContentType("photo.png")).toBe("image/png");
		expect(inferContentType("animated.gif")).toBe("image/gif");
		expect(inferContentType("logo.svg")).toBe("image/svg+xml");
		expect(inferContentType("photo.webp")).toBe("image/webp");
	});

	it("maps .pdf to application/pdf", () => {
		expect(inferContentType("doc.pdf")).toBe("application/pdf");
	});

	it("is case-insensitive on the extension", () => {
		expect(inferContentType("PHOTO.JPG")).toBe("image/jpeg");
		expect(inferContentType("Document.PDF")).toBe("application/pdf");
	});

	it("falls back to application/octet-stream for unknown extensions", () => {
		expect(inferContentType("data.xyz")).toBe("application/octet-stream");
		expect(inferContentType("README")).toBe("application/octet-stream");
	});

	it("uses just the file extension regardless of path depth", () => {
		expect(inferContentType("/nested/dir/file.png")).toBe("image/png");
	});
});

describe("processImageForUpload", () => {
	it("returns the file untouched when image processing is disabled", async () => {
		envMock.FLAG_DISABLE_IMAGE_PROCESSING = true;
		const file = makeFile(new Uint8Array([1, 2, 3, 4]), "image/png");

		const result = await processImageForUpload(file);

		expect(result.contentType).toBe("image/png");
		expect(Array.from(result.data)).toEqual([1, 2, 3, 4]);
	});

	it("re-encodes to JPEG via sharp when processing is enabled", async () => {
		envMock.FLAG_DISABLE_IMAGE_PROCESSING = false;
		const file = makeFile(new Uint8Array([5, 6, 7, 8]), "image/png");

		const result = await processImageForUpload(file);

		expect(result.contentType).toBe("image/jpeg");
		// Sharp mock returns "processed" — ensure we got something not equal to the input.
		expect(result.data.length).toBeGreaterThan(0);
		expect(Array.from(result.data)).not.toEqual([5, 6, 7, 8]);
	});
});

describe("isImageFile", () => {
	it("returns true for supported image mime types", () => {
		for (const type of ["image/gif", "image/png", "image/jpeg", "image/webp"]) {
			expect(isImageFile(type), type).toBe(true);
		}
	});

	it("returns false for image/svg+xml (not in the upload allowlist)", () => {
		expect(isImageFile("image/svg+xml")).toBe(false);
	});

	it("returns false for application/pdf and other non-image types", () => {
		expect(isImageFile("application/pdf")).toBe(false);
		expect(isImageFile("text/plain")).toBe(false);
		expect(isImageFile("")).toBe(false);
	});
});

describe("LocalStorageService", () => {
	it("rejects private writes instead of silently storing them on the local filesystem", async () => {
		await expect(
			getStorageService().write({
				key: "uploads/user/agent/thread/file.txt",
				data: new TextEncoder().encode("private"),
				contentType: "text/plain",
				private: true,
			}),
		).rejects.toThrow("Private storage writes are not supported by the local filesystem backend.");
	});
});

describe("国产对象存储预设", () => {
	const credentials = {
		S3_ACCESS_KEY_ID: "test-access-key-id",
		S3_SECRET_ACCESS_KEY: "test-secret-access-key",
		S3_BUCKET: "test-bucket",
	};

	// `getStorageService()` memoises a single instance per module, so every case loads its own
	// copy of the module instead of inheriting a service built for a previous case.
	async function loadFreshService() {
		vi.resetModules();
		s3ClientMock.mockClear();
		s3ClientMock.mockImplementation(FakeS3Client as never);
		const service = await import("./service");
		return service.getStorageService();
	}

	beforeEach(() => {
		s3SendMock.mockReset();
		s3SendMock.mockResolvedValue({});
	});

	afterEach(() => {
		envMock.STORAGE_PROVIDER = "auto";
		envMock.S3_ACCESS_KEY_ID = undefined;
		envMock.S3_SECRET_ACCESS_KEY = undefined;
		envMock.S3_BUCKET = undefined;
		envMock.S3_REGION = "us-east-1";
		envMock.S3_ENDPOINT = undefined;
		envMock.S3_FORCE_PATH_STYLE = false;
	});

	it("凭证不全时即使选了厂商预设也仍然回落本地", async () => {
		envMock.STORAGE_PROVIDER = "cos";
		envMock.S3_ACCESS_KEY_ID = credentials.S3_ACCESS_KEY_ID;
		envMock.S3_SECRET_ACCESS_KEY = undefined;
		envMock.S3_BUCKET = credentials.S3_BUCKET;

		const service = await loadFreshService();
		const result = await service.healthcheck();

		expect(result.type).toBe("local");
		expect(s3ClientMock).not.toHaveBeenCalled();
	});

	it("STORAGE_PROVIDER=cos 时套用腾讯云预设并把默认地域落到 ap-guangzhou", async () => {
		envMock.STORAGE_PROVIDER = "cos";
		Object.assign(envMock, credentials);

		const service = await loadFreshService();

		expect(s3ClientMock).toHaveBeenCalledWith(
			expect.objectContaining({
				region: "ap-guangzhou",
				forcePathStyle: true,
				endpoint: "https://cos.ap-guangzhou.myqcloud.com",
			}),
		);

		const result = await service.healthcheck();
		expect(result.type).toBe("cos");
		expect(result.message).toContain("腾讯云 COS");
	});

	it("STORAGE_PROVIDER=oss 时套用阿里云预设并使用虚拟托管式寻址", async () => {
		envMock.STORAGE_PROVIDER = "oss";
		Object.assign(envMock, credentials);

		const service = await loadFreshService();

		expect(s3ClientMock).toHaveBeenCalledWith(
			expect.objectContaining({
				region: "oss-cn-hangzhou",
				forcePathStyle: false,
				endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
			}),
		);

		expect((await service.healthcheck()).message).toContain("阿里云 OSS");
	});

	it("STORAGE_PROVIDER=obs 时套用华为云预设并使用路径式寻址", async () => {
		envMock.STORAGE_PROVIDER = "obs";
		Object.assign(envMock, credentials);

		const service = await loadFreshService();

		expect(s3ClientMock).toHaveBeenCalledWith(
			expect.objectContaining({
				region: "cn-north-4",
				forcePathStyle: true,
				endpoint: "https://obs.cn-north-4.myhuaweicloud.com",
			}),
		);

		expect((await service.healthcheck()).message).toContain("华为云 OBS");
	});

	it("显式 S3_ENDPOINT 与预设不一致时按显式值处理并打日志", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		envMock.STORAGE_PROVIDER = "cos";
		envMock.S3_ENDPOINT = "https://cos.internal.example.com";
		Object.assign(envMock, credentials);

		const service = await loadFreshService();

		expect(s3ClientMock).toHaveBeenCalledWith(
			expect.objectContaining({ endpoint: "https://cos.internal.example.com" }),
		);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("按显式值处理"));
		expect((await service.healthcheck()).type).toBe("cos");

		warn.mockRestore();
	});

	it("STORAGE_PROVIDER=auto 时不预设 endpoint,沿用原有行为", async () => {
		envMock.STORAGE_PROVIDER = "auto";
		Object.assign(envMock, credentials);

		const service = await loadFreshService();

		expect(s3ClientMock).toHaveBeenCalledWith(expect.objectContaining({ region: "us-east-1", forcePathStyle: false }));
		expect(s3ClientMock.mock.calls[0]?.[0]).not.toHaveProperty("endpoint");
		expect((await service.healthcheck()).type).toBe("s3");
	});
});
