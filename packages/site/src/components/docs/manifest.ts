// Single source of truth for the docs sidebar.
//
// Each page has a `slug` (URL segment under /docs), a `title` (shown in the
// sidebar and as the H1 fallback), and `markdown` (its raw source). The
// catch-all route, the sidebar, the /llms.txt concatenator, and the per-page
// .md route all read this file.

import introduction from "./pages/introduction";
import quickstart from "./pages/quickstart";
import cliQuickstart from "./pages/cli-quickstart";

import conceptsAgents from "./pages/concepts/agents";
import conceptsAgentKinds from "./pages/concepts/agent-kinds";
import conceptsSessions from "./pages/concepts/sessions";
import conceptsRunsAndTraces from "./pages/concepts/runs-and-traces";

import schemaCommonFields from "./pages/schema/common-fields";
import schemaInputStateOutput from "./pages/schema/input-state-output";
import schemaTemplatesConditions from "./pages/schema/templates-conditions";
import schemaPipelineSteps from "./pages/schema/pipeline-steps";
import schemaSkillsSpawnableReply from "./pages/schema/skills-spawnable-reply";

import toolsLocal from "./pages/tools/local";
import toolsHttp from "./pages/tools/http";
import toolsMcp from "./pages/tools/mcp";
import toolsAgentAsTool from "./pages/tools/agent-as-tool";

import sdkCliSdk from "./pages/sdk-cli/sdk";
import sdkCliClient from "./pages/sdk-cli/client";
import sdkCliCli from "./pages/sdk-cli/cli";

import deployHostedCloud from "./pages/deploy/hosted-cloud";
import deploySelfHostDocker from "./pages/deploy/self-host-docker";
import deploySelfHostProduction from "./pages/deploy/self-host-production";
import deployHttpApi from "./pages/deploy/http-api";

import compatibility from "./pages/compatibility";
import models from "./pages/models";

export type DocsPage = {
  slug: string;
  title: string;
  description?: string;
  markdown: string;
};

export type DocsGroup = {
  label: string;
  pages: DocsPage[];
};

