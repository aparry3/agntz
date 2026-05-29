// CreateGenerating — "drafting manifest" screen shown while /api/agents/build
// is in flight. Reuses the editor shell layout (graph + inspector) but with
// shimmer blocks + a progress checklist on the right.

"use client";

import { I } from "@/components/v3/icons";
import {
	Btn,
	Crumbs,
	Edge,
	HR,
	Mono,
	NodeIO,
	Shimmer,
	Spinner,
	Tag,
	ag,
} from "@/components/v3/primitives";
import type { ReactNode } from "react";

export interface GenerateStep {
	label: string;
	done?: boolean;
	active?: boolean;
	sub?: string;
}

export function CreateGenerating({
	description,
	onStop,
	steps,
	elapsedSeconds,
	etaSeconds,
}: {
	description: string;
	onStop?: () => void;
	steps: GenerateStep[];
	elapsedSeconds: number;
	etaSeconds?: number;
}) {
	const stepIndex = Math.max(
		0,
		steps.findIndex((s) => s.active),
	);
	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				minHeight: "100vh",
				height: "100vh",
			}}
		>
			{/* Slim header */}
			<div
				style={{
					padding: "14px 28px 12px",
					borderBottom: `1px solid ${ag.line2}`,
					background: ag.bg,
					display: "flex",
					alignItems: "center",
					gap: 16,
				}}
			>
				<Crumbs trail={["agntz", "Agents", "Generating…"]} />
				<div style={{ flex: 1 }} />
				<div
					style={{
						display: "inline-flex",
						alignItems: "center",
						gap: 8,
						padding: "4px 10px",
						background: ag.surface2,
						border: `1px solid ${ag.line}`,
						borderRadius: 4,
					}}
				>
					<Spinner />
					<Mono size={11.5} color={ag.text2}>
						Drafting manifest · step {stepIndex + 1} of {steps.length}
					</Mono>
				</div>
				{onStop && (
					<Btn variant="secondary" size="sm" onClick={onStop}>
						Stop
					</Btn>
				)}
			</div>

			<div
				style={{
					flex: 1,
					display: "grid",
					gridTemplateColumns: "1fr 360px",
					minHeight: 0,
				}}
			>
				<GenGraph />
				<GenInspector
					description={description}
					steps={steps}
					elapsedSeconds={elapsedSeconds}
					etaSeconds={etaSeconds}
				/>
			</div>
		</div>
	);
}

