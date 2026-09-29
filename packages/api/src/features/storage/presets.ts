/**
 * Domestic object-storage presets (B4).
 *
 * All three vendors (阿里云 OSS / 腾讯云 COS / 华为云 OBS) speak the S3 protocol, so the
 * runtime keeps using `@aws-sdk/client-s3` and no extra SDK is introduced. This module only
 * answers "what endpoint / region / path style does this vendor need", which is the part
 * operators otherwise have to look up by hand.
 *
 * The resolver is a pure function: it takes the operator's explicit values and returns the
 * effective configuration, so it can be unit tested without touching `process.env`.
 */

/** Values accepted by `STORAGE_PROVIDER` in `packages/env/src/server.ts`. */
export type StorageProvider = "auto" | "oss" | "cos" | "obs" | "s3";

/** Channel identifier surfaced by `healthcheck()` and consumed by the health endpoint. */
export type StorageChannelKind = "local" | "s3" | "oss" | "cos" | "obs";

/**
 * Every value of {@link StorageChannelKind} as a runtime set.
 *
 * The health endpoint has to decide whether a `type` is safe to expose on an unhealthy check, and
 * doing that with a chain of `===` comparisons silently drops any kind added here later. Keeping
 * the set next to the type is what makes that drift impossible.
 */
export const STORAGE_CHANNEL_KINDS: ReadonlySet<string> = new Set<StorageChannelKind>([
	"local",
	"s3",
	"oss",
	"cos",
	"obs",
]);

/** The providers that actually carry a preset; `auto` / `s3` keep the legacy behaviour. */
export type PresetStorageProvider = Exclude<StorageProvider, "auto" | "s3">;

/**
 * `S3_REGION` is declared with `.default("us-east-1")` in `packages/env`, so an operator who
 * never touched it still gets that value. None of the domestic vendors understand it, hence it
 * doubles as the "not supplied" sentinel for the preset providers (see `resolveStoragePreset`).
 */
export const DEFAULT_S3_REGION = "us-east-1";

export interface StoragePreset {
	/** Vendor label used to build healthcheck messages. */
	label: string;
	/** Region applied when the operator did not supply `S3_REGION`. */
	defaultRegion: string;
	/** Whether the vendor requires path-style addressing for bucket URLs. */
	forcePathStyle: boolean;
	/** Builds the vendor endpoint from the resolved region. */
	buildEndpoint: (region: string) => string;
}

export interface StoragePresetInput {
	provider: StorageProvider;
	/** `S3_REGION` as supplied by the operator; `undefined` means "fall back to the preset". */
	region?: string | undefined;
	/** `S3_ENDPOINT` as supplied by the operator; always wins over the preset. */
	explicitEndpoint?: string | undefined;
	/** `S3_FORCE_PATH_STYLE` as supplied by the operator; only consulted for `auto` / `s3`. */
	explicitForcePathStyle?: boolean | undefined;
}

export interface ResolvedStoragePreset {
	/** Effective endpoint; `undefined` means "let the AWS SDK resolve it" (AWS / MinIO default). */
	endpoint: string | undefined;
	/** Effective region. */
	region: string;
	/** Effective `forcePathStyle`. */
	forcePathStyle: boolean;
	/** Resolved channel identifier, used by `healthcheck()` messages. */
	kind: StorageChannelKind;
	/** Explanation returned when the explicit endpoint disagrees with the vendor preset. */
	conflict: string | undefined;
}