export const DOCS_GROUPS: DocsGroup[] = [
  {
    label: "Get started",
    pages: [
      {
        slug: "",
        title: "Introduction",
        description:
          "What agntz is, what you can build, and how the three editions fit together.",
        markdown: introduction,
      },
      {
        slug: "quickstart",
        title: "Quickstart",
        description: "Write a YAML agent and run it in 60 seconds with @agntz/sdk.",
        markdown: quickstart,
      },
      {
        slug: "cli-quickstart",
        title: "CLI quickstart",
        description:
          "Scaffold and run agents from your terminal with the agntz CLI.",
        markdown: cliQuickstart,
      },
    ],
  },
  {
    label: "Concepts",
    pages: [
      {
        slug: "concepts/agents",
        title: "Defining agents",
        description: "How agents are declared, and how they compose.",
        markdown: conceptsAgents,
      },
      {
        slug: "concepts/agent-kinds",
        title: "The four agent kinds",
        description:
          "llm, tool, sequential, and parallel — when to use each.",
        markdown: conceptsAgentKinds,
      },
      {
        slug: "concepts/sessions",
        title: "Sessions",
        description:
          "Persist conversation history across runs in embedded and hosted mode.",
        markdown: conceptsSessions,
      },
      {
        slug: "concepts/runs-and-traces",
        title: "Runs and traces",
        description:
          "Every invocation produces a run; every run produces a span tree.",
        markdown: conceptsRunsAndTraces,
      },
    ],
  },
  {
    label: "Schema",
    pages: [
      {
        slug: "schema/common-fields",
        title: "Common fields",
        description: "id, name, description, kind — fields every agent has.",
        markdown: schemaCommonFields,
      },
      {
        slug: "schema/input-state-output",
        title: "Input, state, and output",
        description:
          "inputSchema, the state object pipelines share, and outputSchema.",
        markdown: schemaInputStateOutput,
      },
      {
        slug: "schema/templates-conditions",
        title: "Templates and conditions",
        description:
          "{{}} interpolation, {{#if}} blocks, and the condition mini-language.",
        markdown: schemaTemplatesConditions,
      },
      {
        slug: "schema/pipeline-steps",
        title: "Pipeline steps and looping",
        description: "ref vs agent, when, until, maxIterations, stateKey.",
        markdown: schemaPipelineSteps,
      },
      {
        slug: "schema/skills-spawnable-reply",
        title: "Skills, spawnable, reply",
        description:
          "LLM-only fields for mid-run skill loading, concurrent sub-agents, and streaming replies.",
        markdown: schemaSkillsSpawnableReply,
      },
    ],
  },
  {
    label: "Tools",
    pages: [
      {
        slug: "tools/local",
        title: "Local tools",
        description:
          "JavaScript/TypeScript functions registered at runtime, embedded-only.",
        markdown: toolsLocal,
      },
      {
        slug: "tools/http",
        title: "HTTP tools",
        description:
          "A single HTTP endpoint exposed as a tool, with optional OAuth2 / token-exchange auth.",
        markdown: toolsHttp,
      },
      {
        slug: "tools/mcp",
        title: "MCP tools",
        description: "Discoverable tool servers; wrap, rename, and pin params.",
        markdown: toolsMcp,
      },
      {
        slug: "tools/agent-as-tool",
        title: "Agent-as-tool",
        description: "Expose another agent as a callable tool; tool wrapping.",
        markdown: toolsAgentAsTool,
      },
    ],
  },
  {
    label: "SDK & CLI",
    pages: [
      {
        slug: "sdk-cli/sdk",
        title: "@agntz/sdk",
        description:
          "The embedded runner — runs YAML agents in-process from your code.",
        markdown: sdkCliSdk,
      },
      {
        slug: "sdk-cli/client",
        title: "@agntz/client",
        description:
          "The hosted client — call agents on agntz.co or your self-hosted worker.",
        markdown: sdkCliClient,
      },
      {
        slug: "sdk-cli/cli",
        title: "CLI reference",
        description:
          "Full reference for the agntz CLI: create, run, login, runs, traces.",
        markdown: sdkCliCli,
      },
    ],
  },
  {
    label: "Deploy",
    pages: [
      {
        slug: "deploy/hosted-cloud",
        title: "Hosted cloud",
        description: "Sign up at agntz.co, create an agent, run it.",
        markdown: deployHostedCloud,
      },
      {
        slug: "deploy/self-host-docker",
        title: "Self-host with Docker",
        description: "Run the whole stack locally with docker compose.",
        markdown: deploySelfHostDocker,
      },
      {
        slug: "deploy/self-host-production",
        title: "Self-host in production",
        description: "Deploy the app, worker, and Postgres on Vercel + Railway.",
        markdown: deploySelfHostProduction,
      },
      {
        slug: "deploy/http-api",
        title: "HTTP API reference",
        description: "Worker endpoints, request shape, and system agents.",
        markdown: deployHttpApi,
      },
    ],
  },
  {
    label: "Reference",
    pages: [
      {
        slug: "models",
        title: "Models & providers",
        description:
          "Supported providers, env vars, and using OpenRouter as a one-key gateway to 300+ models.",
        markdown: models,
      },
      {
        slug: "compatibility",
        title: "Compatibility matrix",
        description: "What runs where, today.",
        markdown: compatibility,
      },
    ],
  },
];

const FLAT_PAGES: DocsPage[] = DOCS_GROUPS.flatMap((g) => g.pages);

export function findPageBySlug(slug: string): DocsPage | null {
  const target = slug.replace(/^\/+/, "").replace(/\/+$/, "");
  return FLAT_PAGES.find((p) => p.slug === target) ?? null;
}

export function allPages(): DocsPage[] {
  return FLAT_PAGES;
}

export function adjacent(slug: string): { prev: DocsPage | null; next: DocsPage | null } {
  const target = slug.replace(/^\/+/, "").replace(/\/+$/, "");
  const idx = FLAT_PAGES.findIndex((p) => p.slug === target);
  if (idx === -1) return { prev: null, next: null };
  return {
    prev: idx > 0 ? FLAT_PAGES[idx - 1] : null,
    next: idx < FLAT_PAGES.length - 1 ? FLAT_PAGES[idx + 1] : null,
  };
}