function GenGraph() {
	return (
		<div
			style={{
				position: "relative",
				overflow: "hidden",
				backgroundImage: `radial-gradient(${ag.line} 1px, transparent 1px)`,
				backgroundSize: "16px 16px",
				backgroundColor: ag.bg,
				borderRight: `1px solid ${ag.line2}`,
			}}
		>
			{/* Top progress streak */}
			<div
				style={{
					position: "absolute",
					left: 0,
					right: 0,
					top: 0,
					height: 2,
					background: ag.line2,
					overflow: "hidden",
				}}
			>
				<div
					style={{
						position: "absolute",
						left: "-30%",
						top: 0,
						bottom: 0,
						width: "30%",
						background: ag.ink,
						animation: "agntz-bar 1.4s ease-in-out infinite",
					}}
				/>
			</div>

			<div
				style={{
					position: "absolute",
					top: 14,
					left: 18,
					display: "flex",
					alignItems: "center",
					gap: 8,
					background: ag.surface2,
					border: `1px solid ${ag.line}`,
					borderRadius: 4,
					padding: "5px 10px",
				}}
			>
				<Spinner />
				<Mono size={11} color={ag.text2}>
					Composing manifest…
				</Mono>
			</div>

			<div
				style={{
					position: "absolute",
					inset: 0,
					display: "grid",
					placeItems: "center",
					padding: 24,
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
					}}
				>
					<NodeIO label="INPUT" sub="streaming…" />
					<Edge />
					{/* Built */}
					<NodeFinalised
						name="Planner"
						tag="LLM"
						tagBg={ag.blueBg}
						tagFg={ag.blue}
					>
						<Mono size={11.5}>gpt-5.4</Mono>
						<Mono size={11} color={ag.muted}>
							{" "}
							· openai · temp 0.3
						</Mono>
						<div
							style={{
								marginTop: 8,
								fontSize: 11.5,
								color: ag.text2,
								padding: "8px 10px",
								background: ag.surface,
								border: `1px solid ${ag.line2}`,
								borderRadius: 3,
								fontFamily: "var(--font-mono)",
								lineHeight: 1.5,
							}}
						>
							&quot;Read the user&apos;s goals and decide whether they need a
							workout, a meal plan, or both.&quot;
						</div>
					</NodeFinalised>
					<Edge />
					{/* Streaming */}
					<NodeStreaming
						name="Workout Generator"
						tag="Pipeline"
						tagBg={ag.purpleBg}
						tagFg={ag.purple}
					>
						<div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
							<Shimmer h={10} w="60%" />
							<Shimmer h={10} w="92%" />
							<Shimmer h={10} w="80%" />
							<Shimmer h={10} w="40%" />
						</div>
					</NodeStreaming>
					<Edge />
					{/* Ghost */}
					<div
						style={{
							width: 320,
							background: "transparent",
							border: `1px dashed ${ag.line}`,
							borderRadius: 5,
							padding: "10px 12px",
							opacity: 0.7,
						}}
					>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								gap: 8,
								marginBottom: 8,
							}}
						>
							<Tag bg={ag.line2} color={ag.muted} mono>
								LLM
							</Tag>
							<Mono size={11} color={ag.muted}>
								Nutritionist · queued
							</Mono>
						</div>
						<Shimmer h={8} w="70%" style={{ opacity: 0.5 }} />
					</div>
					<Edge />
					<NodeIO label="OUTPUT" sub="composed reply → final" />
				</div>
			</div>

			<div
				style={{
					position: "absolute",
					left: 0,
					right: 0,
					bottom: 0,
					padding: "7px 16px",
					display: "flex",
					alignItems: "center",
					gap: 14,
					background: ag.surface,
					borderTop: `1px solid ${ag.line2}`,
					fontSize: 11.5,
					color: ag.muted,
				}}
			>
				<Mono size={11}>Building draft from your description</Mono>
				<div style={{ flex: 1 }} />
				<Mono size={11}>
					You can stop anytime and keep what&apos;s been generated.
				</Mono>
			</div>
		</div>
	);
}

function NodeFinalised({
	name,
	tag,
	tagBg,
	tagFg,
	children,
}: {
	name: string;
	tag: string;
	tagBg: string;
	tagFg: string;
	children: ReactNode;
}) {
	return (
		<div
			style={{
				width: 320,
				background: ag.surface2,
				border: `1.5px solid ${ag.line}`,
				borderRadius: 5,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					padding: "7px 12px",
					display: "flex",
					alignItems: "center",
					gap: 8,
					borderBottom: `1px solid ${ag.line2}`,
					background: ag.surface,
				}}
			>
				<Tag bg={tagBg} color={tagFg} mono>
					{tag}
				</Tag>
				<div style={{ fontWeight: 500, fontSize: 13, color: ag.ink }}>
					{name}
				</div>
				<div style={{ flex: 1 }} />
				<Tag bg={ag.okBg} color={ag.ok}>
					<I.Check size={9} />
					done
				</Tag>
			</div>
			<div style={{ padding: "10px 12px" }}>{children}</div>
		</div>
	);
}

function NodeStreaming({
	name,
	tag,
	tagBg,
	tagFg,
	children,
}: {
	name: string;
	tag: string;
	tagBg: string;
	tagFg: string;
	children: ReactNode;
}) {
	return (
		<div
			style={{
				width: 320,
				background: ag.surface2,
				border: `1.5px solid ${ag.ink}`,
				borderRadius: 5,
				overflow: "hidden",
				boxShadow: "0 0 0 3px rgba(26,25,22,0.06)",
			}}
		>
			<div
				style={{
					padding: "7px 12px",
					display: "flex",
					alignItems: "center",
					gap: 8,
					borderBottom: `1px solid ${ag.line2}`,
					background: ag.surface,
				}}
			>
				<Tag bg={tagBg} color={tagFg} mono>
					{tag}
				</Tag>
				<div style={{ fontWeight: 500, fontSize: 13, color: ag.ink }}>
					{name}
				</div>
				<div style={{ flex: 1 }} />
				<div style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
					<Spinner />
					<Mono size={10.5} color={ag.muted}>
						writing…
					</Mono>
				</div>
			</div>
			<div style={{ padding: "10px 12px" }}>{children}</div>
		</div>
	);
}

