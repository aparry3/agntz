import { findPageBySlug } from "@/components/docs/manifest";

// Raw-markdown source for a single docs page. Reached via the `/docs/<slug>.md`
// alias (see ../../../../middleware.ts). Used by the "View .md" link on each
// docs page so LLMs and copy-paste workflows have a stable URL per page.
export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ slug?: string[] }> },
) {
	const { slug } = await params;
	const slugStr = (slug ?? []).join("/");
	const page = findPageBySlug(slugStr);
	if (!page) {
		return new Response("Not found", { status: 404 });
	}
	return new Response(page.markdown, {
		status: 200,
		headers: {
			"Content-Type": "text/markdown; charset=utf-8",
			"Cache-Control": "public, max-age=300, s-maxage=3600",
		},
	});
}
