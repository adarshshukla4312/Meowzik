import React from "react";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { Music, Plus, LogIn } from "lucide-react";

// ─── Landing Page ──────────────────────────────────────────────────────────
function LandingPage() {
  const navigate = useNavigate();

  const handleCreateRoom = async () => {
    try {
      const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8788";
      const res = await fetch(`${API_URL}/api/room`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to create room");
      const data = await res.json();
      navigate(`/room/${data.code}`);
    } catch (e) {
      console.error(e);
      alert("Error creating room. Ensure the Cloudflare Worker is running.");
    }
  };

  const handleJoinRoom = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const code = formData.get("code")?.toString().trim().toUpperCase();
    if (code && code.length === 6) {
      navigate(`/room/${code}`);
    } else {
      alert("Please enter a valid 6-character room code.");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-meowzik-bg text-meowzik-text">
      <div className="w-full max-w-md flex flex-col gap-10">
        {/* Header / Logo */}
        <div className="text-center flex flex-col items-center">
          <div className="w-16 h-16 bg-meowzik-surface-dark rounded-full flex items-center justify-center mb-6">
            <Music size={32} className="text-meowzik-accent" />
          </div>
          <h1 className="text-[52px] font-display font-bold leading-[64px] tracking-tight mb-2">Meowzik</h1>
          <p className="text-meowzik-muted text-lg font-medium">Synchronized Ad-Free Music</p>
        </div>

        {/* Action Cards */}
        <div className="bg-meowzik-surface p-8 rounded-[16px] flex flex-col gap-6">
          <button
            onClick={handleCreateRoom}
            className="w-full bg-meowzik-accent text-meowzik-text-inverse py-4 rounded-full font-medium text-[16px] flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
          >
            <Plus size={20} />
            Start a New Room
          </button>

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-[#d4d4d8]"></div>
            <span className="flex-shrink-0 mx-4 text-meowzik-muted text-sm font-medium">OR</span>
            <div className="flex-grow border-t border-[#d4d4d8]"></div>
          </div>

          <form onSubmit={handleJoinRoom} className="flex gap-2">
            <input
              type="text"
              name="code"
              placeholder="Room Code (e.g. A1B2C3)"
              maxLength={6}
              className="flex-grow bg-meowzik-surface-dark rounded-none px-4 py-4 text-center font-mono font-bold text-lg uppercase focus:outline-none focus:ring-2 focus:ring-meowzik-accent transition-all placeholder:text-meowzik-muted/70 placeholder:font-sans placeholder:font-normal placeholder:lowercase placeholder:text-base border border-transparent focus:border-meowzik-accent"
              required
            />
            <button
              type="submit"
              className="bg-meowzik-surface-dark hover:bg-[#e2e2e2] text-meowzik-accent px-6 rounded-none font-medium flex items-center transition-colors"
            >
              <LogIn size={20} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

import RoomPage from "./RoomPage";

// ─── App Router ────────────────────────────────────────────────────────────
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/room/:code" element={<RoomPage />} />
      </Routes>
    </BrowserRouter>
  );
}
