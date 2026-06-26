import { BuilderWorkspace } from "@/components/landing/builder-workspace";
import { FooterX } from "@/components/landing/footer";
import { Nav } from "@/components/landing/nav";
import { LanguageProvider } from "@/components/language";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Build an Agent",
	description:
		"Describe an agent, generate a portable agntz YAML manifest, and run it locally or open it in the hosted builder.",
};

export default function BuildPage() {
	return (
		<>
			<Nav showLanguageToggle />
			<LanguageProvider>
				<main>
					<BuilderWorkspace />
				</main>
			</LanguageProvider>
			<FooterX />
		</>
	);
}
