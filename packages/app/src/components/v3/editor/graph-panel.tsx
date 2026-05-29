// GraphPanel — the dotted-canvas surface used by the editor screens. The
// panel itself supplies the zoom controls, optional extra top-right action,
// the centered stage (where the parent injects INPUT → nodes → OUTPUT), and
// a bottom status strip. It's intentionally dumb about what nodes contain.

import { I } from "@/components/v3/icons";
import { Btn, Kbd, Mono, ag } from "@/components/v3/primitives";
import type { ReactNode } from "react";

export function GraphPanel({
	children,
	topRight,
	topLeftExtra,
	status,
	shortcutsHint = true,
}: {
	children: ReactNode;
	topRight?: ReactNode;
	topLeftExtra?: ReactNode;
	status?: ReactNode;
	shortcutsHint?: boolean;
}) {
	return (
		<div
			style={{
				position: "relative",
				overflow: "hidden",
				backgroundImage: `radial-gradient(${ag.line} 1px, transparent 1px)`,
				backgroundSize: "16px 16px",
				backgroundColor: ag.bg,
				borderRight: `1px solid ${ag.line2}`,
				minHeight: 0,
			}}
		>
			{/* Top-left zoom controls */}
			<div
				style={{
					position: "absolute",
					top: 14,
					left: 16,
					display: "flex",
					gap: 6,
					alignItems: "center",
					zIndex: 2,
				}}
			>
				<ZoomControl />
				<Btn variant="secondary" size="sm">
					Fit
				</Btn>
				{topLeftExtra}
			</div>

			{topRight && (
				<div
					style={{
						position: "absolute",
						top: 14,
						right: 16,
						display: "flex",
						gap: 6,
						zIndex: 2,
					}}
				>
					{topRight}
				</div>
			)}

			<div
				style={{
					position: "absolute",
					inset: 0,
					display: "grid",
					placeItems: "center",
					padding: "60px 24px 48px",
					overflow: "auto",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						alignItems: "center",
					}}
				>
					{children}
				</div>
			</div>

			{/* Bottom status strip */}
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
					zIndex: 2,
				}}
			>
				{status}
				<div style={{ flex: 1 }} />
				{shortcutsHint && (
					<Mono size={11}>
						Press <Kbd>?</Kbd> for shortcuts
					</Mono>
				)}
			</div>
		</div>
	);
}

function ZoomControl() {
	return (
		<div
			style={{
				display: "flex",
				border: `1px solid ${ag.line}`,
				borderRadius: 4,
				background: ag.surface2,
				overflow: "hidden",
			}}
		>
			<button
				style={{
					padding: "4px 9px",
					border: 0,
					background: "transparent",
					cursor: "pointer",
					color: ag.text2,
					fontFamily: "inherit",
				}}
				aria-label="Zoom out"
			>
				−
			</button>
			<div
				style={{
					padding: "4px 8px",
					borderLeft: `1px solid ${ag.line2}`,
					borderRight: `1px solid ${ag.line2}`,
					fontSize: 11.5,
					color: ag.text2,
				}}
			>
				100%
			</div>
			<button
				style={{
					padding: "4px 9px",
					border: 0,
					background: "transparent",
					cursor: "pointer",
					color: ag.text2,
					fontFamily: "inherit",
				}}
				aria-label="Zoom in"
			>
				+
			</button>
		</div>
	);
}

export function GraphValidates({
	children = "Validates",
}: { children?: ReactNode }) {
	return (
		<>
			<span>
				<I.Check size={10} style={{ verticalAlign: -1, color: ag.ok }} />{" "}
				{children}
			</span>
			<span>·</span>
		</>
	);
}
