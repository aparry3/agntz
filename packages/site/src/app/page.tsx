import { FinalCTA } from "@/components/landing/final-cta";
import { FooterX } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { HostedSpotlight } from "@/components/landing/hosted-spotlight";
import { Nav } from "@/components/landing/nav";
import { RunItYourWay } from "@/components/landing/run-it-your-way";
import { RuntimeCapabilities } from "@/components/landing/runtime-capabilities";
import { SelfHostedSpotlight } from "@/components/landing/self-hosted-spotlight";
import { TheLoop } from "@/components/landing/the-loop";
import { TheShift } from "@/components/landing/the-shift";
import { LanguageProvider } from "@/components/language";

const ACCENT = "purple" as const;

export default function Home() {
  return (
    <>
      <Nav />
      <LanguageProvider>
        <main>
          <Hero accent={ACCENT} />
          <TheShift accent={ACCENT} />
          <TheLoop accent={ACCENT} />
          <RuntimeCapabilities accent={ACCENT} />
          <RunItYourWay accent={ACCENT} />
          <HostedSpotlight accent={ACCENT} />
          <SelfHostedSpotlight accent={ACCENT} />
          <FinalCTA accent={ACCENT} />
        </main>
      </LanguageProvider>
      <FooterX />
    </>
  );
}
