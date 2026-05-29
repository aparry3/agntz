import { SUPPORTED_PROVIDERS } from "@/lib/supported-providers";
import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { NextResponse } from "next/server";

export async function GET() {
	try {
		const { runner } = await requireUserContext();
		const stored = runner.providers
			? await runner.providers.listProviders()
			: [];
		const storedMap = new Map(stored.map((p) => [p.id, p.configured]));

		const providers = SUPPORTED_PROVIDERS.map((p) => ({
			...p,
			configured: storedMap.get(p.id) ?? false,
		}));

		return NextResponse.json(providers);
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
