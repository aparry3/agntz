import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'agntz',
  description: 'TypeScript SDK for defining, running, and evaluating AI agents',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
  ],
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/runner' },
      { text: 'Studio', link: '/studio/overview' },
      { text: 'GitHub', link: 'https://github.com/aparry3/agntz' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: '1. What is agntz?', link: '/guide/01-what-is-agntz' },
            { text: '2. Getting Started', link: '/guide/02-getting-started' },
            { text: 'Hello World', link: '/guide/hello-world' },
          ],
        },
        {
          text: 'Core Concepts',
          items: [
            { text: '3. Agents', link: '/guide/03-agents' },
            { text: 'Templates', link: '/guide/templates' },
            { text: '4. Tools', link: '/guide/04-tools' },
            { text: 'Agent Chains', link: '/guide/agent-chains' },
            { text: '5. Skills', link: '/guide/05-skills' },
            { text: '6. Sessions', link: '/guide/06-sessions' },
            { text: '7. Context', link: '/guide/07-context' },
            { text: '8. Runs', link: '/guide/08-runs' },
            { text: '9. Traces', link: '/guide/09-traces' },
            { text: '10. Stores', link: '/guide/10-stores' },
            { text: '11. MCP Integration', link: '/guide/11-mcp' },
            { text: '12. Evals & Testing', link: '/guide/12-evals' },
            { text: 'CI Eval Runs', link: '/guide/ci-evals' },
            { text: '13. Streaming', link: '/guide/13-streaming' },
          ],
        },
        {
          text: 'Architecture',
          items: [
            { text: '14. Runner Internals', link: '/guide/14-runner-architecture' },
            { text: '15. Manifest Layer', link: '/guide/15-manifest' },
            { text: '16. Worker HTTP', link: '/guide/16-worker' },
            { text: '17. App (Next.js)', link: '/guide/17-app' },
            { text: '18. SDK Client', link: '/guide/18-sdk-client' },
            { text: '19. Auth & Multi-tenancy', link: '/guide/19-auth' },
            { text: '20. Deployment', link: '/guide/20-deployment' },
            { text: '21. OpenTelemetry', link: '/guide/21-telemetry' },
          ],
        },
        {
          text: 'Reference',
          items: [
            { text: 'Error Handling & Retry', link: '/guide/error-handling' },
            { text: 'Gymtext Migration', link: '/guide/gymtext-migration' },
          ],
        },
      ],
      '/api/': [
        {
          text: 'API Reference',
          items: [
            { text: 'createRunner()', link: '/api/runner' },
            { text: 'defineAgent()', link: '/api/agent' },
            { text: 'defineTool()', link: '/api/tool' },
            { text: 'Store Interfaces', link: '/api/stores' },
            { text: 'Types', link: '/api/types' },
          ],
        },
      ],
      '/studio/': [
        {
          text: 'Studio',
          items: [
            { text: 'Overview', link: '/studio/overview' },
            { text: 'Agent Editor', link: '/studio/agent-editor' },
            { text: 'Playground', link: '/studio/playground' },
            { text: 'Tool Catalog', link: '/studio/tool-catalog' },
            { text: 'Evals Dashboard', link: '/studio/evals' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/aparry3/agntz' },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'Released under the MIT License.',
    },
  },
})
