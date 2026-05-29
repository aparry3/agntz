import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export const ArrowIcon = (p: IconProps) => (
	<svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
		<path
			d="M3 7 H11 M7 3 L11 7 L7 11"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export const ExternalIcon = (p: IconProps) => (
	<svg width="11" height="11" viewBox="0 0 12 12" fill="none" {...p}>
		<path
			d="M4 2 H10 V8 M10 2 L4 8 M2 4 V10 H8"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export const GithubIcon = (p: IconProps) => (
	<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}>
		<path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.69-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.69 1.25 3.35.96.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.47.12-3.06 0 0 .97-.31 3.18 1.19a11.05 11.05 0 0 1 5.79 0c2.2-1.5 3.18-1.19 3.18-1.19.63 1.59.24 2.77.12 3.06.73.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.4-5.25 5.69.41.36.78 1.05.78 2.12v3.14c0 .31.21.66.79.55 4.57-1.52 7.86-5.83 7.86-10.91C23.5 5.65 18.35.5 12 .5Z" />
	</svg>
);

export const CheckIcon = (p: IconProps) => (
	<svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}>
		<path
			d="M2 6.5 L5 9.5 L10 3"
			stroke="currentColor"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export const SparkIcon = (p: IconProps) => (
	<svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
		<path
			d="M7 1 L8.5 5.5 L13 7 L8.5 8.5 L7 13 L5.5 8.5 L1 7 L5.5 5.5 Z"
			stroke="currentColor"
			strokeWidth="1.3"
			strokeLinejoin="round"
		/>
	</svg>
);

export const CodeIcon = (p: IconProps) => (
	<svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
		<path
			d="M5 4 L2 7 L5 10 M9 4 L12 7 L9 10"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			strokeLinejoin="round"
		/>
	</svg>
);

export const PinIcon = (p: IconProps) => (
	<svg width="12" height="12" viewBox="0 0 14 14" fill="none" {...p}>
		<path
			d="M7 1 L10 4 L8.5 5.5 L11 8 L8 8 L7 13 L6 8 L3 8 L5.5 5.5 L4 4 Z"
			stroke="currentColor"
			strokeWidth="1.3"
			strokeLinejoin="round"
			fill="currentColor"
			fillOpacity="0.12"
		/>
	</svg>
);

export const EyeIcon = (p: IconProps) => (
	<svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
		<path
			d="M1.5 7 C3 4 5 3 7 3 C9 3 11 4 12.5 7 C11 10 9 11 7 11 C5 11 3 10 1.5 7 Z"
			stroke="currentColor"
			strokeWidth="1.3"
		/>
		<circle cx="7" cy="7" r="1.6" stroke="currentColor" strokeWidth="1.3" />
	</svg>
);

export const BranchIcon = (p: IconProps) => (
	<svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
		<circle cx="3.5" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.3" />
		<circle cx="3.5" cy="11" r="1.5" stroke="currentColor" strokeWidth="1.3" />
		<circle cx="10.5" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.3" />
		<path
			d="M3.5 4.5 V 9.5 M3.5 6 C 3.5 5 5 4.5 10.5 4.5"
			stroke="currentColor"
			strokeWidth="1.3"
		/>
	</svg>
);

export const CubeIcon = (p: IconProps) => (
	<svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
		<path
			d="M7 1 L12 3.5 L12 9.5 L7 12 L2 9.5 L2 3.5 Z M2 3.5 L7 6 L12 3.5 M7 6 V12"
			stroke="currentColor"
			strokeWidth="1.3"
			strokeLinejoin="round"
		/>
	</svg>
);

export const ServerIcon = (p: IconProps) => (
	<svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
		<rect
			x="1.5"
			y="2"
			width="11"
			height="4"
			rx="0.5"
			stroke="currentColor"
			strokeWidth="1.3"
		/>
		<rect
			x="1.5"
			y="8"
			width="11"
			height="4"
			rx="0.5"
			stroke="currentColor"
			strokeWidth="1.3"
		/>
		<circle cx="3.5" cy="4" r="0.6" fill="currentColor" />
		<circle cx="3.5" cy="10" r="0.6" fill="currentColor" />
	</svg>
);
