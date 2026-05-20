import { DOCS_MARKDOWN } from "@/components/docs/content";

// llms.txt convention — serves the docs as raw markdown so that LLMs and
// agentic tools can ingest the full reference without HTML overhead.
export function GET() {
  return new Response(DOCS_MARKDOWN, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
