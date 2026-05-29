import { AuthRequiredError, requireUserContext } from "@/lib/user";
import { getLastFour } from "@agntz/core";
import { type NextRequest, NextResponse } from "next/server";

export async function GET(
	_req: NextRequest,
	{ params }: { params: Promise<{ name: string }> },
) {
	try {
		const { name } = await params;
		const { store } = await requireUserContext();
		const metadata = await store.getSecretMetadata(name);
		if (!metadata) {
			return NextResponse.json(
				{ error: `Secret "${name}" not found` },
				{ status: 404 },
			);
		}
		return NextResponse.json(metadata);
	} catch (error) {
		return errorResponse(error);
	}
}

export async function PUT(
	req: NextRequest,
	{ params }: { params: Promise<{ name: string }> },
) {
	try {
		const { name } = await params;
		const { store } = await requireUserContext();
		const body = await req.json();
		const { value, description } = body ?? {};

		if (value !== undefined && typeof value !== "string") {
			return NextResponse.json(
				{ error: "value must be a string" },
				{ status: 400 },
			);
		}
		if (value !== undefined && value === "") {
			return NextResponse.json(
				{
					error:
						"value cannot be empty; omit the field to keep the existing value",
				},
				{ status: 400 },
			);
		}
		if (description !== undefined && typeof description !== "string") {
			return NextResponse.json(
				{ error: "description must be a string" },
				{ status: 400 },
			);
		}

		const existing = await store.getSecretMetadata(name);
		if (!existing) {
			return NextResponse.json(
				{ error: `Secret "${name}" not found` },
				{ status: 404 },
			);
		}

		// Two paths, both deliberately avoid decrypting on the API side:
		//  - value provided: re-encrypt via putSecret (writes new value + lastFour)
		//  - value omitted: only the description changes; updateSecretDescription
		//    leaves the encrypted value untouched and never decrypts it.
		if (value !== undefined) {
			const nextDescription =
				description !== undefined ? description : existing.description;
			try {
				await store.putSecret({ name, value, description: nextDescription });
			} catch (err) {
				return NextResponse.json(
					{ error: String(err instanceof Error ? err.message : err) },
					{ status: 400 },
				);
			}
			return NextResponse.json({
				name,
				lastFour: getLastFour(value),
				updated: true,
			});
		}

		// Description-only update.
		const nextDescription =
			description !== undefined ? description : existing.description;
		const ok = await store.updateSecretDescription(name, nextDescription);
		if (!ok) {
			return NextResponse.json(
				{ error: `Secret "${name}" not found` },
				{ status: 404 },
			);
		}
		return NextResponse.json({
			name,
			lastFour: existing.lastFour,
			updated: true,
		});
	} catch (error) {
		return errorResponse(error);
	}
}

export async function DELETE(
	_req: NextRequest,
	{ params }: { params: Promise<{ name: string }> },
) {
	try {
		const { name } = await params;
		const { store } = await requireUserContext();
		await store.deleteSecret(name);
		return NextResponse.json({ name, deleted: true });
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
