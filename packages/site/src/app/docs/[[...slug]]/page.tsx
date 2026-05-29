import { CopyMarkdownButton } from "@/components/docs/copy-md-button";
import { adjacent, allPages, findPageBySlug } from "@/components/docs/manifest";
import { parseDocs, renderBlocks } from "@/components/docs/markdown";
import { PageNav } from "@/components/docs/page-nav";
import { DocsSidebar } from "@/components/docs/sidebar";
import { DocsToc } from "@/components/docs/toc";
import { FooterX } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { TOKENS } from "@/components/landing/tokens";
import { LanguageProvider, LanguageToggle } from "@/components/language";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

type Params = { slug?: string[] };

export function generateStaticParams(): Params[] {
	return allPages().map((p) => ({
		slug: p.slug === "" ? undefined : p.slug.split("/"),
	}));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<Params>;
}): Promise<Metadata> {
	const { slug } = await params;
	const slugStr = (slug ?? []).join("/");
	const page = findPageBySlug(slugStr);
	if (!page) {
		return { title: "Documentation" };
	}
	const pageTitle =
		page.slug === "" ? "agntz documentation" : `${page.title} — agntz docs`;
	const description =
		page.description ??
		"Complete guide to defining, running, and shipping AI agents with agntz.";
	const canonical = page.slug === "" ? "/docs" : `/docs/${page.slug}`;
	const ogImage =
		page.slug === "" ? "/api/og/docs" : `/api/og/docs/${page.slug}`;
	return {
		title: { absolute: pageTitle },
		description,
		alternates: { canonical },
		openGraph: {
			type: "article",
			url: canonical,
			siteName: "Agntz",
			title: pageTitle,
			description,
			images: [{ url: ogImage, width: 1200, height: 630, alt: pageTitle }],
		},
		twitter: {
			card: "summary_large_image",
			title: pageTitle,
			description,
			images: [ogImage],
		},
	};
}

export default async function DocsPage({
	params,
}: {
	params: Promise<Params>;
}) {
	const { slug } = await params;
	const slugStr = (slug ?? []).join("/");
	const page = findPageBySlug(slugStr);
	if (!page) notFound();

	const { sections, blocks } = parseDocs(page.markdown);
	const { prev, next } = adjacent(page.slug);
	const rawHref = page.slug === "" ? "/docs/index.md" : `/docs/${page.slug}.md`;

	return (
		<>
			<Nav />
			<LanguageProvider>
				<main style={{ background: TOKENS.bg, paddingBottom: 80 }}>
					<div
						style={{
							width: "min(1320px, calc(100% - 32px))",
							margin: "0 auto",
							paddingTop: 28,
							display: "grid",
							gridTemplateColumns: "232px minmax(0, 1fr) 220px",
							gap: 40,
							alignItems: "start",
						}}
					>
						<DocsSidebar activeSlug={page.slug} />

						<article
							style={{
								minWidth: 0,
								maxWidth: 760,
								color: TOKENS.ink,
							}}
						>
							<div
								style={{
									display: "flex",
									alignItems: "center",
									justifyContent: "space-between",
									gap: 16,
									flexWrap: "wrap",
									marginBottom: 16,
								}}
							>
								<div
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: 8,
										fontFamily: "var(--mono)",
										fontSize: 11,
										letterSpacing: "0.18em",
										textTransform: "uppercase",
										color: TOKENS.text2,
									}}
								>
									<span
										style={{ width: 18, height: 1, background: TOKENS.text2 }}
									/>
									Documentation
								</div>

								<LanguageToggle />
							</div>

							<CopyMarkdownButton markdown={page.markdown} rawHref={rawHref} />

							{renderBlocks(blocks)}

							<PageNav prev={prev} next={next} />
						</article>

						<DocsToc sections={sections} />
					</div>
				</main>
			</LanguageProvider>
			<FooterX />
		</>
	);
}
