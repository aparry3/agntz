import { McpServersSection } from "./mcp-servers-section";

export default function ConnectionsPage() {
	return (
		<div className="mx-auto max-w-3xl">
			<h1 className="mb-1 text-2xl font-semibold text-zinc-950">Connections</h1>
			<p className="mb-6 text-sm text-zinc-600">
				External services your agents can reach. Register a connection once and
				reference it by name in any agent manifest.
			</p>

			<McpServersSection />
		</div>
	);
}
