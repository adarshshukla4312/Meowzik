import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useRoomStore } from "./store";
import { Play, Pause, SkipForward, Users, Search, Plus, Trash2, Music } from "lucide-react";

import { useAudioEngine } from "./useAudioEngine";

export default function RoomPage() {
  const { code } = useParams();
  const { 
    isConnected, 
    playback, 
    queue, 
    memberCount, 
    connect, 
    disconnect, 
    sendAction 
  } = useRoomStore();

  const { initAudioContext, hasInteracted, isBuffering, localProgress } = useAudioEngine();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    if (code) {
      connect(code);
    }
    return () => disconnect();
  }, [code, connect, disconnect]);

  const handlePlayPause = () => {
    if (!playback.currentTrackId) return;
    
    // Optimistic / simple time parsing
    const timeSinceStart = playback.isPlaying 
      ? (Date.now() - playback.startTimestamp) / 1000 
      : 0;
    
    const currentOffset = playback.trackOffset + timeSinceStart;

    if (playback.isPlaying) {
      sendAction({ type: "PAUSE", offset: currentOffset });
    } else {
      sendAction({ type: "PLAY", offset: currentOffset });
    }
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    sendAction({ type: "SEEK", offset: time });
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8788";
      const res = await fetch(`${API_URL}/api/search?q=${encodeURIComponent(searchQuery)}`);
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setSearchResults(data.items || data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const addToQueue = (track: any) => {
    sendAction({ 
      type: "QUEUE_ADD", 
      track: {
        id: track.url.split("?v=")[1] || track.url.split("/").pop() || Math.random().toString(),
        title: track.title,
        channel: track.uploaderName,
        thumbnail: track.thumbnail,
        duration: track.duration,
      } 
    });
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="animate-pulse flex flex-col items-center gap-4 text-meamie-muted">
          <div className="w-12 h-12 border-4 border-meamie-accent border-t-transparent rounded-full animate-spin"></div>
          <p>Connecting to {code} at the Edge...</p>
        </div>
      </div>
    );
  }

  const currentTrack = queue.find(t => t.id === playback.currentTrackId);

  return (
    <div className="min-h-screen bg-meamie-bg text-meamie-text flex flex-col md:flex-row relative">
      
      {/* iOS Safari Audio Unlock Overlay */}
      {!hasInteracted && (
        <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-4 text-center">
          <div className="w-20 h-20 bg-meamie-accent/20 text-meamie-accent rounded-full flex items-center justify-center mb-6 animate-pulse">
            <Music size={40} />
          </div>
          <h2 className="text-3xl font-bold mb-4">Ready to Listen?</h2>
          <p className="text-meamie-muted mb-8 max-w-md">
            To automatically sync audio and bypass mobile browser restrictions, we need you to tap below to initialize the audio engine.
          </p>
          <button 
            onClick={initAudioContext}
            className="bg-meamie-accent hover:bg-meamie-accent-hover text-white px-8 py-4 rounded-full font-bold text-lg shadow-xl shadow-meamie-accent/20 transition-all hover:scale-105"
          >
            Join Audio & Enter Room
          </button>
        </div>
      )}

      <div className="absolute top-4 right-4 bg-meamie-surface px-4 py-2 rounded-full border border-white/10 flex items-center gap-2 text-sm font-semibold z-10">
        <Users size={16} className="text-meamie-accent" />
        {memberCount}
      </div>

      {/* Main Player & Search */}
      <div className={`flex-1 flex flex-col p-8 pt-16 ${!hasInteracted ? 'blur-md pointer-events-none' : ''} transition-all duration-500`}>
        
        {/* Now Playing */}
        <div className="mb-12 max-w-2xl mx-auto w-full text-center relative">
          {currentTrack ? (
            <div className="flex flex-col items-center animate-in fade-in zoom-in duration-500">
              <div className="relative">
                <img 
                  src={currentTrack.thumbnail} 
                  alt={currentTrack.title} 
                  className={`w-64 h-64 object-cover rounded-3xl shadow-2xl mb-8 ${playback.isPlaying ? 'shadow-meamie-accent/20 border border-meamie-accent/50' : 'border border-white/10 opacity-70'} transition-all duration-500`} 
                />
                {isBuffering && (
                  <div className="absolute inset-0 bg-black/50 rounded-3xl flex items-center justify-center">
                     <div className="w-12 h-12 border-4 border-meamie-accent border-t-transparent rounded-full animate-spin"></div>
                  </div>
                )}
              </div>
              
              <h2 className="text-3xl font-bold mb-2 line-clamp-1">{currentTrack.title}</h2>
              <p className="text-meamie-muted text-lg mb-6">{currentTrack.channel}</p>
              
              {/* Progress Bar */}
              <div className="w-full flex items-center gap-4 mb-8">
                <span className="text-xs text-meamie-muted tabular-nums">{formatTime(localProgress)}</span>
                <input 
                  type="range" 
                  min="0" 
                  max={currentTrack.duration || 100} 
                  value={localProgress || 0}
                  onChange={handleSeek}
                  className="flex-1 h-2 bg-white/10 rounded-full appearance-none cursor-pointer accent-meamie-accent hover:accent-meamie-accent-hover"
                />
                <span className="text-xs text-meamie-muted tabular-nums">{formatTime(currentTrack.duration)}</span>
              </div>

              <div className="flex items-center gap-6">
                <button 
                  onClick={handlePlayPause}
                  className="w-16 h-16 rounded-full bg-meamie-accent hover:bg-meamie-accent-hover text-white flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
                >
                  {playback.isPlaying && !isBuffering ? <Pause size={28} /> : <Play size={28} className="translate-x-1" />}
                </button>
                <button 
                  onClick={() => sendAction({ type: "SKIP_NEXT" })}
                  className="w-12 h-12 rounded-full bg-meamie-surface hover:bg-white/10 flex items-center justify-center transition-colors"
                >
                  <SkipForward size={20} />
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-meamie-muted border-2 border-dashed border-white/10 rounded-3xl">
              <p className="text-xl">Nothing is playing.</p>
              <p className="text-sm">Search and add a track to the queue.</p>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="max-w-2xl mx-auto w-full mt-auto">
          <form onSubmit={handleSearch} className="flex gap-2 mb-6">
            <div className="relative flex-grow">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-meamie-muted" size={20} />
              <input 
                type="text" 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search for music..." 
                className="w-full bg-meamie-surface border border-white/10 rounded-2xl pl-12 pr-4 py-4 text-lg focus:outline-none focus:border-meamie-accent transition-colors"
              />
            </div>
          </form>

          {isSearching && <p className="text-center text-meamie-muted">Searching globally...</p>}
          
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-2">
            {searchResults.map((result: any, idx: number) => (
              <div key={idx} className="bg-meamie-surface hover:bg-white/5 border border-transparent hover:border-white/10 p-3 rounded-xl flex items-center gap-4 transition-colors group">
                <img src={result.thumbnail} className="w-16 h-16 rounded-lg object-cover" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold truncate">{result.title}</h4>
                  <p className="text-sm text-meamie-muted truncate">{result.uploaderName}</p>
                </div>
                <button 
                  onClick={() => addToQueue(result)}
                  className="w-10 h-10 rounded-full bg-white/5 hover:bg-meamie-accent text-white flex items-center justify-center transition-colors opacity-0 group-hover:opacity-100"
                >
                  <Plus size={20} />
                </button>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* Sidebar Queue */}
      <div className="w-full md:w-96 bg-meamie-surface/50 border-l border-white/5 p-6 flex flex-col">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-bold">Up Next</h3>
          <span className="text-meamie-muted text-sm">{queue.length} tracks</span>
        </div>

        <div className="flex flex-col gap-3 flex-1 overflow-y-auto">
          {queue.map((track, idx) => {
            const isPlaying = track.id === playback.currentTrackId;
            return (
              <div key={track.id + idx} className={`flex items-center gap-3 p-3 rounded-xl border ${isPlaying ? 'bg-meamie-accent/10 border-meamie-accent/30' : 'bg-meamie-surface border-white/5'}`}>
                <img src={track.thumbnail} className="w-12 h-12 rounded md object-cover" />
                <div className="flex-1 min-w-0">
                  <h4 className={`text-sm font-semibold truncate ${isPlaying ? 'text-meamie-accent' : 'text-white'}`}>{track.title}</h4>
                  <p className="text-xs text-meamie-muted truncate">{track.channel}</p>
                </div>
                {!isPlaying && (
                  <button 
                    onClick={() => sendAction({ type: "QUEUE_REMOVE", trackId: track.id })}
                    className="text-meamie-muted hover:text-red-400 p-2"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            );
          })}
          {queue.length === 0 && (
             <p className="text-center text-meamie-muted text-sm mt-10">Queue is empty</p>
          )}
        </div>
      </div>
    </div>
  );
}
