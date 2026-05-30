export const TOKENS = {
	bg: "#F4F1E9",
	surface: "#FBF9F4",
	surface2: "#FFFFFF",
	warm: "#FAF7EE",
	ink: "#1A1916",
	text2: "#52514D",
	muted: "#8C8A82",
	line: "#E2DDD0",
	line2: "#EDE9DD",
	ok: "#1F7A4D",
	okBg: "#E2F0E5",
	warn: "#A05E15",
	warnBg: "#F5E8D2",
	blue: "#2A4A75",
	blueBg: "#E1E8F2",
	purple: "#4E3677",
	purpleBg: "#E9E3F0",
	danger: "#9A2A2A",
} as const;

export type AccentName = "blue" | "purple" | "amber" | "green" | "terracotta";

export const ACCENTS: Record<
	AccentName,
	{ fg: string; bg: string; line: string }
> = {
	blue: { fg: "#2A4A75", bg: "#E1E8F2", line: "#B9C8DE" },
	purple: { fg: "#4E3677", bg: "#E9E3F0", line: "#CEC0E1" },
	amber: { fg: "#A05E15", bg: "#F5E8D2", line: "#E5C994" },
	green: { fg: "#1F7A4D", bg: "#E2F0E5", line: "#A8CFB8" },
	terracotta: { fg: "#B24A24", bg: "#F4E2D6", line: "#E0B89A" },
};
