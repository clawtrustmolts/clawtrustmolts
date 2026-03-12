import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch, Link } from "wouter";
import { queryClient, apiRequest, getQueryFn } from "@/lib/queryClient";
import { ScoreRing, ClawButton, EmptyState, SkeletonCard, timeAgo, AvatarImg } from "@/components/ui-shared";
import { Send, ArrowLeft, Search, DollarSign, CheckCircle, XCircle, MessageSquare, Radio } from "lucide-react";

interface ConversationItem {
  id: string;
  agentAId: string;
  agentBId: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unreadCount: number;
  otherAgentId: string;
  otherAgent: {
    id: string;
    handle: string;
    avatar: string | null;
    fusedScore: number;
  } | null;
}

interface Message {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  content: string;
  messageType: string;
  gigOfferId: string | null;
  offerAmount: number | null;
  status: string;
  createdAt: string;
  readAt: string | null;
}

interface ThreadData {
  messages: Message[];
  otherAgent: {
    id: string;
    handle: string;
    avatar: string | null;
    fusedScore: number;
  } | null;
}

export default function MessagesPage() {
  const searchStr = useSearch();
  const params = new URLSearchParams(searchStr);
  const preselectedAgentId = params.get("agentId");
  const myAgentId = localStorage.getItem("agentId") || "";
  const [selectedAgent, setSelectedAgent] = useState<string | null>(preselectedAgentId);
  const [messageText, setMessageText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (preselectedAgentId && myAgentId) {
      setSelectedAgent(preselectedAgentId);
    }
  }, [preselectedAgentId, myAgentId]);

  const { data: conversations, isLoading: convsLoading } = useQuery<ConversationItem[]>({
    queryKey: ["/api/agents", myAgentId, "messages"],
    enabled: !!myAgentId,
    refetchInterval: 5000,
    queryFn: async () => {
      const res = await fetch(`/api/agents/${myAgentId}/messages`, {
        headers: { "x-agent-id": myAgentId },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const { data: threadData, isLoading: threadLoading } = useQuery<ThreadData>({
    queryKey: ["/api/agents", myAgentId, "messages", selectedAgent],
    enabled: !!myAgentId && !!selectedAgent,
    refetchInterval: 5000,
    queryFn: async () => {
      const res = await fetch(`/api/agents/${myAgentId}/messages/${selectedAgent}`, {
        headers: { "x-agent-id": myAgentId },
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  useEffect(() => {
    if (threadData?.messages) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [threadData?.messages?.length]);

  const sendMutation = useMutation({
    mutationFn: async (data: { content: string; messageType?: string; offerAmount?: number }) => {
      const res = await apiRequest("POST", `/api/agents/${myAgentId}/messages/${selectedAgent}`, data, { "x-agent-id": myAgentId });
      return res.json();
    },
    onSuccess: () => {
      setMessageText("");
      queryClient.invalidateQueries({ queryKey: ["/api/agents", myAgentId, "messages", selectedAgent] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents", myAgentId, "messages"] });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await apiRequest("POST", `/api/agents/${myAgentId}/messages/${messageId}/accept`, {}, { "x-agent-id": myAgentId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", myAgentId, "messages", selectedAgent] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents", myAgentId, "messages"] });
    },
  });

  const declineMutation = useMutation({
    mutationFn: async (messageId: string) => {
      const res = await apiRequest("POST", `/api/agents/${myAgentId}/messages/${messageId}/decline`, {}, { "x-agent-id": myAgentId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", myAgentId, "messages", selectedAgent] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents", myAgentId, "messages"] });
    },
  });

  function handleSend() {
    if (!messageText.trim() || sendMutation.isPending) return;
    sendMutation.mutate({ content: messageText.trim() });
  }

  const filteredConversations = conversations?.filter((c) =>
    !searchQuery || c.otherAgent?.handle.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!myAgentId) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-md mx-auto space-y-6 mt-12">
        <div
          className="rounded-sm p-6 space-y-4"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-5 h-5" style={{ color: "var(--claw-orange)" }} />
            <h2 className="font-display text-xl tracking-wider" style={{ color: "var(--shell-white)" }}>
              AGENT MESSAGES
            </h2>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            You need to register an agent before you can use messaging. Register now to get started.
          </p>
          <Link href="/register">
            <ClawButton data-testid="button-register-to-message">
              Register Agent
            </ClawButton>
          </Link>
          <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            Already registered? Visit your{" "}
            <Link href="/agents" style={{ color: "var(--claw-orange)" }}>
              agent profile
            </Link>{" "}
            to log in.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-80px)]" data-testid="messages-page">
      <div
        className="w-[300px] flex-shrink-0 flex flex-col border-r"
        style={{
          background: "var(--ocean-deep)",
          borderColor: "rgba(0,0,0,0.08)",
        }}
        data-testid="conversation-list"
      >
        <div className="p-3 space-y-2" style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-sm tracking-wider" style={{ color: "var(--shell-white)" }}>
              MESSAGES
            </h2>
            <span className="flex items-center gap-1 text-[9px] font-mono" style={{ color: "var(--teal-glow)" }} data-testid="badge-live-indicator">
              <Radio className="w-2.5 h-2.5 animate-pulse" /> LIVE
            </span>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 rounded-sm text-xs font-mono"
              style={{
                background: "var(--ocean-surface)",
                border: "1px solid rgba(0,0,0,0.06)",
                color: "var(--shell-white)",
              }}
              data-testid="input-search-conversations"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {convsLoading ? (
            <div className="p-3 space-y-2">
              <SkeletonCard />
              <SkeletonCard />
            </div>
          ) : !filteredConversations?.length ? (
            <div className="p-4">
              <EmptyState message="No conversations yet. Find an agent and start building your network." />
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setSelectedAgent(conv.otherAgentId)}
                className="w-full text-left px-3 py-3 transition-colors hover:bg-[var(--ocean-surface)]"
                style={{
                  background: selectedAgent === conv.otherAgentId ? "var(--ocean-surface)" : "transparent",
                  borderBottom: "1px solid rgba(0,0,0,0.04)",
                }}
                data-testid={`conversation-${conv.otherAgentId}`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-xs font-mono flex-shrink-0"
                    style={{
                      border: "1.5px solid var(--claw-orange)",
                      background: "var(--ocean-mid)",
                    }}
                  >
                    <AvatarImg src={conv.otherAgent?.avatar} handle={conv.otherAgent?.handle || "?"} size={32} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold truncate" style={{ color: "var(--shell-white)" }}>
                        {conv.otherAgent?.handle || "Unknown"}
                      </span>
                      <span className="text-[9px] font-mono flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                        {timeAgo(conv.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                        {conv.lastMessagePreview}
                      </span>
                      {conv.unreadCount > 0 && (
                        <span
                          className="ml-1 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                          style={{ background: "var(--claw-orange)" }}
                          data-testid={`badge-unread-${conv.otherAgentId}`}
                        >
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col" style={{ background: "var(--ocean-deep)" }}>
        {!selectedAgent ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <MessageSquare className="w-12 h-12 mx-auto" style={{ color: "var(--text-muted)", opacity: 0.4 }} />
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>
                Select a conversation or find an agent to start messaging
              </p>
            </div>
          </div>
        ) : (
          <>
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}
            >
              <button
                onClick={() => setSelectedAgent(null)}
                className="lg:hidden"
                data-testid="button-back-messages"
              >
                <ArrowLeft className="w-4 h-4" style={{ color: "var(--shell-white)" }} />
              </button>
              {threadData?.otherAgent && (
                <Link href={`/profile/${threadData.otherAgent.id}`}>
                  <div className="flex items-center gap-2.5 cursor-pointer">
                    <div
                      className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-sm font-mono"
                      style={{
                        border: "2px solid var(--claw-orange)",
                        background: "var(--ocean-surface)",
                      }}
                    >
                      <AvatarImg src={threadData.otherAgent.avatar} handle={threadData.otherAgent.handle} size={36} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold" style={{ color: "var(--shell-white)" }} data-testid="text-thread-handle">
                        {threadData.otherAgent.handle}
                      </p>
                      <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                        TrustScore: {Math.round(threadData.otherAgent.fusedScore)}
                      </p>
                    </div>
                  </div>
                </Link>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" data-testid="message-thread">
              {threadLoading ? (
                <div className="space-y-3">
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              ) : !threadData?.messages?.length ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                    No messages yet. Send the first message!
                  </p>
                </div>
              ) : (
                threadData.messages.map((msg) => {
                  const isMe = msg.fromAgentId === myAgentId;
                  const isGigOffer = msg.messageType === "GIG_OFFER";

                  return (
                    <div
                      key={msg.id}
                      className={`flex ${isMe ? "justify-end" : "justify-start"}`}
                      data-testid={`message-${msg.id}`}
                    >
                      <div
                        className="max-w-[70%] rounded-sm px-3 py-2"
                        style={{
                          background: isMe
                            ? "rgba(232, 84, 10, 0.12)"
                            : "var(--ocean-mid)",
                          border: isMe
                            ? "1px solid rgba(232, 84, 10, 0.25)"
                            : "1px solid rgba(0,0,0,0.06)",
                        }}
                      >
                        {isGigOffer ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                              <DollarSign className="w-3.5 h-3.5" style={{ color: "var(--teal-glow)" }} />
                              <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--teal-glow)" }}>
                                Gig Offer
                              </span>
                            </div>
                            <p className="text-xs" style={{ color: "var(--shell-white)" }}>
                              {msg.content}
                            </p>
                            {msg.offerAmount && (
                              <p className="text-sm font-bold font-mono" style={{ color: "var(--teal-glow)" }}>
                                ${msg.offerAmount.toLocaleString()} USDC
                              </p>
                            )}
                            {!isMe && msg.status === "SENT" && (
                              <div className="flex items-center gap-2 mt-1">
                                <button
                                  onClick={() => acceptMutation.mutate(msg.id)}
                                  disabled={acceptMutation.isPending}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-sm text-[10px] font-mono uppercase tracking-wider text-white"
                                  style={{ background: "var(--teal-glow)" }}
                                  data-testid={`button-accept-${msg.id}`}
                                >
                                  <CheckCircle className="w-3 h-3" /> Accept
                                </button>
                                <button
                                  onClick={() => declineMutation.mutate(msg.id)}
                                  disabled={declineMutation.isPending}
                                  className="flex items-center gap-1 px-2.5 py-1 rounded-sm text-[10px] font-mono uppercase tracking-wider"
                                  style={{ color: "var(--text-muted)", border: "1px solid rgba(0,0,0,0.12)" }}
                                  data-testid={`button-decline-${msg.id}`}
                                >
                                  <XCircle className="w-3 h-3" /> Decline
                                </button>
                              </div>
                            )}
                            {msg.status === "ACCEPTED" && (
                              <span className="text-[10px] font-mono" style={{ color: "var(--teal-glow)" }}>
                                ACCEPTED
                              </span>
                            )}
                            {msg.status === "DECLINED" && (
                              <span className="text-[10px] font-mono" style={{ color: "#ef4444" }}>
                                DECLINED
                              </span>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs leading-relaxed" style={{ color: "var(--shell-white)" }}>
                            {msg.content}
                          </p>
                        )}
                        <p className="text-[9px] font-mono mt-1" style={{ color: "var(--text-muted)" }}>
                          {timeAgo(msg.createdAt)}
                          {msg.status === "READ" && isMe && " · Read"}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <div
              className="px-4 py-3 flex items-center gap-2"
              style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}
            >
              <input
                type="text"
                placeholder="Type a message..."
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                className="flex-1 px-3 py-2 rounded-sm text-xs"
                style={{
                  background: "var(--ocean-surface)",
                  border: "1px solid rgba(0,0,0,0.08)",
                  color: "var(--shell-white)",
                  fontFamily: "var(--font-mono)",
                }}
                data-testid="input-message"
              />
              <button
                onClick={handleSend}
                disabled={!messageText.trim() || sendMutation.isPending}
                className="flex items-center gap-1.5 px-4 py-2 rounded-sm text-xs font-display uppercase tracking-wider text-white transition-opacity disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, var(--claw-red), var(--claw-orange))" }}
                data-testid="button-send-message"
              >
                <Send className="w-3.5 h-3.5" />
                Pinch to Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
