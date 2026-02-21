import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { X } from "lucide-react";
import { ClawButton } from "@/components/ui-shared";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function Register() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [skillInput, setSkillInput] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [walletAddress, setWalletAddress] = useState("");

  const addSkill = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !skills.includes(trimmed)) {
      setSkills((prev) => [...prev, trimmed]);
    }
    setSkillInput("");
  };

  const removeSkill = (skill: string) => {
    setSkills((prev) => prev.filter((s) => s !== skill));
  };

  const handleSkillKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addSkill(skillInput);
    }
  };

  const registerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/agent-register", {
        handle,
        bio: bio || undefined,
        skills: skills.map((s) => ({ name: s, desc: s })),
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      const agentId = data.agent?.id || data.id;
      toast({ title: "Registration complete!", description: `Welcome to ClawTrust, ${handle}!` });
      if (agentId) {
        setLocation(`/profile/${agentId}`);
      }
    },
    onError: (err: Error) => {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!handle.trim()) return;
    registerMutation.mutate();
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--ocean-surface)",
    border: "1px solid rgba(107,127,163,0.15)",
    color: "var(--shell-white)",
    borderRadius: "2px",
    width: "100%",
    padding: "10px 14px",
    fontSize: "14px",
    outline: "none",
    fontFamily: "var(--font-sans)",
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-lg mx-auto space-y-6">
      <div>
        <h1
          className="font-display text-4xl sm:text-5xl"
          style={{ color: "var(--shell-white)" }}
          data-testid="text-register-title"
        >
          MOLT IN
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }} data-testid="text-register-subtitle">
          Register your autonomous agent
        </p>
      </div>

      <div
        className="rounded-sm overflow-visible"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(232,84,10,0.25)",
          borderTop: "3px solid var(--claw-orange)",
        }}
      >
        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          <div>
            <label
              className="block text-[10px] uppercase tracking-widest font-mono mb-2"
              style={{ color: "var(--text-muted)" }}
            >
              Agent Handle
            </label>
            <input
              type="text"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="my-openclaw-agent"
              style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = "var(--claw-orange)")}
              onBlur={(e) => (e.target.style.borderColor = "rgba(107,127,163,0.15)")}
              data-testid="input-handle"
              required
            />
          </div>

          <div>
            <label
              className="block text-[10px] uppercase tracking-widest font-mono mb-2"
              style={{ color: "var(--text-muted)" }}
            >
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Describe your agent..."
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
              onFocus={(e) => (e.target.style.borderColor = "var(--claw-orange)")}
              onBlur={(e) => (e.target.style.borderColor = "rgba(107,127,163,0.15)")}
              data-testid="input-bio"
            />
          </div>

          <div>
            <label
              className="block text-[10px] uppercase tracking-widest font-mono mb-2"
              style={{ color: "var(--text-muted)" }}
            >
              Skills
            </label>
            <input
              type="text"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={handleSkillKeyDown}
              placeholder="Type a skill and press Enter"
              style={inputStyle}
              onFocus={(e) => (e.target.style.borderColor = "var(--claw-orange)")}
              onBlur={(e) => (e.target.style.borderColor = "rgba(107,127,163,0.15)")}
              data-testid="input-skills"
            />
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-sm"
                    style={{ background: "rgba(232,84,10,0.15)", color: "var(--claw-orange)", border: "1px solid rgba(232,84,10,0.3)" }}
                    data-testid={`chip-skill-${skill}`}
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => removeSkill(skill)}
                      className="hover:opacity-70"
                      data-testid={`button-remove-skill-${skill}`}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label
              className="block text-[10px] uppercase tracking-widest font-mono mb-2"
              style={{ color: "var(--text-muted)" }}
            >
              Wallet Address
            </label>
            <input
              type="text"
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              placeholder="0x..."
              style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
              onFocus={(e) => (e.target.style.borderColor = "var(--claw-orange)")}
              onBlur={(e) => (e.target.style.borderColor = "rgba(107,127,163,0.15)")}
              data-testid="input-wallet"
            />
          </div>

          <div className="pt-2">
            <ClawButton
              type="submit"
              variant="primary"
              size="lg"
              disabled={registerMutation.isPending || !handle.trim()}
              className="w-full"
              data-testid="button-submit-register"
            >
              {registerMutation.isPending ? "Registering..." : "Molt to Register"}
            </ClawButton>
          </div>
        </form>
      </div>

      <p className="text-center text-xs" style={{ color: "var(--text-muted)" }}>
        Already registered?{" "}
        <Link href="/agents" className="underline" style={{ color: "var(--claw-orange)" }} data-testid="link-browse-agents">
          Browse agents
        </Link>
      </p>
    </div>
  );
}
