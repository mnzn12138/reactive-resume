// @vitest-environment happy-dom

import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { I18nProvider } from "@lingui/react";
import Cookies from "js-cookie";
import { getLocaleMessages } from "@/libs/locale";
import LanguagesShowcase from "./languages-showcase";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	Cookies.remove("locale");
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

it("reflects the app locale and persists changes from the featured picker", async () => {
	const reload = vi.spyOn(window.location, "reload").mockImplementation(() => undefined);
	i18n.loadAndActivate(await getLocaleMessages("zh-CN"));
	const { getByRole, queryByText, container } = render(
		<I18nProvider i18n={i18n}>
			<LanguagesShowcase />
		</I18nProvider>,
	);
	const featuredPicker = within(getByRole("group", { name: i18n._(msg`Choose app language`) }));
	expect(featuredPicker.getByRole("button", { name: "简体中文" }).getAttribute("aria-pressed")).toBe("true");
	expect(container.querySelector(".language-paper")?.getAttribute("lang")).toBe("zh-CN");
	expect(container.querySelector(".language-paper")?.getAttribute("dir")).toBe("ltr");

	fireEvent.click(featuredPicker.getByRole("button", { name: "English" }));
	expect(Cookies.get("locale")).toBe("en-US");
	expect(reload).toHaveBeenCalledOnce();

	// Every shipped catalog is already featured, so the disclosure stays collapsed away.
	expect(queryByText(i18n._(msg`Show all languages`))).toBeNull();
});
