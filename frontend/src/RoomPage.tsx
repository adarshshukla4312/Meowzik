import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router-dom";
import { useRoomStore, getClockOffset } from "./store";
import { Play, Pause, SkipForward, SkipBack, Users, Search, Plus, Trash2, Music, Share, X, ListMusic, Shield, ArrowRight, RefreshCw, CheckCircle, XCircle, Info } from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

import { useAudioEngine } from "./useAudioEngine";

// Removed unused getThumbnailQuality

export default function RoomPage() {
  const { code } = useParams();
  const isConnected = useRoomStore(s => s.isConnected);
  const playback = useRoomStore(s => s.playback);
  const queue = useRoomStore(s => s.queue);
  const memberCount = useRoomStore(s => s.memberCount);
  const members = useRoomStore(s => s.members);
  const myRole = useRoomStore(s => s.myRole);
  const connect = useRoomStore(s => s.connect);
  const disconnect = useRoomStore(s => s.disconnect);
  const sendAction = useRoomStore(s => s.sendAction);
  const toasts = useRoomStore(s => s.toasts);
  const removeToast = useRoomStore(s => s.removeToast);
  const addToast = useRoomStore(s => s.addToast);
  const updateAvailable = useRoomStore(s => s.updateAvailable);
  const audioServerStatus = useRoomStore(s => s.audioServerStatus);

  const { initAudioContext, hasInteracted, isBuffering, localProgress } = useAudioEngine();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [visibleCount, setVisibleCount] = useState(5);
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isMembersOpen, setIsMembersOpen] = useState(false);

  useEffect(() => {
    if (code) {
      connect(code);
    }
    return () => disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    const currentTrack = queue.find((t) => t.id === playback.currentTrackId);
    if (currentTrack) {
      document.title = `${playback.isPlaying ? '▶' : '⏸'} ${currentTrack.title} | Meowzik`;
    } else {
      document.title = "Meowzik - Sync & Listen Together";
    }
  }, [playback.currentTrackId, playback.isPlaying, queue]);

  const handlePlayPause = () => {
    if (!playback.currentTrackId) return;
    const timeSinceStart = playback.isPlaying
      ? (Date.now() + getClockOffset() - playback.startTimestamp) / 1000
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

  const onDragEnd = (result: any) => {
    if (!result.destination) return;
    const sourceIdx = result.source.index;
    const destIdx = result.destination.index;
    if (sourceIdx !== destIdx) {
      sendAction({ type: "QUEUE_MOVE", from: sourceIdx, to: destIdx });
    }
  };

  // Seek state: track local drag position, only send to server on release
  const [isSeeking, setIsSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setIsSeeking(true);
    setSeekValue(time);
  };

  const handleSeekCommit = () => {
    if (isSeeking) {
      sendAction({ type: "SEEK", offset: seekValue });
      setIsSeeking(false);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setShowResults(true);
    setVisibleCount(5);
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

  const clearSearch = () => {
    setShowResults(false);
    setSearchResults([]);
    setSearchQuery("");
    setVisibleCount(5);
  };

  const addToQueue = (track: any) => {
    const videoId = track.url?.split("?v=")[1] || track.url?.split("/").pop() || Math.random().toString();

    // Client-side duplicate check (server also validates)
    if (queue.some(t => t.id === videoId)) {
      addToast(`"${track.title}" is already in the queue`, "error");
      return;
    }

    sendAction({
      type: "QUEUE_ADD",
      track: {
        id: videoId,
        title: track.title,
        channel: track.uploaderName,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
        highResThumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        duration: track.duration,
      }
    });
  };

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join my Meowzik Room",
          text: `Listen to music with me! Room Code: ${code}`,
          url,
        });
      } catch (err) {
        console.error("Share failed", err);
      }
    } else {
      navigator.clipboard.writeText(url);
      addToast("Room link copied to clipboard!", "success");
    }
  };

  const handleVersionRefresh = () => {
    localStorage.setItem("meowzik_version", "");
    window.location.reload();
  };

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-meowzik-bg text-meowzik-text flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4 text-meowzik-muted">
          <div className="w-12 h-12 border-4 border-meowzik-accent border-t-transparent rounded-full animate-spin"></div>
          <p className="font-medium text-[16px]">Connecting to {code}...</p>
        </div>
      </div>
    );
  }

  const currentTrack = queue.find(t => t.id === playback.currentTrackId);

  return (
    <div className="min-h-screen bg-meowzik-bg text-meowzik-text flex flex-col md:flex-row relative overflow-hidden">

      {/* iOS Safari Audio Unlock Overlay */}
      {!hasInteracted && (
        <div className="absolute inset-0 z-50 bg-white/90 backdrop-blur-md flex flex-col items-center justify-center p-4 text-center">
          <div className="w-20 h-20 bg-meowzik-surface-dark text-meowzik-accent rounded-full flex items-center justify-center mb-6 animate-pulse">
            <Music size={40} />
          </div>
          <h2 className="text-[32px] font-display font-bold mb-4 tracking-tight">Ready to Listen?</h2>
          <p className="text-meowzik-muted mb-8 max-w-md font-medium text-[16px]">
            To sync audio properly, please tap below to initialize the player.
          </p>
          <button
            onClick={initAudioContext}
            className="bg-meowzik-accent text-meowzik-text-inverse px-8 py-4 rounded-full font-medium text-[16px] transition-transform active:scale-[0.98]"
          >
            Join Audio & Enter Room
          </button>
        </div>
      )}

      {/* Version Update Banner */}
      {updateAvailable && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-meowzik-accent text-meowzik-text-inverse px-4 py-3 flex items-center justify-center gap-3 text-[14px] font-medium shadow-md">
          <RefreshCw size={16} className="animate-spin" style={{ animationDuration: "3s" }} />
          <span>A new update is available!</span>
          <button
            onClick={handleVersionRefresh}
            className="bg-white text-meowzik-accent px-4 py-1 rounded-full text-[13px] font-semibold hover:bg-gray-100 transition-colors"
          >
            Refresh Now
          </button>
        </div>
      )}

      {/* Audio Server Status Indicator */}
      <div className="fixed bottom-4 left-4 z-50 flex items-start gap-2">
        {audioServerStatus === "checking" && (
          <div className="bg-meowzik-surface/90 backdrop-blur-md px-3 py-2 rounded-full border border-gray-200 shadow-sm flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400 status-dot-pulse"></div>
            <span className="text-[13px] font-medium text-meowzik-muted">Connecting...</span>
          </div>
        )}
        {audioServerStatus === "online" && (
          <div className="status-online-fade bg-meowzik-surface/90 backdrop-blur-md px-3 py-2 rounded-full border border-green-200 shadow-sm flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
            <span className="text-[13px] font-medium text-green-700 status-online-text">Audio Server Online</span>
          </div>
        )}
        {audioServerStatus === "offline" && (
          <div className="bg-red-50 border border-red-200 text-red-900 px-3 py-2 rounded-[12px] shadow-sm flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
              <span className="text-[13px] font-semibold">Native Audio Offline</span>
            </div>
            <span className="text-[11px] opacity-80 pl-[18px]">Using standard player</span>
          </div>
        )}
      </div>

      {/* Toast Notifications */}
      <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[55] flex flex-col gap-2 pointer-events-none w-[90%] max-w-sm">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-[12px] shadow-lg text-[14px] font-medium animate-slide-up ${toast.type === "success"
                ? "bg-meowzik-accent text-white"
                : toast.type === "error"
                  ? "bg-red-600 text-white"
                  : "bg-amber-500 text-white"
              }`}
          >
            {toast.type === "success" && <CheckCircle size={16} className="shrink-0" />}
            {toast.type === "error" && <XCircle size={16} className="shrink-0" />}
            {toast.type === "warning" && <Info size={16} className="shrink-0" />}
            <span className="flex-1 line-clamp-2">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Top Bar for Mobile/Desktop */}
      <div className={`absolute top-4 left-4 right-4 flex items-center justify-between z-10 pointer-events-none ${updateAvailable ? 'mt-12' : ''}`}>
        <div className="pointer-events-auto flex gap-2">
          <button onClick={() => setIsMembersOpen(true)} className="bg-meowzik-surface px-4 py-2 rounded-full flex items-center gap-2 text-[14px] font-medium shadow-sm hover:bg-[#e2e2e2] transition-colors">
            <Users size={16} className="text-meowzik-accent" />
            {memberCount}
          </button>
          <button onClick={handleShare} className="bg-meowzik-surface w-10 h-10 rounded-full flex items-center justify-center shadow-sm hover:bg-[#e2e2e2] transition-colors">
            <Share size={16} className="text-meowzik-accent" />
          </button>
        </div>
        <div className="pointer-events-auto md:hidden">
          <button onClick={() => setIsQueueOpen(true)} className="bg-meowzik-surface w-10 h-10 rounded-full flex items-center justify-center shadow-sm hover:bg-[#e2e2e2] transition-colors">
            <ListMusic size={16} className="text-meowzik-accent" />
          </button>
        </div>
      </div>

      {/* Main Player & Search */}
      <div className={`flex-1 flex flex-col p-6 pt-20 h-screen overflow-y-auto pb-32 md:pb-6 ${!hasInteracted ? 'blur-md pointer-events-none' : ''} transition-all duration-500`}>

        {/* Now Playing */}
        <div className="mb-10 max-w-xl mx-auto w-full text-center relative flex-shrink-0">
          {currentTrack ? (
            <div className="flex flex-col items-center animate-in fade-in duration-500">
              <div className="relative mb-6">
                <img
                  src={`https://i.ytimg.com/vi/${currentTrack.id}/maxresdefault.jpg`}
                  alt={currentTrack.title}
                  className={`w-full max-w-[400px] aspect-square object-cover rounded-[16px] shadow-sm ${playback.isPlaying ? 'ring-4 ring-meowzik-surface-dark' : 'opacity-90'} transition-all duration-500`}
                  onError={(e: any) => {
                    if (!e.target.dataset.triedHq) {
                      e.target.dataset.triedHq = "true";
                      e.target.src = `https://i.ytimg.com/vi/${currentTrack.id}/hqdefault.jpg`;
                    } else {
                      e.target.onerror = null;
                      e.target.src = 'https://placehold.co/480x270/efefef/5e5e5e?text=No+Cover';
                    }
                  }}
                />
                {isBuffering && (
                  <div className="absolute inset-0 bg-white/50 backdrop-blur-sm rounded-[16px] flex items-center justify-center">
                    <div className="w-12 h-12 border-4 border-meowzik-accent border-t-transparent rounded-full animate-spin"></div>
                  </div>
                )}
              </div>

              <h2 className="text-[28px] md:text-[32px] font-display font-bold mb-2 line-clamp-1 leading-tight tracking-tight">{currentTrack.title}</h2>
              <p className="text-meowzik-muted text-[16px] mb-6 font-medium">{currentTrack.channel}</p>

              {/* Timeline */}
              <div className="w-full flex items-center gap-4 mb-8 px-4">
                <span className="text-[12px] text-meowzik-muted font-mono">{formatTime(isSeeking ? seekValue : localProgress)}</span>
                <input
                  type="range"
                  min="0"
                  max={currentTrack.duration || 100}
                  value={isSeeking ? seekValue : (localProgress || 0)}
                  onChange={handleSeekInput}
                  onMouseUp={handleSeekCommit}
                  onTouchEnd={handleSeekCommit}
                  className="slider-progress flex-1 h-1.5 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, var(--color-meowzik-accent) ${currentTrack.duration ? ((isSeeking ? seekValue : localProgress) / currentTrack.duration) * 100 : 0}%, #e2e2e2 ${currentTrack.duration ? ((isSeeking ? seekValue : localProgress) / currentTrack.duration) * 100 : 0}%)`
                  }}
                />
                <span className="text-[12px] text-meowzik-muted font-mono">{formatTime(currentTrack.duration)}</span>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-center gap-6 mt-2">
                <button
                  onClick={() => sendAction({ type: "SKIP_PREV" })}
                  className="w-12 h-12 rounded-full bg-meowzik-surface text-meowzik-accent hover:bg-[#e2e2e2] active:bg-[#d5d5d5] flex items-center justify-center transition-all active:scale-95"
                  aria-label="Skip Previous"
                >
                  <SkipBack size={22} fill="currentColor" />
                </button>
                <button
                  onClick={handlePlayPause}
                  className="w-14 h-14 rounded-full bg-meowzik-accent text-meowzik-text-inverse hover:bg-meowzik-accent-hover flex items-center justify-center transition-all active:scale-95 shadow-md"
                  aria-label={playback.isPlaying && !isBuffering ? "Pause" : "Play"}
                >
                  {playback.isPlaying && !isBuffering ? (
                    <Pause size={24} fill="currentColor" />
                  ) : (
                    <Play size={24} fill="currentColor" className="translate-x-0.5" />
                  )}
                </button>
                <button
                  onClick={() => sendAction({ type: "SKIP_NEXT" })}
                  className="w-12 h-12 rounded-full bg-meowzik-surface text-meowzik-accent hover:bg-[#e2e2e2] active:bg-[#d5d5d5] flex items-center justify-center transition-all active:scale-95"
                  aria-label="Skip Next"
                >
                  <SkipForward size={22} fill="currentColor" />
                </button>
              </div>
            </div>
          ) : (
            <div className="text-center py-16 bg-meowzik-surface rounded-[16px]">
              <p className="text-[20px] font-display font-bold mb-2">Nothing is playing.</p>
              <p className="text-meowzik-muted text-[16px] font-medium">Search below and add a track.</p>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="max-w-2xl mx-auto w-full flex-grow flex flex-col">
          <form onSubmit={handleSearch} className="flex gap-2 mb-4 shrink-0">
            <div className="relative flex-grow">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-meowzik-muted" size={20} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search for music..."
                className="w-full bg-meowzik-surface rounded-none pl-12 pr-12 py-4 text-[16px] font-medium focus:outline-none focus:ring-2 focus:ring-meowzik-accent transition-all placeholder:text-meowzik-muted/70"
              />
              {searchQuery.trim() && (
                <button
                  type={showResults ? "button" : "submit"}
                  onClick={showResults ? clearSearch : undefined}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-meowzik-accent text-white flex items-center justify-center hover:opacity-80 transition-all"
                  aria-label={showResults ? "Clear search" : "Search"}
                >
                  {showResults ? <X size={16} /> : <ArrowRight size={16} />}
                </button>
              )}
            </div>
          </form>

          {isSearching && <p className="text-center text-meowzik-muted font-medium py-4 shrink-0">Searching...</p>}

          {showResults && (
            <div className="flex flex-col gap-2 overflow-y-auto pr-2 pb-10">
              {searchResults.slice(0, visibleCount).map((result: any, idx: number) => {
                const videoId = result.url?.split("?v=")[1] || result.url?.split("/").pop();
                const isInQueue = queue.some(t => t.id === videoId);
                return (
                  <div
                    key={idx}
                    className={`bg-meowzik-surface p-3 rounded-[12px] flex items-center gap-4 transition-colors cursor-pointer group ${isInQueue ? 'opacity-60' : 'hover:bg-[#e2e2e2]'}`}
                    onClick={() => addToQueue(result)}
                  >
                    <img
                      src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
                      className="w-16 h-16 rounded-[8px] object-cover"
                      onError={(e: any) => {
                        e.target.onerror = null;
                        e.target.src = 'https://placehold.co/100x100/efefef/5e5e5e?text=Music';
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-[16px] font-medium truncate text-meowzik-accent">{result.title}</h4>
                      <p className="text-[14px] text-meowzik-muted truncate">{result.uploaderName}</p>
                    </div>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-opacity ${isInQueue ? 'bg-green-100 text-green-600 opacity-100' : 'bg-meowzik-bg text-meowzik-accent opacity-100 md:opacity-0 md:group-hover:opacity-100'}`}>
                      {isInQueue ? <CheckCircle size={20} /> : <Plus size={20} />}
                    </div>
                  </div>
                );
              })}
              {searchResults.length > visibleCount && (
                <button
                  onClick={() => setVisibleCount(prev => prev + 5)}
                  className="w-full py-3 mt-2 text-[14px] font-semibold text-meowzik-accent bg-meowzik-surface hover:bg-[#e2e2e2] rounded-[12px] transition-colors"
                >
                  Show More ({searchResults.length - visibleCount} remaining)
                </button>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Sidebar Queue (Desktop) & Drawer (Mobile) */}
      <div className={`fixed inset-y-0 right-0 w-full md:w-[400px] bg-meowzik-bg md:bg-meowzik-surface/30 md:border-l md:border-[#e2e2e2] p-6 flex flex-col transform transition-transform duration-300 z-40 ${isQueueOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'} md:relative`}>
        <div className="flex items-center justify-between mb-6 shrink-0 mt-8 md:mt-0">
          <h3 className="text-[24px] font-display font-bold tracking-tight">Up Next</h3>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-meowzik-muted hidden sm:inline">Autoplay</span>
              <button
                onClick={() => sendAction({ type: "TOGGLE_AUTOPLAY", enabled: !playback.autoplayNext })}
                className={`w-9 h-5 rounded-full flex items-center px-0.5 transition-colors ${playback.autoplayNext ? 'bg-meowzik-accent' : 'bg-[#d5d5d5]'}`}
                aria-label="Toggle Autoplay"
              >
                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${playback.autoplayNext ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
            <span className="text-meowzik-muted text-[14px] font-medium">{queue.length} tracks</span>
            {queue.length > 1 && (
              <button
                onClick={() => {
                  if (window.confirm("Are you sure you want to clear the queue?")) {
                    sendAction({ type: "QUEUE_CLEAR" });
                  }
                }}
                className="text-meowzik-muted hover:text-red-500 transition-colors"
                aria-label="Clear Queue"
                title="Clear Queue"
              >
                <Trash2 size={16} />
              </button>
            )}
            <button onClick={() => setIsQueueOpen(false)} className="md:hidden p-2 bg-meowzik-surface rounded-full hover:bg-[#e2e2e2]">
              <X size={20} />
            </button>
          </div>
        </div>

        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="queue-list">
            {(provided) => (
              <div
                className="flex flex-col gap-2 flex-1 overflow-y-auto"
                {...provided.droppableProps}
                ref={provided.innerRef}
              >
                {queue.map((track, idx, arr) => {
                  const isPlaying = track.id === playback.currentTrackId;
                  const occurrence = arr.slice(0, idx).filter(t => t.id === track.id).length;
                  const stableKey = `${track.id}-${occurrence}`;

                  return (
                    <Draggable key={stableKey} draggableId={stableKey} index={idx}>
                      {(provided, snapshot) => {
                        const draggableContent = (
                          <div
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            className={`flex items-center gap-3 p-3 rounded-[12px] cursor-pointer transition-colors ${isPlaying ? 'bg-[#e2e2e2]' : 'bg-meowzik-surface hover:bg-[#e2e2e2]'} ${snapshot.isDragging ? 'shadow-lg border-2 border-meowzik-accent !bg-white' : 'border-2 border-transparent'}`}
                            style={{
                              ...provided.draggableProps.style,
                              ...(snapshot.isDragging ? { zIndex: 9999 } : {})
                            }}
                            onClick={() => {
                              if (!isPlaying) sendAction({ type: "SET_TRACK", trackId: track.id });
                            }}
                          >
                            <img
                              src={`https://i.ytimg.com/vi/${track.id}/mqdefault.jpg`}
                              className="w-12 h-12 rounded-[8px] object-cover"
                              onError={(e: any) => {
                                e.target.onerror = null;
                                e.target.src = 'https://placehold.co/100x100/efefef/5e5e5e?text=Music';
                              }}
                            />
                            <div className="flex-1 min-w-0">
                              <h4 className={`text-[14px] font-medium truncate ${isPlaying ? 'text-meowzik-accent font-bold' : 'text-meowzik-accent'}`}>{track.title}</h4>
                              <p className="text-[12px] text-meowzik-muted truncate">{track.channel}</p>
                            </div>
                            {!isPlaying && (myRole === 'host') && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  sendAction({ type: "QUEUE_REMOVE", index: idx });
                                }}
                                className="text-meowzik-muted hover:text-meowzik-accent p-2 z-10 relative"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        );

                        // Portal the dragged element to document.body to escape overflow/transform clipping
                        if (snapshot.isDragging) {
                          return createPortal(draggableContent, document.body);
                        }
                        return draggableContent;
                      }}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
                {queue.length === 0 && (
                  <p className="text-center text-meowzik-muted text-[14px] mt-10 font-medium">Queue is empty</p>
                )}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>

      {/* Members Modal */}
      {isMembersOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-meowzik-bg w-full max-w-sm rounded-[16px] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-[24px] font-display font-bold tracking-tight">Room Members</h3>
              <button onClick={() => setIsMembersOpen(false)} className="p-2 bg-meowzik-surface rounded-full hover:bg-[#e2e2e2]">
                <X size={20} />
              </button>
            </div>
            <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto">
              {members.map((m, i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-meowzik-surface rounded-[12px]">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${m.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                    <span className="text-[14px] font-medium text-meowzik-accent">
                      User {m.userId.substring(0, 4)} {m.userId === useRoomStore.getState().userId ? "(You)" : ""}
                    </span>
                  </div>
                  {m.role === 'host' && (
                    <div className="flex items-center gap-1 text-[12px] text-meowzik-muted bg-[#e2e2e2] px-2 py-1 rounded-full font-medium">
                      <Shield size={12} /> Host
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
