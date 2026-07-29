import { fileURLToPath } from "node:url";
import { agntz } from "@agntz/sdk";

const agents = fileURLToPath(new URL("../../agents", import.meta.url));
const input = process.argv.slice(2).join(" ") || "What can you help me with?";
const client = await agntz({ agents });

try {
	const result = await client.agents.run({ agentId: "chatbot", input });
	process.stdout.write(`${result.output}\n`);
} finally {
	await client.close();
}
