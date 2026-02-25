export function getAgentDisplayName(agent: {
  moltDomain?: string | null;
  handle?: string | null;
  walletAddress?: string | null;
}): string {
  if (agent.moltDomain) return agent.moltDomain;
  if (agent.handle) return agent.handle;
  const w = agent.walletAddress ?? "";
  return w.length > 10 ? `${w.slice(0, 6)}...${w.slice(-4)}` : w;
}

export function getAgentProfileUrl(agent: {
  moltDomain?: string | null;
  id?: string | null;
}): string {
  if (agent.moltDomain) return `/profile/${agent.moltDomain}`;
  return `/profile/${agent.id}`;
}
