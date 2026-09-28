import type { Style } from "@react-pdf/types";
import type { CustomField } from "@reactive-resume/schema/resume/data";
import type { TemplatePageProps } from "../../document";
import type { CnFieldKey } from "../shared/cn-fields";
import type { TemplateColorRoles, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
import { useMemo } from "react";
import { rgbaStringToHex } from "@reactive-resume/utils/color";
import { Page, StyleSheet, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { useRenderedSectionIds, useResolvedNode } from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import { createBaseTemplateStyles } from "../shared/base-template-styles";
import { partitionCnFields } from "../shared/cn-fields";
import {
	CnFieldContactItem,
	CustomFieldContactItem,
	EmailContactItem,
	LocationContactItem,
	PhoneContactItem,
	WebsiteContactItem,
} from "../shared/contact-item";
import { TemplateProvider } from "../shared/context";
import { filterSections } from "../shared/filtering";
import { getTemplateMetrics } from "../shared/metrics";
import { hasTemplatePicture } from "../shared/picture";
import {
	Heading,
	SemanticContactListView,
	SemanticHeaderPicture,
	SemanticHeaderView,
	SemanticRegionView,
	Text,
} from "../shared/primitives";
import { createRtlStyleHelpers } from "../shared/rtl";
import { Section } from "../shared/sections";
import { composeStyles, headerNameLineHeight } from "../shared/styles";

type XuanwuStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	body: Style;
	header: Style;
	headerIdentity: Style;
	headerName: Style;
	headerHeadline: Style;
	infoBand: Style;
	contactList: Style;
	contactItem: Style;
	contactLabel: Style;
	picture: Style;
	main: Style;
	sidebar: Style;
	sectionGroup: Style;
};

type XuanwuTemplate = {
	colors: TemplateColorRoles;
	styles: XuanwuStyles;
};

type XuanwuHeaderProps = {
	styles: XuanwuStyles;
};

/**
 * The domestic fields xuanwu claims into its information table, in display
 * order. Deliberately excludes the more sensitive keys (`maritalStatus`,
 * `height`, `hukou`) — see the design doc, §5.6 item 7.
 */
const XUANWU_CN_FIELD_ORDER = [
	"gender",
	"birthDate",
	"ethnicity",
	"politicalStatus",
	"nativePlace",
] as const satisfies readonly CnFieldKey[];

/** One-inch ID photo proportions: width is three quarters of the height. */
const ID_PHOTO_ASPECT_RATIO = 0.75;

/**
 * xuanwu — state owned enterprise / public institution template.
 *
 * Layout contract:
 *  - The header is a "personal information band": the name owns its own line,
 *    and below it sits a two column, multi row table of domestic fields
 *    (political status, ethnicity, native place, date of birth, ...) built from
 *    recognised custom fields. Anything not recognised falls through to the
 *    generic custom field row, so the table degrades to name / phone / email
 *    instead of going blank.
 *  - The ID photo is forced to portrait proportions on the right of the band.
 *  - Body is single column; item order is whatever the resume data holds.
 */
export const XuanwuPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useXuanwuTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors}>
				{showHeader && <Header styles={styles} />}

				<View style={styles.body}>
					<SemanticRegionView
						region="main"
						style={composeStyles(styles.main, styles.sectionGroup, { rowGap: metrics.sectionGap })}
					>
						{mainSections.map((section) => (
							<Section key={section} section={section} placement="main" />
						))}
					</SemanticRegionView>

					{!page.fullWidth && (
						<SemanticRegionView
							region="sidebar"
							style={composeStyles(styles.sidebar, styles.sectionGroup, { rowGap: metrics.sectionGap })}
						>
							{sidebarSections.map((section) => (
								<Section key={section} section={section} placement="sidebar" />
							))}
						</SemanticRegionView>
					)}
				</View>
			</TemplateProvider>
		</Page>
	);
};

const Header = ({ styles }: XuanwuHeaderProps) => {
	const { basics, picture } = useRender();
	const hasPicture = hasTemplatePicture(picture);
	const { slots, rest } = partitionCnFields(basics.customFields, XUANWU_CN_FIELD_ORDER);

	const claimedFields = XUANWU_CN_FIELD_ORDER.map((key) => slots[key]).filter(
		(field): field is CustomField => field !== undefined,
	);

	return (
		<SemanticHeaderView style={styles.header}>
			<View style={styles.headerIdentity}>
				<Heading style={styles.headerName}>{basics.name}</Heading>
				{basics.headline && <Text style={styles.headerHeadline}>{basics.headline}</Text>}
			</View>

			<View style={styles.infoBand}>
				<SemanticContactListView style={styles.contactList}>
					<PhoneContactItem phone={basics.phone} style={styles.contactItem} />
					<EmailContactItem email={basics.email} style={styles.contactItem} />
					{claimedFields.map((field) => (
						<CnFieldContactItem
							key={field.id}
							field={field}
							style={styles.contactItem}
							labelStyle={styles.contactLabel}
						/>
					))}
					<LocationContactItem location={basics.location} style={styles.contactItem} />
					<WebsiteContactItem website={basics.website} style={styles.contactItem} />
					{rest.map((field) => (
						<CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} />
					))}
				</SemanticContactListView>

				{hasPicture && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
			</View>
		</SemanticHeaderView>
	);
};

