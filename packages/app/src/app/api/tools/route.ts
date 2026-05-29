import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { NextResponse } from "next/server";

export async function GET() {
	try {
		const { runner } = await requireUserContext();
		const tools = runner.tools.list();
		return NextResponse.json(tools);
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
