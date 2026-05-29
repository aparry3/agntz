import { type NextRequest, NextResponse } from "next/server";

// Rewrite /docs/<slug>.md → /api/docs-raw/<slug>
// and    /docs.md         → /api/docs-raw            (index)
// so that LLM-friendly raw markdown is reachable at human-readable URLs
// without colliding with the HTML page route at /docs/<slug>.
export function middleware(req: NextRequest) {
	const { pathname } = req.nextUrl;

	if (pathname === "/docs.md" || pathname === "/docs/index.md") {
		const url = req.nextUrl.clone();
		url.pathname = "/api/docs-raw";
		return NextResponse.rewrite(url);
	}

	if (pathname.startsWith("/docs/") && pathname.endsWith(".md")) {
		const slug = pathname.slice("/docs/".length, -".md".length);
		const url = req.nextUrl.clone();
		url.pathname = `/api/docs-raw/${slug}`;
		return NextResponse.rewrite(url);
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/docs.md", "/docs/:path*.md"],
};
