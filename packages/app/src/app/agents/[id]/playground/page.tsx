"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function PlaygroundRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/agents/${encodeURIComponent(id)}?mode=play`);
  }, [id, router]);

  return null;
}
