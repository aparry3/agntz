import schema from "../../../../../core/schema/agent-manifest.schema.json";

export function GET(): Response {
	return Response.json(schema, {
		headers: {
			"Access-Control-Allow-Origin": "*",
			"Cache-Control": "public, max-age=3600, s-maxage=86400",
		},
	});
}
