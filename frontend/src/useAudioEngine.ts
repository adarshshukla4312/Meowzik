import { useEffect, useRef, useState, useCallback } from "react";
import { useRoomStore, getClockOffset } from "./store";

const AUDIO_SERVER_URL = import.meta.env.VITE_AUDIO_SERVER_URL || "http://localhost:3001";

export function useAudioEngine() {
  const playback = useRoomStore(s => s.playback);
  const queue = useRoomStore(s => s.queue);
  const addToast = useRoomStore(s => s.addToast);
  const audioServerStatus = useRoomStore(s => s.audioServerStatus);
  const setAudioServerStatus = useRoomStore(s => s.setAudioServerStatus);

  // ─── Refs ───────────────────────────────────────────────────────
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);

  // ─── State ──────────────────────────────────────────────────────
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [localProgress, setLocalProgress] = useState(0);
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  const loadedTrackId = useRef<string | null>(null);
  const isApplyingSync = useRef(false); // prevents echo loops

  const silentAudioBase64 = "data:audio/mpeg;base64,SUQzBAAAAAABAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAZGFzaABUWFhYAAAAEQAAA21pbm9yX3ZlcnNpb24AMABUWFhYAAAAHAAAA2NvbXBhdGlibGVfYnJhbmRzAGlzbzZkYXNoAFRTU0UAAAAPAAADTGF2ZjYwLjMuMTAwAAAAAAAAAAAAAAD/+00AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABYaW5nAAAADwAAAAEAAAAAAAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9AQUpLTE1OT1BSUlNVVldYWVpbXF1eX2BhYmNklJWWl5iZmpucnZ6foKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr/AwcLDxMXGx8jJysvMzc7P0NHS09TV1tfY2drb3N3e3+Di4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/v8AAAAA";

  // ─── Ping Audio Server ─────────────────────────────────────────
  useEffect(() => {
    let retryInterval: any = null;

    const pingServer = async () => {
      try {
        const res = await fetch(`${AUDIO_SERVER_URL}/ping`);
        if (res.ok) {
          setAudioServerStatus("online");
          if (retryInterval) clearInterval(retryInterval);
        } else {
          throw new Error("Server response not ok");
        }
      } catch (e) {
        setAudioServerStatus("offline");
      }
    };

    pingServer();

    // Retry every 10 seconds if offline
    if (audioServerStatus !== "online") {
      retryInterval = setInterval(pingServer, 10000);
    }

    return () => {
      if (retryInterval) clearInterval(retryInterval);
    };
  }, [audioServerStatus, setAudioServerStatus]);

  // ─── Create native <audio> element on mount ──────────────────────
  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;

    // Buffering state
    audio.addEventListener("waiting", () => setIsBuffering(true));
    audio.addEventListener("playing", () => setIsBuffering(false));
    audio.addEventListener("canplay", () => setIsBuffering(false));

    // Progress tracking
    audio.addEventListener("timeupdate", () => {
      if (!isApplyingSync.current) {
        setLocalProgress(audio.currentTime);
      }
    });

    // Track ended → skip to next
    audio.addEventListener("ended", () => {
      useRoomStore.getState().sendAction({ type: "SKIP_NEXT" });
    });

    // Error handler
    audio.addEventListener("error", (e) => {
      console.warn("Native <audio> error:", e);
      addToast("Audio playback failed. The stream might be geo-blocked or age-restricted.", "error");
    });

    setIsPlayerReady(true);

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    };
  }, [addToast]);

  // ─── User Interaction Unlock ──────────────────────────────────────
  const initAudioContext = useCallback(() => {
    if (hasInteracted) return;
    setHasInteracted(true);

    // Play silent audio for background session on mobile
    const silent = new Audio(silentAudioBase64);
    silent.loop = true;
    silentAudioRef.current = silent;
    silent.play().catch(() => {});

    // Unlock native audio element with user gesture
    const audio = audioRef.current;
    if (audio) {
      audio.play().then(() => audio.pause()).catch(() => {});
    }
  }, [hasInteracted]);

  // ─── Core Sync Logic ──────────────────────────────────────────────
  useEffect(() => {
    if (!isPlayerReady || !audioRef.current) return;

    const currentTrack = queue.find(t => t.id === playback.currentTrackId);
    const audio = audioRef.current;

    if (!currentTrack) {
      // No track → stop everything
      audio.pause();
      audio.removeAttribute("src");
      silentAudioRef.current?.pause();
      setLocalProgress(0);
      loadedTrackId.current = null;
      return;
    }

    // Calculate accurate server-adjusted offset
    const offset = getClockOffset();
    const accurateServerOffset = playback.isPlaying
      ? playback.trackOffset + (Date.now() + offset - playback.startTimestamp) / 1000
      : playback.trackOffset;

    // Track changed → load new source
    if (loadedTrackId.current !== currentTrack.id) {
      loadedTrackId.current = currentTrack.id;
      isApplyingSync.current = true;
      audio.src = `${AUDIO_SERVER_URL}/stream/${currentTrack.id}`;
      audio.load();
      
      if (playback.isPlaying) {
        audio.currentTime = Math.max(0, accurateServerOffset);
        audio.play().catch((err) => {
          console.warn("Audio play failed:", err);
        });
        silentAudioRef.current?.play().catch(() => {});
      } else {
        // Just load and seek, don't play
        audio.addEventListener("loadedmetadata", () => {
          audio.currentTime = Math.max(0, accurateServerOffset);
        }, { once: true });
      }

      // Update MediaSession metadata
      updateMediaSession(currentTrack);
      
      setTimeout(() => { isApplyingSync.current = false; }, 500);
      return; // Don't apply further sync on track change frame
    }

    // Seek correction (only if drift > 2 seconds)
    if (!isApplyingSync.current && Math.abs(audio.currentTime - accurateServerOffset) > 2.0 && accurateServerOffset > 0) {
      isApplyingSync.current = true;
      audio.currentTime = Math.max(0, accurateServerOffset);
      setTimeout(() => { isApplyingSync.current = false; }, 300);
    }

    // Play/pause sync
    if (playback.isPlaying) {
      if (audio.paused) {
        audio.play().catch((err) => {
          console.warn("Audio play failed:", err);
        });
        silentAudioRef.current?.play().catch(() => {});
      }
    } else {
      if (!audio.paused) {
        audio.pause();
        silentAudioRef.current?.pause();
      }
    }
  }, [playback.isPlaying, playback.currentTrackId, playback.startTimestamp, playback.trackOffset, isPlayerReady, queue]);

  // ─── MediaSession Setup ───────────────────────────────────────────
  const updateMediaSession = (track: { id: string; title: string; channel: string; thumbnail?: string }) => {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.channel,
      artwork: [
        { src: `https://i.ytimg.com/vi/${track.id}/mqdefault.jpg`, sizes: "320x180", type: "image/jpeg" },
        { src: `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`, sizes: "480x360", type: "image/jpeg" },
      ],
    });

    // All MediaSession handlers go through room sync — this is the key fix
    // for OS media controls not syncing across room members
    navigator.mediaSession.setActionHandler("play", () => {
      const audio = audioRef.current;
      const currentOffset = audio ? audio.currentTime : 0;
      useRoomStore.getState().sendAction({ type: "PLAY", offset: currentOffset });
    });

    navigator.mediaSession.setActionHandler("pause", () => {
      const audio = audioRef.current;
      const currentOffset = audio ? audio.currentTime : 0;
      useRoomStore.getState().sendAction({ type: "PAUSE", offset: currentOffset });
    });

    navigator.mediaSession.setActionHandler("nexttrack", () => {
      useRoomStore.getState().sendAction({ type: "SKIP_NEXT" });
    });

    navigator.mediaSession.setActionHandler("previoustrack", () => {
      useRoomStore.getState().sendAction({ type: "SKIP_PREV" });
    });

    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime != null) {
        useRoomStore.getState().sendAction({ type: "SEEK", offset: details.seekTime });
      }
    });
  };

  return {
    initAudioContext,
    hasInteracted,
    isBuffering,
    localProgress,
    audioElement: audioRef.current,
  };
}