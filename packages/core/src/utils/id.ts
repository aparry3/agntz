import { nanoid } from "nanoid";

export function generateId(prefix?: string): string {
	const id = nanoid(12);
	return prefix ? `${prefix}_${id}` : id;
}

export function generateInvocationId(): string {
	return generateId("inv");
}

export function generateSessionId(): string {
	return generateId("sess");
}

export function generateRunId(): string {
	return generateId("run");
}
