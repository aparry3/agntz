import { isSuperAdmin } from "@/lib/admin";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { MemoryViewer } from "./memory-viewer";

export default async function MemoryPage() {
	const { userId } = await auth();
	if (!userId) redirect("/sign-in");
	if (!isSuperAdmin(userId)) redirect("/agents");

	return <MemoryViewer />;
}
