// Stroke-based icon set lifted from the V3 design prototype (shared.jsx).
// 16x16 grid, currentColor stroke, optional `fill`/`stroke` overrides.

import type { CSSProperties, ReactNode } from "react";

interface IconProps {
	size?: number;
	stroke?: number;
	fill?: string;
	className?: string;
	style?: CSSProperties;
}

function Icon({
	d,
	size = 14,
	stroke = 1.5,
	fill = "none",
	className,
	style,
}: IconProps & { d: ReactNode | string }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 16 16"
			fill={fill}
			stroke="currentColor"
			strokeWidth={stroke}
			strokeLinecap="round"
			strokeLinejoin="round"
			className={className}
			style={style}
		>
			{typeof d === "string" ? <path d={d} /> : d}
		</svg>
	);
}

export const Agents = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M3 3h4v4H3z" />
				<path d="M9 3h4v4H9z" />
				<path d="M3 9h4v4H3z" />
				<path d="M9 9h4v4H9z" />
			</>
		}
	/>
);
export const Skills = (p: IconProps) => (
	<Icon {...p} d="M4 3.5l4 2 4-2M4 3.5v5l4 2 4-2v-5M4 8.5v0M8 5.5v7" />
);
export const Sessions = (p: IconProps) => (
	<Icon {...p} d="M3 4h10M3 8h10M3 12h6" />
);
export const Runs = (p: IconProps) => <Icon {...p} d="M5 3l7 5-7 5V3z" />;
export const Traces = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M2 12h3l2-8 2 8h3" />
				<circle cx="13" cy="12" r="1" />
			</>
		}
	/>
);
export const Logs = (p: IconProps) => (
	<Icon {...p} d="M3 4h10M3 7h10M3 10h7M3 13h4" />
);
export const Memory = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<ellipse cx="8" cy="4" rx="5" ry="2" />
				<path d="M3 4v8c0 1.1 2.24 2 5 2s5-.9 5-2V4" />
				<path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2" />
			</>
		}
	/>
);
export const Tools = (p: IconProps) => (
	<Icon {...p} d="M10.5 2.5l3 3-2 2-3-3 2-2zM10 6L4 12l-1.5.5L3 11l6-6" />
);
export const Settings = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<circle cx="8" cy="8" r="2" />
				<path d="M8 1v2M8 13v2M14 8h-2M4 8H2M12.2 3.8l-1.4 1.4M5.2 10.8l-1.4 1.4M12.2 12.2l-1.4-1.4M5.2 5.2L3.8 3.8" />
			</>
		}
	/>
);
export const Key = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<circle cx="5" cy="11" r="2.5" />
				<path d="M7 9l6-6M11 5l1.5 1.5M9 7l1.5 1.5" />
			</>
		}
	/>
);
export const Link = (p: IconProps) => (
	<Icon
		{...p}
		d="M6.5 9.5l3-3M5.5 10.5l-1 1a2.1 2.1 0 11-3-3l2-2a2.1 2.1 0 013 0M10.5 5.5l1-1a2.1 2.1 0 113 3l-2 2a2.1 2.1 0 01-3 0"
	/>
);
export const Lock = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<rect x="3" y="7" width="10" height="7" rx="0.5" />
				<path d="M5 7V5a3 3 0 016 0v2" />
			</>
		}
	/>
);
export const Admin = (p: IconProps) => (
	<Icon {...p} d="M8 1l6 2v4c0 4-3 7-6 8-3-1-6-4-6-8V3l6-2z" />
);
export const Search = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<circle cx="7" cy="7" r="4" />
				<path d="M10 10l3 3" />
			</>
		}
	/>
);
export const Plus = (p: IconProps) => <Icon {...p} d="M8 3v10M3 8h10" />;
export const Chev = (p: IconProps) => <Icon {...p} d="M4 6l4 4 4-4" />;
export const ChevR = (p: IconProps) => <Icon {...p} d="M6 4l4 4-4 4" />;
export const ArrowR = (p: IconProps) => <Icon {...p} d="M3 8h10M9 4l4 4-4 4" />;
export const Copy = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<rect x="5" y="5" width="8" height="8" rx="0.5" />
				<path d="M3 11V3.5a.5.5 0 01.5-.5H11" />
			</>
		}
	/>
);
export const Dot = ({
	size = 8,
	color = "currentColor",
}: { size?: number; color?: string }) => (
	<svg width={size} height={size} viewBox="0 0 8 8">
		<circle cx="4" cy="4" r="3" fill={color} />
	</svg>
);
export const Play = (p: IconProps) => (
	<Icon {...p} d="M5 3l7 5-7 5V3z" fill="currentColor" stroke={0} />
);
export const Ellipsis = (p: IconProps) => (
	<Icon
		{...p}
		stroke={0}
		d={
			<>
				<circle cx="3" cy="8" r="0.8" fill="currentColor" />
				<circle cx="8" cy="8" r="0.8" fill="currentColor" />
				<circle cx="13" cy="8" r="0.8" fill="currentColor" />
			</>
		}
	/>
);
export const Filter = (p: IconProps) => (
	<Icon {...p} d="M2 3h12l-4.5 5.5V13L6.5 11V8.5L2 3z" />
);
export const Sparkle = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M8 2l1.2 3.3L12.5 6.5 9.2 7.7 8 11 6.8 7.7 3.5 6.5l3.3-1.2L8 2z" />
				<path d="M13 11l.5 1.2L14.7 12.7 13.5 13.2 13 14.5l-.5-1.3L11.3 12.7l1.2-.5L13 11z" />
			</>
		}
	/>
);
export const Check = (p: IconProps) => <Icon {...p} d="M3 8l3.5 3.5L13 5" />;
export const Box = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M8 2L2 5v6l6 3 6-3V5L8 2z" />
				<path d="M2 5l6 3 6-3M8 8v6" />
			</>
		}
	/>
);
export const Bolt = (p: IconProps) => (
	<Icon {...p} d="M9 1L3 9h4l-1 6 6-8H8l1-6z" fill="currentColor" stroke={0} />
);
export const Code = (p: IconProps) => (
	<Icon {...p} d="M5 4L2 8l3 4M11 4l3 4-3 4M9 3l-2 10" />
);
export const Eye = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
				<circle cx="8" cy="8" r="2" />
			</>
		}
	/>
);
export const Sliders = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M3 4h7M13 4h0" />
				<circle cx="11.5" cy="4" r="1.5" />
				<path d="M3 12h2M8 12h5" />
				<circle cx="6.5" cy="12" r="1.5" />
				<path d="M3 8h5M11 8h2" />
				<circle cx="9.5" cy="8" r="1.5" />
			</>
		}
	/>
);
export const Hist = (p: IconProps) => (
	<Icon
		{...p}
		d={
			<>
				<path d="M2 8a6 6 0 106-6 6 6 0 00-4.5 2" />
				<path d="M2 2v3h3" />
				<path d="M8 5v3l2 1.5" />
			</>
		}
	/>
);
export const X = (p: IconProps) => <Icon {...p} d="M3 3l10 10M13 3L3 13" />;

export const I = {
	Agents,
	Skills,
	Sessions,
	Runs,
	Traces,
	Logs,
	Memory,
	Tools,
	Settings,
	Key,
	Link,
	Lock,
	Admin,
	Search,
	Plus,
	Chev,
	ChevR,
	ArrowR,
	Copy,
	Dot,
	Play,
	Ellipsis,
	Filter,
	Sparkle,
	Check,
	Box,
	Bolt,
	Code,
	Eye,
	Sliders,
	Hist,
	X,
};
