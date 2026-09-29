// @vitest-environment happy-dom

import type { Availability } from "@reactive-resume/schema/recruitment/data";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { AvailabilityBadge } from "./availability-badge";

// English without strings: every untranslated msgid falls back to itself, so the assertions read
// exactly like the source copy rather than like a snapshot of a catalogue.
beforeAll(() => i18n.loadAndActivate({ locale: "en", messages: {} }));

const renderBadge = (availability: Availability, daysUntilDeadline: number | null) =>
	render(
		<I18nProvider i18n={i18n}>
			<AvailabilityBadge availability={availability} daysUntilDeadline={daysUntilDeadline} />
		</I18nProvider>,
	);

describe("AvailabilityBadge", () => {
	it("renders each server-derived band under its own label", () => {
		const bands: [Availability, string][] = [
			["open", "Open"],
			["closingSoon", "Closing soon"],
			["rolling", "Rolling"],
			["expired", "Expired"],
		];

		for (const [availability, label] of bands) {
			const { unmount } = renderBadge(availability, null);
			expect(screen.getByTestId("availability-badge")).toHaveTextContent(label);
			unmount();
		}
	});

	it("appends the countdown the server computed for open posts", () => {
		renderBadge("open", 3);

		expect(screen.getByTestId("availability-badge")).toHaveTextContent("3 days left");
	});

	it("uses a distinct form for the singular day", () => {
		renderBadge("closingSoon", 1);

		expect(screen.getByTestId("availability-badge")).toHaveTextContent("1 day left");
	});

	it("calls out the last day instead of printing zero days", () => {
		renderBadge("closingSoon", 0);

		expect(screen.getByTestId("availability-badge")).toHaveTextContent("Closes today");
		expect(screen.getByTestId("availability-badge")).not.toHaveTextContent("0 days");
	});

	it("never shows a countdown for rolling posts", () => {
		renderBadge("rolling", 12);

		expect(screen.getByTestId("availability-badge")).toHaveTextContent("Rolling");
		expect(screen.getByTestId("availability-badge")).not.toHaveTextContent("12 days");
	});

	it("omits the countdown when asked to", () => {
		render(
			<I18nProvider i18n={i18n}>
				<AvailabilityBadge availability="open" daysUntilDeadline={4} showCountdown={false} />
			</I18nProvider>,
		);

		expect(screen.getByTestId("availability-badge")).not.toHaveTextContent("4 days left");
	});

	it("renders nothing at all when the server sent no day count", () => {
		renderBadge("open", null);

		expect(screen.getByTestId("availability-badge")).toHaveTextContent("Open");
		expect(screen.getByTestId("availability-badge")).not.toHaveTextContent("left");
	});
});
