import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { getVersion } from "@/lib/versions";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	_req: NextRequest,
	{ params }: { params: Promise<{ id: string; timestamp: string }> },
) {
	try {
		const { id, timestamp } = await params;
		const decodedTimestamp = decodeURIComponent(timestamp);
		const { store } = await requireUserContext();
		const agent = await getVersion(store, id, decodedTimestamp);

		if (!agent) {
			return NextResponse.json(
				{ error: `Version not found for agent "${id}" at ${decodedTimestamp}` },
				{ status: 404 },
			);
		}

		return NextResponse.json(agent);
	} catch (error) {
		if (error instanceof AuthRequiredError) {
			return NextResponse.json(
				{ error: error.message },
				{ status: error.status },
			);
		}
		return NextResponse.json({ error: String(error) }, { status: 500 });
	}
}
