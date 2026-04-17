---
layout: home
hero:
  name: agntz
  text: AI Agents as Data
  tagline: A TypeScript SDK for defining, running, and evaluating AI agents with first-class MCP support, pluggable storage, and a built-in Studio.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/aparry3/agntz

features:
  - icon: 📦
    title: Agents as Config
    details: Agent definitions are JSON-serializable data — store them in files, databases, or define them in the Studio UI. No code coupling.
  - icon: 🔌
    title: Pluggable Everything
    details: Bring your own storage, model providers, and tools. Clean interfaces with built-in JSON file, in-memory, and SQLite stores.
  - icon: 🛠️
    title: MCP Native
    details: First-class Model Context Protocol support. Connect to MCP servers for tool discovery, or expose your agents as MCP tools.
  - icon: 🎨
    title: Built-in Studio
    details: "npx agntz studio — a visual dev UI for creating agents, testing in the playground, browsing tools, and running evals."
  - icon: ✅
    title: Evals Built In
    details: Define test cases with assertions (contains, regex, JSON schema, LLM-as-judge, semantic similarity) and run them from code, CLI, or Studio.
  - icon: ⚡
    title: Five-Line Hello World
    details: createRunner → defineAgent → invoke → output. Zero config to start, infinite extensibility when you need it.
---
