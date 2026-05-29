import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	_req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const { runner } = await requireUserContext();
		const messages = await runner.sessions.getMessages(id);
		return NextResponse.json({ sessionId: id, messages });
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

export async function DELETE(
	_req: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	try {
		const { id } = await params;
		const { runner } = await requireUserContext();
		await runner.sessions.deleteSession(id);
		return NextResponse.json({ id, deleted: true });
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
