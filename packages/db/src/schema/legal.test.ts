import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { userConsent } from "./legal";

describe("user_consent", () => {
	it("cascades with the owning user instead of orphaning personal data", () => {
		const { foreignKeys } = getTableConfig(userConsent);
		const [foreignKey] = foreignKeys;

		expect(foreignKeys).toHaveLength(1);
		expect(foreignKey?.onDelete).toBe("cascade");

		const reference = foreignKey?.reference();
		expect(reference?.foreignTable).toBe(user);
		expect(reference?.columns.map((column) => column.name)).toEqual(["user_id"]);
		expect(reference?.foreignColumns.map((column) => column.name)).toEqual(["id"]);
	});

	it("is append-only, so it has no updatedAt", () => {
		const { columns } = getTableConfig(userConsent);

		expect(columns.map((column) => column.name)).not.toContain("updatedAt");
	});

	it("uniquely indexes (userId, document, version) so re-acceptance is idempotent", () => {
		const { indexes } = getTableConfig(userConsent);
		const [uniqueIndex] = indexes.filter((index) => index.config.unique);

		expect(indexes.filter((index) => index.config.unique)).toHaveLength(1);
		expect(uniqueIndex?.config.columns.map((column) => ("name" in column ? column.name : String(column)))).toEqual([
			"user_id",
			"document",
			"version",
		]);
	});

	it("stamps createdAt with a default so callers never send a timestamp", () => {
		const columns = getTableColumns(userConsent);

		expect(columns.createdAt).toMatchObject({ name: "created_at", notNull: true, hasDefault: true });
	});
});
