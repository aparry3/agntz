import { findPageBySlug } from "@/components/docs/manifest";
import { ACCENTS, TOKENS } from "@/components/landing/tokens";
import { ImageResponse } from "next/og";

export const runtime = "edge";

const SIZE = { width: 1200, height: 630 };

async function loadGoogleFont(family: string, weight: number, text: string) {
	const url = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&text=${encodeURIComponent(text)}`;
	const css = await (await fetch(url)).text();
	const match = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
	if (!match)
		throw new Error(
			`failed to resolve ${family} ${weight}: ${css.slice(0, 200)}`,
		);
	const res = await fetch(match[1]);
	if (!res.ok) throw new Error(`failed to fetch ${family} ${weight}`);
	return res.arrayBuffer();
}

function uniqueChars(...inputs: string[]): string {
	return Array.from(new Set(inputs.join(""))).join("");
}

function breadcrumbFor(slug: string): string {
	if (!slug) return "Introduction";
	const parts = slug.split("/");
	if (parts.length === 1) return capitalize(parts[0]);
	const group = parts[0];
	const groupLabels: Record<string, string> = {
		concepts: "Concepts",
		schema: "Schema",
		tools: "Tools",
		"sdk-cli": "SDK & CLI",
		deploy: "Deploy",
	};
	return groupLabels[group] ?? capitalize(group);
}

function capitalize(s: string): string {
	return s
		.split("-")
		.map((w) => (w.length === 0 ? w : w[0].toUpperCase() + w.slice(1)))
		.join(" ");
}

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ slug?: string[] }> },
) {
	const { slug } = await params;
	const slugStr = (slug ?? []).join("/");
	const page = findPageBySlug(slugStr);

	const purple = ACCENTS.purple;

	const title = page?.title ?? "Documentation";
	const description =
		page?.description ??
		"Complete guide to defining, running, and shipping AI agents with agntz.";
	const breadcrumb = breadcrumbFor(slugStr);

	const sansGlyphs = uniqueChars(title, description, "Documentation");
	const monoGlyphs = uniqueChars(
		`agntz agntz.co docs local hosted self-host ${breadcrumb}`,
	);

	const [sansRegular, sansMedium, monoRegular, monoMedium] = await Promise.all([
		loadGoogleFont("Geist", 400, sansGlyphs),
		loadGoogleFont("Geist", 500, sansGlyphs),
		loadGoogleFont("Geist+Mono", 400, monoGlyphs),
		loadGoogleFont("Geist+Mono", 600, monoGlyphs),
	]);

	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				background: TOKENS.bg,
				fontFamily: "Geist",
				color: TOKENS.ink,
				padding: "64px 72px",
				position: "relative",
			}}
		>
			{/* faint grid */}
			<div
				style={{
					position: "absolute",
					inset: 0,
					display: "flex",
					backgroundImage: `linear-gradient(${TOKENS.line} 1px, transparent 1px), linear-gradient(90deg, ${TOKENS.line} 1px, transparent 1px)`,
					backgroundSize: "56px 56px",
					opacity: 0.45,
				}}
			/>

			{/* top row: wordmark + docs badge */}
			<div
				style={{
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					height: 44,
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 12 }}>
					<div style={{ display: "flex", width: 36, height: 36 }}>
						<svg width={36} height={36} viewBox="0 0 24 24" fill="none">
							<rect
								x="2"
								y="2"
								width="20"
								height="20"
								rx="2.5"
								stroke={TOKENS.ink}
								strokeWidth="1.6"
							/>
							<path
								d="M7 16 L11 8 L13 8 L17 16 M9 13 H15"
								stroke={TOKENS.ink}
								strokeWidth="1.6"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					</div>
					<div
						style={{
							display: "flex",
							fontFamily: "Geist Mono",
							fontSize: 28,
							fontWeight: 600,
							letterSpacing: "-0.01em",
							color: TOKENS.ink,
							lineHeight: 1,
						}}
					>
						agntz
					</div>
				</div>

				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: 8,
						padding: "7px 14px",
						borderRadius: 999,
						border: `1px solid ${purple.line}`,
						background: purple.bg,
						color: purple.fg,
						fontFamily: "Geist Mono",
						fontSize: 13,
						fontWeight: 500,
						letterSpacing: "0.06em",
						textTransform: "uppercase",
					}}
				>
					Documentation
				</div>
			</div>

			{/* main content */}
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					flex: 1,
					justifyContent: "center",
					marginTop: 8,
					position: "relative",
				}}
			>
				{breadcrumb && (
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 10,
							marginBottom: 22,
							fontFamily: "Geist Mono",
							fontSize: 16,
							color: TOKENS.text2,
							letterSpacing: "0.04em",
							textTransform: "uppercase",
						}}
					>
						<div
							style={{
								display: "flex",
								width: 28,
								height: 1,
								background: TOKENS.text2,
							}}
						/>
						{breadcrumb}
					</div>
				)}

				<div
					style={{
						display: "flex",
						fontSize: 78,
						fontWeight: 500,
						lineHeight: 1.04,
						letterSpacing: "-0.035em",
						color: TOKENS.ink,
						maxWidth: 1050,
					}}
				>
					{title}
				</div>

				<div
					style={{
						display: "flex",
						marginTop: 28,
						fontSize: 26,
						lineHeight: 1.45,
						color: TOKENS.text2,
						maxWidth: 980,
						fontWeight: 400,
					}}
				>
					{description}
				</div>
			</div>

			{/* footer */}
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					marginTop: 24,
					position: "relative",
				}}
			>
				<span
					style={{
						fontFamily: "Geist Mono",
						fontSize: 16,
						color: TOKENS.text2,
						letterSpacing: "0.02em",
					}}
				>
					agntz.co/docs
				</span>
				<span
					style={{
						fontFamily: "Geist Mono",
						fontSize: 14,
						color: TOKENS.muted,
						letterSpacing: "0.04em",
					}}
				>
					local · hosted · self-host
				</span>
			</div>
		</div>,
		{
			...SIZE,
			fonts: [
				{ name: "Geist", data: sansRegular, weight: 400, style: "normal" },
				{ name: "Geist", data: sansMedium, weight: 500, style: "normal" },
				{ name: "Geist Mono", data: monoRegular, weight: 400, style: "normal" },
				{ name: "Geist Mono", data: monoMedium, weight: 600, style: "normal" },
			],
			headers: {
				"Cache-Control": "public, max-age=3600, s-maxage=86400, immutable",
			},
		},
	);
}