function GenInspector({
	description,
	steps,
	elapsedSeconds,
	etaSeconds,
}: {
	description: string;
	steps: GenerateStep[];
	elapsedSeconds: number;
	etaSeconds?: number;
}) {
	const completed = steps.filter((s) => s.done).length;
	return (
		<aside
			style={{
				background: ag.surface,
				overflow: "auto",
				borderLeft: `1px solid ${ag.line2}`,
			}}
		>
			<div
				style={{
					padding: "12px 18px",
					borderBottom: `1px solid ${ag.line2}`,
					display: "flex",
					alignItems: "center",
					gap: 8,
				}}
			>
				<Spinner />
				<div style={{ fontWeight: 500, fontSize: 13, flex: 1 }}>Generating</div>
				<Mono size={10.5} color={ag.muted}>
					{completed} / {steps.length}
				</Mono>
			</div>
			<div style={{ padding: 18 }}>
				<div
					style={{
						fontSize: 10.5,
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: ag.muted,
						fontWeight: 500,
						marginBottom: 12,
					}}
				>
					Progress
				</div>
				<div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
					{steps.map((s, i) => (
						<div
							key={i}
							style={{
								display: "flex",
								gap: 10,
								paddingBottom: 12,
								position: "relative",
							}}
						>
							{i < steps.length - 1 && (
								<div
									style={{
										position: "absolute",
										left: 7,
										top: 16,
										bottom: 0,
										width: 1,
										background: s.done ? ag.ink : ag.line,
										opacity: s.done ? 1 : 0.6,
									}}
								/>
							)}
							<div
								style={{
									width: 14,
									height: 14,
									borderRadius: 999,
									flex: "0 0 auto",
									background: s.done ? ag.ink : ag.surface2,
									border: `1.5px solid ${s.done || s.active ? ag.ink : ag.line}`,
									display: "grid",
									placeItems: "center",
									color: ag.surface,
									marginTop: 1,
								}}
							>
								{s.done ? (
									<I.Check size={8} />
								) : s.active ? (
									<Spinner size={8} />
								) : null}
							</div>
							<div style={{ flex: 1, minWidth: 0 }}>
								<div
									style={{
										fontSize: 12.5,
										color: s.done || s.active ? ag.ink : ag.muted,
										fontWeight: s.active ? 500 : 400,
									}}
								>
									{s.label}
								</div>
								{s.sub && (
									<Mono
										size={10.5}
										color={ag.muted}
										style={{ marginTop: 2, display: "inline-block" }}
									>
										{s.sub}
									</Mono>
								)}
							</div>
						</div>
					))}
				</div>
				<HR style={{ margin: "8px 0 14px" }} />
				<div
					style={{
						fontSize: 10.5,
						letterSpacing: "0.08em",
						textTransform: "uppercase",
						color: ag.muted,
						fontWeight: 500,
						marginBottom: 6,
					}}
				>
					From your description
				</div>
				<div
					style={{
						fontSize: 12,
						color: ag.text2,
						padding: "10px 12px",
						background: ag.bg,
						border: `1px solid ${ag.line2}`,
						borderRadius: 4,
						lineHeight: 1.55,
						maxHeight: 160,
						overflow: "auto",
					}}
				>
					“{description}”
				</div>
				<div
					style={{
						marginTop: 14,
						display: "flex",
						alignItems: "center",
						gap: 8,
						fontSize: 11,
						color: ag.muted,
					}}
				>
					<Mono size={11}>
						~{elapsedSeconds.toFixed(1)}s elapsed
						{etaSeconds ? ` · est. ${etaSeconds.toFixed(1)}s remaining` : ""}
					</Mono>
				</div>
			</div>
		</aside>
	);
}
