export function resourceToolPrefix(resourceName: string): string {
  return resourceName.replace(/[^a-zA-Z0-9_]/g, "_");
}

export function makeResourceToolName(resourceName: string, providerToolName: string): string {
  return `${resourceToolPrefix(resourceName)}_${providerToolName}`;
}
