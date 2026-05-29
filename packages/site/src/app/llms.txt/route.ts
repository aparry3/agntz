import { DOCS_GROUPS } from "@/components/docs/manifest";

// llms.txt convention — serves the entire docs corpus as raw markdown so that
// LLMs and agentic tools can ingest the full reference in one fetch.
// Each page also has its own `/docs/<slug>.md` URL; this is the union.
export function GET() {
	const banner =
		"# agntz — full documentation corpus\n\n" +
		"Generated from /docs. Every section below corresponds to a page on the site;\n" +
		"the heading hierarchy is preserved verbatim.\n\n" +
		"For per-page raw markdown, append `.md` to any docs URL\n" +
		"(e.g. `/docs/quickstart.md`).\n\n";

	const sections: string[] = [banner];

	for (const group of DOCS_GROUPS) {
		sections.push(
			"\n\n<!-- ============================================================== -->",
		);
		sections.push(`<!-- ${group.label} -->`);
		sections.push(
			"<!-- ============================================================== -->\n",
		);
		for (const page of group.pages) {
			const path = page.slug === "" ? "/docs" : `/docs/${page.slug}`;
			sections.push(`<!-- source: ${path} -->\n`);
			sections.push(page.markdown.trim());
			sections.push("\n\n");
		}
	}

	return new Response(sections.join("\n"), {
		status: 200,
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=300, s-maxage=3600",
		},
	});
}