const useXuanwuTemplate = (): XuanwuTemplate => {
	const { picture, metadata, rtl } = useRender();

	return useMemo(() => {
		const r = createRtlStyleHelpers(rtl);
		const foreground = rgbaStringToHex(metadata.design.colors.text);
		const background = rgbaStringToHex(metadata.design.colors.background);
		const primary = rgbaStringToHex(metadata.design.colors.primary);
		const colors: TemplateColorRoles = { foreground, background, primary };
		const metrics = getTemplateMetrics(metadata.page);
		const sidebarWidth = metadata.layout.sidebarWidth;

		const base = createBaseTemplateStyles({ metadata, foreground, background, r, metrics, picture });

		const pictureHeight = picture.size;
		const pictureWidth = pictureHeight * ID_PHOTO_ASPECT_RATIO;

		const baseStyles = StyleSheet.create({
			...base,
			page: {
				...base.page,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
				rowGap: metrics.gapY(0.75),
			},
			body: {
				flexDirection: r.row,
				alignItems: "flex-start",
				columnGap: metrics.gapX(1),
			},
			section: {
				flexDirection: "column",
				rowGap: metrics.gapY(0.3),
			},
			sectionHeading: {
				color: primary,
				textAlign: r.sectionHeadingTextAlign,
				letterSpacing: 0,
				borderBottomWidth: 1,
				borderBottomColor: primary,
				paddingBottom: metrics.gapY(0.125),
				marginBottom: metrics.gapY(0.125),
			},
			item: {
				rowGap: metrics.gapY(0.15),
			},
			levelContainer: {
				width: "100%",
			},
			levelItem: {
				borderColor: primary,
			},
			levelItemActive: {
				backgroundColor: primary,
			},
			header: {
				width: "100%",
				flexDirection: "column",
				...r.headerIdentity,
				rowGap: metrics.gapY(0.4),
				borderBottomWidth: 1,
				borderBottomColor: primary,
				paddingBottom: metrics.gapY(0.4),
			},
			headerIdentity: {
				width: "100%",
				...r.headerIdentity,
				rowGap: metrics.gapY(0.15),
			},
			headerName: {
				fontSize: metadata.typography.heading.fontSize * 1.6,
				lineHeight: headerNameLineHeight,
				textAlign: r.sectionHeadingTextAlign,
			},
			headerHeadline: {
				opacity: 0.8,
				textAlign: r.sectionHeadingTextAlign,
			},
			infoBand: {
				width: "100%",
				flexDirection: r.row,
				alignItems: "flex-start",
				justifyContent: "space-between",
				columnGap: metrics.gapX(1),
			},
			contactList: {
				flex: 1,
				minWidth: 0,
				flexDirection: r.row,
				flexWrap: "wrap",
				alignItems: "flex-start",
				rowGap: metrics.gapY(0.15),
				columnGap: metrics.gapX(1),
			},
			contactItem: {
				flexBasis: "45%",
				flexGrow: 0,
				flexShrink: 0,
				flexDirection: r.row,
				alignItems: "flex-start",
				columnGap: metrics.gapX(1 / 6),
			},
			contactLabel: {
				opacity: 0.75,
			},
			picture: {
				...base.picture,
				width: pictureWidth,
				height: pictureHeight,
				aspectRatio: ID_PHOTO_ASPECT_RATIO,
			},
			main: {
				flexGrow: 1,
				flexShrink: 1,
				minWidth: 0,
			},
			sidebar: {
				flexGrow: 0,
				flexShrink: 0,
				minWidth: 0,
				flexBasis: `${sidebarWidth}%`,
			},
			sectionGroup: {},
		});

		const accentFor = ({ colors: contextColors }: TemplateStyleContext) => contextColors.primary;

		return {
			colors,
			styles: {
				...baseStyles,
				sectionHeading: (context) => ({
					...baseStyles.sectionHeading,
					color: accentFor(context),
					borderBottomColor: accentFor(context),
				}),
				levelItem: (context) => ({ borderColor: accentFor(context) }),
				levelItemActive: (context) => ({ backgroundColor: accentFor(context) }),
				icon: (context) => ({
					display: metadata.page.hideIcons ? "none" : "flex",
					size: metadata.typography.body.fontSize,
					color: accentFor(context),
				}),
			} satisfies XuanwuStyles,
		};
	}, [picture, metadata, rtl]);
};
