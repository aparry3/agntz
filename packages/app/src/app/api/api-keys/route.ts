import { getStore } from "@/lib/store";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET() {
	try {
		const { userId } = await requireUserContext();
		const adminStore = await getStore();
		const keys = await adminStore.listApiKeys(userId);
		return NextResponse.json(keys);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function POST(req: NextRequest) {
	try {
		const { userId } = await requireUserContext();
		const body = await req.json();
		const name = String(body.name ?? "").trim();
		if (!name) {
			return NextResponse.json(
				{ error: "Missing required field: name" },
				{ status: 400 },
			);
		}
		const adminStore = await getStore();
		const { record, rawKey } = await adminStore.createApiKey({
			userId,
			name,
		});
		// rawKey is returned ONCE; UI must show + copy then forget.
		return NextResponse.json({ ...record, rawKey }, { status: 201 });
	} catch (error) {
		return errorResponse(error);
	}
}

function errorResponse(error: unknown) {
	if (error instanceof AuthRequiredError) {
		return NextResponse.json(
			{ error: error.message },
			{ status: error.status },
		);
	}
	return NextResponse.json({ error: String(error) }, { status: 500 });
}
