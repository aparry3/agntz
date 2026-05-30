import { LanguageProvider } from "@/components/language";
import { MemrezFinalCTA } from "@/components/memrez-landing/final-cta";
import { MemrezFooter } from "@/components/memrez-landing/footer";
import { MemrezHero } from "@/components/memrez-landing/hero";
import { MemrezHostedSpotlight } from "@/components/memrez-landing/hosted-spotlight";
import { MemrezMemoryCapabilities } from "@/components/memrez-landing/memory-capabilities";
import { MemrezNav } from "@/components/memrez-landing/nav";
import { MemrezParity } from "@/components/memrez-landing/parity";
import { MemrezRunItYourWay } from "@/components/memrez-landing/run-it-your-way";
import { MemrezSelfHostedSpotlight } from "@/components/memrez-landing/self-hosted-spotlight";
import { MemrezTheLoop } from "@/components/memrez-landing/the-loop";
import { MemrezTheShift } from "@/components/memrez-landing/the-shift";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "memrez — Memory your agents can trust",
	description:
		"A durable memory layer for agntz agents. Declare it in YAML, ground every read in a capability grant, and let the runtime tag, dedupe, and curate in the background.",
	openGraph: {
		title: "memrez — Memory your agents can trust",
		description:
			"A durable memory layer for agntz agents. Tagged, scoped, curated.",
	},
};

export default function MemrezPage() {
	return (
		<>
			<MemrezNav />
			<LanguageProvider>
				<main>
					<MemrezHero />
					<MemrezTheShift />
					<MemrezTheLoop />
					<MemrezMemoryCapabilities />
					<MemrezParity />
					<MemrezRunItYourWay />
					<MemrezHostedSpotlight />
					<MemrezSelfHostedSpotlight />
					<MemrezFinalCTA />
				</main>
			</LanguageProvider>
			<MemrezFooter />
		</>
	);
}
