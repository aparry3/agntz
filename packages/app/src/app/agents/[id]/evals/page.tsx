"use client";

import { EvalsWorkspace } from "@/components/evals/evals-workspace";
import { useParams } from "next/navigation";

export default function AgentEvalsPage() {
	const { id } = useParams<{ id: string }>();
	return <EvalsWorkspace agentId={id} />;
}
