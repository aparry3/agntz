import { AuthRequiredError, requireUserContext, workerIdentity } from "@/lib/user";
import { workerValidateManifest } from "@/lib/worker-client";
import { type NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
	try {
		const ctx = await requireUserContext();
		const body = await req.json();
		const { manifest } = body;

		if (!manifest || typeof manifest !== "string") {
			return NextResponse.json(
				{ error: "Missing required field: manifest (string)" },
				{ status: 400 },
			);
		}

		const result = await workerValidateManifest({
			...workerIdentity(ctx),
			manifest,
		});
		return NextResponse.json(result);
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
