import type { Style } from "@react-pdf/types";
import type { TemplatePageProps } from "../../document";
import type { TemplateColorRoles, TemplateFeatures, TemplateStyleContext, TemplateStyleSlots } from "../shared/types";
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

type QinglongStyles = Omit<TemplateStyleSlots, "page"> & {
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

type QinglongTemplate = {
	colors: TemplateColorRoles;
	styles: QinglongStyles;
};

type QinglongHeaderProps = {
	styles: QinglongStyles;
};

const qinglongFeatures = {
	inlineItemHeader: true,
} satisfies TemplateFeatures;

/**
 * qinglong — campus recruitment template for mainland China.
 *
 * Layout contract:
 *  - Single column full width main region; a narrow right-hand sidebar is only
 *    rendered when `page.fullWidth` is false.
 *  - The header is deliberately airy (larger paddings, smaller name multiplier
 *    than zhuque) because graduate resumes are short and win on breathing room.
 *  - Section headings are a primary-coloured square bullet plus a bottom rule;
 *    they are never uppercased, which keeps CJK titles readable.
 *  - `inlineItemHeader` collapses "role / organisation / period" onto one line
 *    so education and internship blocks stay dense.
 */
export const QinglongPage = ({ page, pageSize, pageMinHeightStyle, showHeader, pageNumber }: TemplatePageProps) => {
	const data = useRender();
	const pageNodeKey = semanticNodeKeys.page(pageNumber);
	const { style: semanticPageStyle, size: semanticPageSize, ...semanticPageProps } = useResolvedNode(pageNodeKey);
	const { metadata } = data;
	const { colors, styles } = useQinglongTemplate();
	const metrics = getTemplateMetrics(metadata.page);
	const mainSections = useRenderedSectionIds(pageNodeKey, filterSections(page.main, data));
	const sidebarSections = useRenderedSectionIds(pageNodeKey, filterSections(page.sidebar, data));

	return (
		<Page
			{...semanticPageProps}
			size={semanticPageSize ?? pageSize}
			style={composeStyles(styles.page, pageMinHeightStyle, semanticPageStyle)}
		>
			<TemplateProvider pageNodeKey={pageNodeKey} styles={styles} colors={colors} features={qinglongFeatures}>
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

const Header = ({ styles }: QinglongHeaderProps) => {
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

const useQinglongTemplate = (): QinglongTemplate => {
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
				rowGap: metrics.gapY(1.5),
			},
			body: {
				flexDirection: r.row,
				alignItems: "flex-start",
				columnGap: metrics.gapX(1.5),
			},
			inlineItemHeader: {
				flexDirection: r.row,
				alignItems: "flex-start",
				columnGap: metrics.gapX(0.5),
			},
			inlineItemHeaderLeading: {
				flex: 1,
				minWidth: 0,
			},
			inlineItemHeaderMiddle: {
				flex: 1,
				minWidth: 0,
			},
			inlineItemHeaderTrailing: {
				flexShrink: 0,
				textAlign: r.alignEnd.textAlign ?? "right",
			},
			section: {
				flexDirection: "column",
				rowGap: metrics.gapY(0.35),
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
				rowGap: metrics.gapY(0.2),
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
				columnGap: metrics.gapX(1.5),
				paddingBottom: metrics.gapY(0.75),
			},
			headerCopy: {
				flex: 1,
				...r.headerIdentity,
				rowGap: metrics.gapY(0.35),
			},
			headerName: {
				fontSize: metadata.typography.heading.fontSize * 1.3,
				lineHeight: headerNameLineHeight,
				textAlign: r.sectionHeadingTextAlign,
			},
			headerHeadline: {
				opacity: 0.8,
				textAlign: r.sectionHeadingTextAlign,
			},
			contactList: {
				width: "100%",
				flexDirection: r.row,
				flexWrap: "wrap",
				justifyContent: "flex-start",
				rowGap: metrics.gapY(0.2),
				columnGap: metrics.gapX(1),
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
			} satisfies QinglongStyles,
		};
	}, [picture, metadata, rtl]);
};
