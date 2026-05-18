import { BottomCTA } from "@/components/landing/bottom-cta";
import { CompositionSpotlight } from "@/components/landing/composition-spotlight";
import { FooterX } from "@/components/landing/footer";
import { Hero } from "@/components/landing/hero";
import { HostingTable } from "@/components/landing/hosting-table";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Integrations } from "@/components/landing/integrations";
import { Nav } from "@/components/landing/nav";
import { ObservabilitySpotlight } from "@/components/landing/observability-spotlight";
import { Pillars } from "@/components/landing/pillars";
import { Pricing } from "@/components/landing/pricing";
import { VersioningSpotlight } from "@/components/landing/versioning-spotlight";
import { WhoItsFor } from "@/components/landing/who-its-for";

const H1 = "Ship AI in your product. See every step it takes.";
const ACCENT = "blue" as const;

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero h1={H1} accent={ACCENT} />
        <Pillars accent={ACCENT} />
        <HowItWorks accent={ACCENT} />
        <ObservabilitySpotlight accent={ACCENT} />
        <VersioningSpotlight accent={ACCENT} />
        <CompositionSpotlight accent={ACCENT} />
        <WhoItsFor accent={ACCENT} />
        <HostingTable accent={ACCENT} />
        <Pricing accent={ACCENT} />
        <Integrations accent={ACCENT} />
        <BottomCTA accent={ACCENT} />
      </main>
      <FooterX />
    </>
  );
}
