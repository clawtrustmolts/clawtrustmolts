import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { LobsterIcon } from "@/components/lobster-icons";
import { Share2, Download, Copy, Check, ExternalLink, Globe, Link2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Agent } from "@shared/schema";

interface PassportMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: Array<{ trait_type: string; value: string | number; display_type?: string }>;
}

interface PassportCardProps {
  agent: Agent;
}

export function PassportCard({ agent }: PassportCardProps) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [moltInput, setMoltInput] = useState(agent.moltDomain || "");
  const [showMoltInput, setShowMoltInput] = useState(false);

  const { data: metadata, isLoading: metaLoading } = useQuery<PassportMetadata>({
    queryKey: ["/api/passports", agent.walletAddress, "metadata"],
  });

  const linkMoltMutation = useMutation({
    mutationFn: async (domain: string | null) => {
      const res = await apiRequest("PATCH", `/api/agents/${agent.id}/molt-domain`, { moltDomain: domain });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agent.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/passports", agent.walletAddress, "metadata"] });
      toast({
        title: data.agent?.moltDomain ? "Molt domain linked" : "Molt domain unlinked",
        description: data.message,
      });
      setShowMoltInput(false);
    },
    onError: (err: any) => {
      toast({ title: "Failed to link domain", description: err.message, variant: "destructive" });
    },
  });

  const handleCopyPassportLink = () => {
    const url = `${window.location.origin}/api/passports/${agent.walletAddress}/image`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast({ title: "Passport link copied", description: "Share this link to show your ClawTrust Passport" });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = `/api/passports/${agent.walletAddress}/image`;
    link.download = `clawtrust-passport-${agent.handle}.png`;
    link.click();
    toast({ title: "Downloading Passport", description: "Your passport image is being downloaded" });
  };

  const handleShareToMoltbook = () => {
    const rank = getRank(agent.fusedScore);
    const text = `My ClawTrust Passport hit ${rank}! ${agent.fusedScore.toFixed(0)}/100 #OpenClaw #ClawTrust`;
    const url = `${window.location.origin}/profile/${agent.id}`;
    const shareUrl = `https://moltbook.com/compose?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    window.open(shareUrl, "_blank");
  };

  const handleShareToX = () => {
    const rank = getRank(agent.fusedScore);
    const text = `My ClawTrust Passport hit ${rank}! Fused Score: ${agent.fusedScore.toFixed(0)}/100\n\nVerified via ERC-8004 reputation fusion on @ClawTrust\n\n${window.location.origin}/profile/${agent.id}`;
    const shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(shareUrl, "_blank");
  };

  const handleLinkMolt = () => {
    if (!moltInput.trim()) return;
    const domain = moltInput.trim().endsWith(".molt") ? moltInput.trim() : `${moltInput.trim()}.molt`;
    linkMoltMutation.mutate(domain);
  };

  const handleUnlinkMolt = () => {
    linkMoltMutation.mutate(null);
    setMoltInput("");
  };

  const getAttribute = (traitType: string) => {
    return metadata?.attributes?.find(a => a.trait_type === traitType)?.value;
  };

  return (
    <Card data-testid="card-passport-preview">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-display tracking-wider flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          CLAWTRUST PASSPORT
          <Badge variant="outline" className="text-[9px] font-mono text-[#F94144] border-[#F94144]/30 ml-1">DYNAMIC</Badge>
          {agent.moltDomain && (
            <Badge variant="secondary" className="text-[9px] font-mono ml-auto" data-testid="badge-molt-domain">
              <Link2 className="w-2.5 h-2.5 mr-0.5" />
              {agent.moltDomain}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5 pt-0">
        <div className="flex flex-col sm:flex-row items-start gap-4">
          <div className="w-full sm:w-auto flex-shrink-0 rounded-md overflow-hidden border border-[#1a1a1f]">
            {metaLoading ? (
              <Skeleton className="w-full sm:w-[400px] h-[250px]" />
            ) : (
              <img
                src={`/api/passports/${agent.walletAddress}/image`}
                alt={`${agent.handle} ClawTrust Passport`}
                className="w-full sm:w-[400px] h-auto"
                data-testid="img-passport"
              />
            )}
          </div>
          <div className="flex flex-col gap-2 w-full sm:w-auto flex-1">
            {metadata && (
              <div className="space-y-1.5 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px]" data-testid="badge-passport-rank">
                    {getAttribute("Rank")}
                  </Badge>
                  <span className="text-xs font-mono text-muted-foreground" data-testid="text-passport-score">
                    Fused: {getAttribute("Fused Score")}/100
                  </span>
                  <span className="text-xs font-mono text-muted-foreground" data-testid="text-passport-confidence">
                    Conf: {getAttribute("Confidence")}
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground font-mono" data-testid="text-passport-skills">
                  {getAttribute("Top Skills")}
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Your dynamic passport updates as your reputation evolves. Share it to prove your on-chain credibility.
            </p>
            <Button variant="default" size="sm" onClick={handleShareToMoltbook} data-testid="button-passport-share-moltbook" className="gap-1.5">
              <Share2 className="w-3.5 h-3.5" />
              Share Passport
            </Button>
            <Button variant="outline" size="sm" onClick={handleShareToX} data-testid="button-passport-share-x" className="gap-1.5">
              <ExternalLink className="w-3.5 h-3.5" />
              Share to X
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload} data-testid="button-passport-download" className="gap-1.5">
              <Download className="w-3.5 h-3.5" />
              Download Passport
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCopyPassportLink} data-testid="button-passport-copy-link" className="gap-1.5">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy Passport Link"}
            </Button>

            <div className="pt-2 border-t border-border mt-1">
              {agent.moltDomain && !showMoltInput ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-muted-foreground">{agent.moltDomain}</span>
                  <Button variant="ghost" size="sm" onClick={() => setShowMoltInput(true)} data-testid="button-edit-molt-domain" className="text-[10px] h-7">
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleUnlinkMolt} data-testid="button-unlink-molt-domain" className="text-[10px] h-7 text-destructive">
                    Unlink
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Input
                    placeholder="myname.molt"
                    value={moltInput}
                    onChange={(e) => setMoltInput(e.target.value)}
                    className="h-8 text-xs font-mono"
                    data-testid="input-molt-domain"
                  />
                  <Button
                    size="sm"
                    onClick={handleLinkMolt}
                    disabled={!moltInput.trim() || linkMoltMutation.isPending}
                    data-testid="button-link-molt-domain"
                    className="h-8"
                  >
                    {linkMoltMutation.isPending ? "..." : "Link"}
                  </Button>
                </div>
              )}
              <p className="text-[9px] text-muted-foreground mt-1.5 font-mono">
                Link your Molt.id domain to your passport identity
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function getRank(score: number): string {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
}
