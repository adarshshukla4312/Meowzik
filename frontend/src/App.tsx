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
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md flex flex-col gap-8">
        {/* Header / Logo */}
        <div className="text-center flex flex-col items-center">
          <div className="w-16 h-16 bg-meamie-accent/20 text-meamie-accent rounded-2xl flex items-center justify-center mb-6 shadow-[0_0_40px_-10px_rgba(139,92,246,0.5)]">
            <Music size={32} />
          </div>
          <h1 className="text-4xl font-bold tracking-tight mb-2">Meamie</h1>
          <p className="text-meamie-muted text-lg">Synchronized Ad-Free Music</p>
        </div>

        {/* Action Cards */}
        <div className="bg-meamie-surface p-6 rounded-3xl border border-white/5 flex flex-col gap-6 shadow-xl">
          <button
            onClick={handleCreateRoom}
            className="w-full bg-meamie-accent hover:bg-meamie-accent-hover text-white py-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <Plus size={20} />
            Start a New Room
          </button>

          <div className="relative flex items-center py-2">
            <div className="flex-grow border-t border-white/10"></div>
            <span className="flex-shrink-0 mx-4 text-meamie-muted text-sm font-medium">OR</span>
            <div className="flex-grow border-t border-white/10"></div>
          </div>

          <form onSubmit={handleJoinRoom} className="flex gap-2">
            <input
              type="text"
              name="code"
              placeholder="Room Code (e.g. A1B2C3)"
              maxLength={6}
              className="flex-grow bg-[#09090b] border border-white/10 rounded-xl px-4 py-4 text-center font-mono font-bold text-lg uppercase focus:outline-none focus:border-meamie-accent focus:ring-1 focus:ring-meamie-accent transition-all placeholder:text-meamie-muted/50 placeholder:font-sans placeholder:font-normal placeholder:lowercase placeholder:text-base"
              required
            />
            <button
              type="submit"
              className="bg-white/10 hover:bg-white/15 text-white px-6 rounded-xl font-semibold flex items-center transition-colors"
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
