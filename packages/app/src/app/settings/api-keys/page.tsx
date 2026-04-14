import { ApiKeysPanel } from "./api-keys-panel";

export default function ApiKeysPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold text-zinc-950">API Keys</h1>
      <p className="mb-6 text-sm text-zinc-600">
        Use API keys to call your agents from external apps. Each key is scoped to the
        current workspace. Revoke any time. The full key is shown <strong>once</strong> when created.
      </p>
      <ApiKeysPanel />
    </div>
  );
}
