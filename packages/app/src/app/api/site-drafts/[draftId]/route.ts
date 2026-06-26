import { consumeSiteDraft } from "@/lib/site-drafts";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	_req: NextRequest,
	{ params }: { params: Promise<{ draftId: string }> },
) {
	try {
		await requireUserContext();
		const { draftId } = await params;
		const draft = await consumeSiteDraft(draftId);
		if (!draft) {
			return NextResponse.json(
				{ error: "Draft not found, expired, or already used" },
				{ status: 404 },
			);
		}
		return NextResponse.json({
			yaml: draft.yaml,
			source: draft.source ?? null,
			expiresAt: draft.expiresAt,
		});
	} catch (error) {
		if (error instanceof AuthRequiredError) {
			return NextResponse.json(
				{ error: error.message },
				{ status: error.status },
			);
		}
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : String(error) },
			{ status: 500 },
		);
	}
}