export const STORAGE_PRESETS: Record<PresetStorageProvider, StoragePreset> = {
	// 阿里云 OSS: virtual-hosted style, region ids are `oss-<city>` (e.g. `oss-cn-hangzhou`).
	oss: {
		label: "阿里云 OSS",
		defaultRegion: "oss-cn-hangzhou",
		forcePathStyle: false,
		// Aliyun's bare endpoint is `https://oss-cn-hangzhou.aliyuncs.com`, i.e. the region id
		// already carries the `oss-` prefix. Operators who write only the city part (`cn-hangzhou`)
		// get the documented `https://oss-<region>.aliyuncs.com` shape instead — both produce the
		// same, valid URL.
		buildEndpoint: (region: string): string =>
			region.startsWith("oss-") ? `https://${region}.aliyuncs.com` : `https://oss-${region}.aliyuncs.com`,
	},
	// 腾讯云 COS: path style is mandatory, region ids look like `ap-guangzhou`.
	cos: {
		label: "腾讯云 COS",
		defaultRegion: "ap-guangzhou",
		forcePathStyle: true,
		buildEndpoint: (region: string): string => `https://cos.${region}.myqcloud.com`,
	},
	// 华为云 OBS: path style is mandatory, region ids look like `cn-north-4`.
	obs: {
		label: "华为云 OBS",
		defaultRegion: "cn-north-4",
		forcePathStyle: true,
		buildEndpoint: (region: string): string => `https://obs.${region}.myhuaweicloud.com`,
	},
};

/** Human readable labels for every channel a healthcheck can report. */
const STORAGE_CHANNEL_LABELS: Record<StorageChannelKind, string> = {
	local: "本地文件系统",
	s3: "S3 兼容存储",
	oss: STORAGE_PRESETS.oss.label,
	cos: STORAGE_PRESETS.cos.label,
	obs: STORAGE_PRESETS.obs.label,
};

/**
 * Returns the display label of a channel, e.g. `腾讯云 COS`.
 *
 * @param kind Channel identifier resolved from `STORAGE_PROVIDER`.
 * @returns The Chinese vendor label used in healthcheck messages.
 */
export function describeStorageChannel(kind: StorageChannelKind): string {
	return STORAGE_CHANNEL_LABELS[kind];
}

function normalizeEndpoint(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

/**
 * Resolves the effective S3-compatible configuration for a provider.
 *
 * Precedence (S-1 / S-2 of the B4 design):
 * 1. An explicit `S3_ENDPOINT` always wins — presets save typing, they never override the operator.
 * 2. When the explicit endpoint disagrees with the chosen vendor's preset, the explicit value is
 *    used and a `conflict` message is returned for the caller to log.
 * 3. `S3_REGION` falls back to the vendor's default region; `auto` / `s3` fall back to `us-east-1`
 *    and keep whatever `forcePathStyle` was supplied.
 * 4. For `oss` / `cos` / `obs`, `forcePathStyle` comes from the preset — the vendor dictates it and
 *    there is no sensible override.
 *
 * @param input Provider plus the operator's explicit `S3_REGION` / `S3_ENDPOINT` / path style.
 * @returns The effective endpoint, region, path style, channel kind and optional conflict note.
 */
export function resolveStoragePreset(input: StoragePresetInput): ResolvedStoragePreset {
	const { provider, region, explicitEndpoint, explicitForcePathStyle } = input;

	const explicit: string | undefined = explicitEndpoint ? normalizeEndpoint(explicitEndpoint) : undefined;

	// Only the three vendors carry a preset; anything else (`auto`, `s3`, or a value the env
	// schema does not know about) keeps the legacy behaviour, so a missing `STORAGE_PROVIDER`
	// can never crash the constructor.
	if (provider === "oss" || provider === "cos" || provider === "obs") {
		const preset: StoragePreset = STORAGE_PRESETS[provider];
		const resolvedRegion: string = region?.trim() ? region.trim() : preset.defaultRegion;
		const presetEndpoint: string = preset.buildEndpoint(resolvedRegion);

		let conflict: string | undefined;

		if (explicit !== undefined && explicit !== presetEndpoint) {
			conflict = `已显式设置 S3_ENDPOINT(${explicit}),与 ${provider} 预设(${presetEndpoint})不一致,按显式值处理`;
		}

		return {
			endpoint: explicit ?? presetEndpoint,
			region: resolvedRegion,
			forcePathStyle: preset.forcePathStyle,
			kind: provider,
			conflict,
		};
	}

	// `auto` / `s3`: no endpoint is invented and the operator's `forcePathStyle` is honoured as-is.
	return {
		endpoint: explicit,
		region: region?.trim() ? region.trim() : DEFAULT_S3_REGION,
		forcePathStyle: explicitForcePathStyle ?? false,
		kind: "s3",
		conflict: undefined,
	};
}
