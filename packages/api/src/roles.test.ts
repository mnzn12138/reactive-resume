import { describe, expect, it } from "vitest";
import { assertUserRole, isAdminRole, parseUserRole, USER_ROLES } from "./roles";

describe("parseUserRole", () => {
	it("accepts the two known roles", () => {
		expect(parseUserRole("user")).toBe("user");
		expect(parseUserRole("admin")).toBe("admin");
	});

	it("rejects anything outside the whitelist", () => {
		// The column is unconstrained text, so a typo must never look privileged.
		expect(parseUserRole("Admin")).toBeNull();
		expect(parseUserRole("superuser")).toBeNull();
		expect(parseUserRole("")).toBeNull();
	});

	it("rejects missing values (the column is nullable)", () => {
		expect(parseUserRole(null)).toBeNull();
		expect(parseUserRole(undefined)).toBeNull();
		expect(parseUserRole(42)).toBeNull();
	});
});

describe("isAdminRole", () => {
	it("is true only for the exact admin role", () => {
		expect(isAdminRole("admin")).toBe(true);
		expect(isAdminRole("user")).toBe(false);
		expect(isAdminRole("Admin")).toBe(false);
		expect(isAdminRole(null)).toBe(false);
		expect(isAdminRole(undefined)).toBe(false);
	});
});

describe("assertUserRole", () => {
	it("returns the role for known values", () => {
		expect(assertUserRole("admin")).toBe("admin");
		expect(assertUserRole("user")).toBe("user");
	});

	it("throws for unknown values so writes fail loudly", () => {
		expect(() => assertUserRole("root")).toThrow(/Invalid user role/);
		expect(() => assertUserRole("")).toThrow(/Invalid user role/);
	});

	it("keeps the whitelist in sync with the exported constants", () => {
		expect(USER_ROLES).toEqual(["user", "admin"]);
	});
});
