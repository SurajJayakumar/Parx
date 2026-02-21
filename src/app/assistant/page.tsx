"use client";

import { useEffect, useRef, useState } from "react";
import AuthGate from "@/components/AuthGate";

type Role = "user" | "assistant";

interface Message {
  id: number;
  role: Role;
  text: string;
}

const INITIAL_MESSAGES: Message[] = [
  {
    id: 0,
    role: "assistant",
    text: "Hello! I'm your Parkinson's AI assistant. I'm here to help you as a caregiver — I can explain your patient's assessment results, suggest caregiving strategies, answer questions about Parkinson's disease progression, or help you interpret mobility data. How can I help you today?",
  },
];

const SUGGESTIONS = [
  "How do I track my patient's mobility changes?",
  "What are warning signs I should watch for?",
  "What exercises help Parkinson's patients?",
];

function AssistantAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-50">
      <svg
        className="h-4 w-4 text-white dark:text-zinc-900"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z"
        />
      </svg>
    </div>
  );
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages((prev) => [
      ...prev,
      { id: nextId.current++, role: "user", text: trimmed },
      {
        id: nextId.current++,
        role: "assistant",
        text: "(Assistant will be connected later)",
      },
    ]);
    setInput("");
    inputRef.current?.focus();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    sendMessage(input);
  }

  return (
    <AuthGate>
      <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-50 mb-1">
        Caregiver Assistant
      </h1>
      <p className="text-zinc-500 dark:text-zinc-400 mb-6 text-sm">
        Ask questions about your patient&apos;s condition, assessment results, or caregiving strategies.
      </p>

      {/* Chat container */}
      <div className="flex flex-col rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden" style={{ height: "clamp(360px, 60vh, 560px)" }}>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) =>
            msg.role === "assistant" ? (
              <div key={msg.id} className="flex items-start gap-3">
                <AssistantAvatar />
                <div className="rounded-2xl rounded-tl-sm bg-zinc-100 dark:bg-zinc-800 px-4 py-3 max-w-[80%]">
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">{msg.text}</p>
                </div>
              </div>
            ) : (
              <div key={msg.id} className="flex items-end justify-end gap-3">
                <div className="rounded-2xl rounded-br-sm bg-zinc-900 dark:bg-zinc-50 px-4 py-3 max-w-[80%]">
                  <p className="text-sm text-white dark:text-zinc-900">{msg.text}</p>
                </div>
              </div>
            )
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <form
          onSubmit={handleSubmit}
          className="border-t border-zinc-100 dark:border-zinc-800 p-4 flex items-center gap-3"
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message…"
            className="flex-1 min-w-0 rounded-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 px-4 py-2.5 text-sm text-zinc-900 dark:text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.269 20.876L5.999 12zm0 0h7.5"
              />
            </svg>
          </button>
        </form>
      </div>

      {/* Suggestion chips */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => sendMessage(suggestion)}
            className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-3 text-left text-sm text-zinc-600 dark:text-zinc-400 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </AuthGate>
  );
}
