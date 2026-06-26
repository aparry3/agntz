import { auth } from "@clerk/nextjs/server";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	req: NextRequest,
	{ params }: { params: Promise<{ draftId: string }> },
) {
	const { draftId } = await params;
	const appTarget = `/agents/new?siteDraft=${encodeURIComponent(draftId)}`;
	const { userId } = await auth();

	if (userId) {
		return NextResponse.redirect(new URL(appTarget, req.url));
	}

	const url = new URL("/sign-up", req.url);
	url.searchParams.set("redirect_url", appTarget);
	return NextResponse.redirect(url);
}
