import type { Style } from "@react-pdf/types";
import type { TemplatePageProps } from "../../document";
import type { TemplateColorRoles, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
import { useMemo } from "react";
import { rgbaStringToHex } from "@reactive-resume/utils/color";
import { Page, StyleSheet, View } from "#react-pdf-renderer";
import { useRender } from "../../context";
import { useRenderedSectionIds, useResolvedNode } from "../../semantic/context";
import { semanticNodeKeys } from "../../semantic/node-keys";
import { createBaseTemplateStyles } from "../shared/base-template-styles";
import {
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

type ZhuqueStyles = Omit<TemplateStyleSlots, "page"> & {
	page: Style;
	body: Style;
	header: Style;
	picture: Style;
	headerCopy: Style;
	headerName: Style;
	headerHeadline: Style;
	contactList: Style;
	contactItem: Style;
	main: Style;
	sidebar: Style;
	sectionGroup: Style;
};

type ZhuqueTemplate = {
	colors: TemplateColorRoles;
	styles: ZhuqueStyles;
};

type ZhuqueHeaderProps = {
	styles: ZhuqueStyles;
};

/**
 * zhuque — single page standard template for mainland China job applications.
 *
 * Layout contract:
 *  - `page.fullWidth` renders the main region only; otherwise the main region is
 *    paired with a narrow right-hand sidebar separated by a 1px primary rule
 *    (no colour block, which is what distinguishes it from chikorita).
 *  - The header puts the name on the left and the portrait ID photo on the right,
 *    with a single horizontal contact row underneath.
 */
export const ZhuquePage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useZhuqueTemplate();
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

const Header = ({ styles }: ZhuqueHeaderProps) => {
	const { basics, picture } = useRender();
	const hasPicture = hasTemplatePicture(picture);

	return (
		<SemanticHeaderView style={styles.header}>
			<View style={styles.headerCopy}>
				<Heading style={styles.headerName}>{basics.name}</Heading>
				{basics.headline && <Text style={styles.headerHeadline}>{basics.headline}</Text>}

				<SemanticContactListView style={styles.contactList}>
					<EmailContactItem email={basics.email} style={styles.contactItem} />
					<PhoneContactItem phone={basics.phone} style={styles.contactItem} />
					<LocationContactItem location={basics.location} style={styles.contactItem} />
					<WebsiteContactItem website={basics.website} style={styles.contactItem} />
					{basics.customFields.map((field) => (
						<CustomFieldContactItem key={field.id} field={field} style={styles.contactItem} />
					))}
				</SemanticContactListView>
			</View>

			{hasPicture && <SemanticHeaderPicture src={picture.url} style={styles.picture} />}
		</SemanticHeaderView>
	);
};

const useZhuqueTemplate = (): ZhuqueTemplate => {
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

		// Domestic ID photos are portrait (1-inch ~= 0.73, 2-inch ~= 0.79).
		const pictureWidth = picture.size * picture.aspectRatio;

		const baseStyles = StyleSheet.create({
			...base,
			page: {
				...base.page,
				paddingHorizontal: metrics.page.paddingHorizontal,
				paddingVertical: metrics.page.paddingVertical,
				rowGap: metrics.headerGap,
			},
			body: {
				flexDirection: r.row,
				alignItems: "flex-start",
				columnGap: metrics.gapX(1),
			},
			section: {
				flexDirection: "column",
				rowGap: metrics.gapY(0.25),
			},
			sectionHeading: {
				color: primary,
				textAlign: r.sectionHeadingTextAlign,
				borderBottomWidth: 1,
				borderBottomColor: primary,
				paddingBottom: metrics.gapY(0.125),
				marginBottom: metrics.gapY(0.125),
			},
			item: {
				rowGap: metrics.gapY(0.125),
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
				flexDirection: r.row,
				alignItems: "flex-end",
				justifyContent: "space-between",
				columnGap: metrics.gapX(1),
				borderBottomWidth: 1,
				borderBottomColor: primary,
				paddingBottom: metrics.gapY(0.35),
			},
			headerCopy: {
				flex: 1,
				...r.headerIdentity,
				rowGap: metrics.gapY(0.25),
			},
			headerName: {
				fontSize: metadata.typography.heading.fontSize * 1.5,
				lineHeight: headerNameLineHeight,
				textAlign: r.sectionHeadingTextAlign,
			},
			headerHeadline: {
				textAlign: r.sectionHeadingTextAlign,
			},
			contactList: {
				width: "100%",
				flexDirection: r.row,
				flexWrap: "wrap",
				justifyContent: "flex-start",
				rowGap: metrics.gapY(0.125),
				columnGap: metrics.gapX(0.75),
			},
			contactItem: {
				flexDirection: r.row,
				alignItems: "center",
				columnGap: metrics.gapX(1 / 6),
			},
			picture: {
				...base.picture,
				width: pictureWidth,
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
				...(r.rtl
					? {
							borderRightWidth: 1,
							borderRightColor: primary,
							paddingRight: metrics.gapX(0.75),
						}
					: {
							borderLeftWidth: 1,
							borderLeftColor: primary,
							paddingLeft: metrics.gapX(0.75),
						}),
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
			} satisfies ZhuqueStyles,
		};
	}, [picture, metadata, rtl]);
};
