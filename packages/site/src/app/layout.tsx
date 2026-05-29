import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
	subsets: ["latin"],
	variable: "--font-geist-sans",
	weight: ["300", "400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-geist-mono",
	weight: ["400", "500", "600", "700"],
});

const SITE_URL = "https://agntz.co";
const SITE_TITLE = "Agntz — Describe your agent. Run it.";
const SITE_DESCRIPTION =
	"A declarative runtime for production agents. Define agents in YAML, call your existing APIs, and run anywhere — local, hosted, or self-hosted.";

export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),
	title: {
		default: SITE_TITLE,
		template: "%s | Agntz",
	},
	description: SITE_DESCRIPTION,
	openGraph: {
		type: "website",
		url: SITE_URL,
		siteName: "Agntz",
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
	},
	twitter: {
		card: "summary_large_image",
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
	},
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
			<body>{children}</body>
		</html>
	);
}
