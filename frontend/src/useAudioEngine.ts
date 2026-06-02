import { useEffect, useRef, useState, useCallback } from "react";
import { useRoomStore, getClockOffset } from "./store";

const AUDIO_SERVER_URL =
  import.meta.env.VITE_AUDIO_SERVER_URL ||
  (import.meta.env.DEV ? "http://localhost:3001" : "https://meowzik.onrender.com");

type EngineMode = "native-render" | "iframe-fallback" | "none";

export function useAudioEngine() {
  const playback = useRoomStore(s => s.playback);
  const queue = useRoomStore(s => s.queue);
  const addToast = useRoomStore(s => s.addToast);
  const audioServerStatus = useRoomStore(s => s.audioServerStatus);
  const setAudioServerStatus = useRoomStore(s => s.setAudioServerStatus);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const iframeFallbackRef = useRef<any>(null);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  const loadedTrackId = useRef<string | null>(null);
  const isApplyingSync = useRef(false);
  const fallbackToastShown = useRef(false);
  const engineModeRef = useRef<EngineMode>("none");

  const [hasInteracted, setHasInteracted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [localProgress, setLocalProgress] = useState(0);
  const [isPlayerReady, setIsPlayerReady] = useState(false);
  const [engineMode, setEngineMode] = useState<EngineMode>("none");

  const silentAudioBase64 = "data:audio/mpeg;base64,SUQzBAAAAAABAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAZGFzaABUWFhYAAAAEQAAA21pbm9yX3ZlcnNpb24AMABUWFhYAAAAHAAAA2NvbXBhdGlibGVfYnJhbmRzAGlzbzZkYXNoAFRTU0UAAAAPAAADTGF2ZjYwLjMuMTAwAAAAAAAAAAAAAAD/+00AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABYaW5nAAAADwAAAAEAAAAAAAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9AQUpLTE1OT1BSUlNVVldYWVpbXF1eX2BhYmNklJWWl5iZmpucnZ6foKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr/AwcLDxMXGx8jJysvMzc7P0NHS09TV1tfY2drb3N3e3+Di4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/v8AAAAA";

  useEffect(() => {
    engineModeRef.current = engineMode;
  }, [engineMode]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const pingServer = async () => {
      try {
        const res = await fetch(`${AUDIO_SERVER_URL}/ping`, { cache: "no-store" });
        if (!res.ok) throw new Error(`Audio server returned ${res.status}`);
        if (!cancelled) setAudioServerStatus("online");
      } catch {
        if (!cancelled) {
          setAudioServerStatus("offline");
          retryTimer = setTimeout(pingServer, 10_000);
        }
      }
    };

    setAudioServerStatus("checking");
    pingServer();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [setAudioServerStatus]);

  useEffect(() => {
    const audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;

    audio.addEventListener("waiting", () => setIsBuffering(true));
    audio.addEventListener("playing", () => setIsBuffering(false));
    audio.addEventListener("canplay", () => setIsBuffering(false));

    audio.addEventListener("timeupdate", () => {
      if (!isApplyingSync.current) {
        setLocalProgress(audio.currentTime);
      }
    });

    audio.addEventListener("ended", () => {
      useRoomStore.getState().sendAction({ type: "SKIP_NEXT" });
    });

    audio.addEventListener("error", () => {
      if (engineModeRef.current !== "iframe-fallback") {
        switchToIFrameFallback("Native audio failed. Using standard player.");
      }
    });

    setIsPlayerReady(true);
    setEngineMode("native-render");

    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    };
  }, []);

  const initAudioContext = useCallback(() => {
    if (hasInteracted) return;
    setHasInteracted(true);

    const silent = new Audio(silentAudioBase64);
    silent.loop = true;
    silentAudioRef.current = silent;
    silent.play().catch(() => {});

    const audio = audioRef.current;
    if (audio) {
      audio.play().then(() => audio.pause()).catch(() => {});
    }

    if (iframeFallbackRef.current?.playVideo) {
      iframeFallbackRef.current.playVideo();
    }
  }, [hasInteracted]);

  useEffect(() => {
    if (engineMode !== "iframe-fallback" || !playback.isPlaying) return;

    const id = setInterval(() => {
      if (iframeFallbackRef.current?.getCurrentTime) {
        setLocalProgress(iframeFallbackRef.current.getCurrentTime());
      }
    }, 1000);

    return () => clearInterval(id);
  }, [engineMode, playback.isPlaying]);

  useEffect(() => {
    if (!isPlayerReady) return;

    const currentTrack = queue.find(t => t.id === playback.currentTrackId);

    if (!currentTrack) {
      audioRef.current?.pause();
      audioRef.current?.removeAttribute("src");
      iframeFallbackRef.current?.stopVideo?.();
      silentAudioRef.current?.pause();
      setLocalProgress(0);
      loadedTrackId.current = null;
      return;
    }

    const accurateServerOffset = getAccurateServerOffset();

    if (engineMode === "iframe-fallback") {
      syncIFramePlayer(currentTrack, accurateServerOffset);
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    if (playback.isPlaying && audioServerStatus !== "online") {
      switchToIFrameFallback("Audio server is waking up. Using standard player for now.");
      return;
    }

    if (loadedTrackId.current !== currentTrack.id) {
      loadedTrackId.current = currentTrack.id;
      isApplyingSync.current = true;
      audio.src = `${AUDIO_SERVER_URL}/stream/${currentTrack.id}`;
      audio.load();

      if (playback.isPlaying) {
        audio.currentTime = Math.max(0, accurateServerOffset);
        audio.play().catch(() => {
          switchToIFrameFallback("Native audio failed. Using standard player.");
        });
        silentAudioRef.current?.play().catch(() => {});
      } else {
        audio.addEventListener("loadedmetadata", () => {
          audio.currentTime = Math.max(0, accurateServerOffset);
        }, { once: true });
      }

      updateMediaSession(currentTrack);
      setTimeout(() => { isApplyingSync.current = false; }, 500);
      return;
    }

    if (!isApplyingSync.current && Math.abs(audio.currentTime - accurateServerOffset) > 2.0 && accurateServerOffset > 0) {
      isApplyingSync.current = true;
      audio.currentTime = Math.max(0, accurateServerOffset);
      setTimeout(() => { isApplyingSync.current = false; }, 300);
    }

    if (playback.isPlaying) {
      if (audio.paused) {
        audio.play().catch(() => {
          switchToIFrameFallback("Native audio failed. Using standard player.");
        });
        silentAudioRef.current?.play().catch(() => {});
      }
    } else if (!audio.paused) {
      audio.pause();
      silentAudioRef.current?.pause();
    }
  }, [
    playback.isPlaying,
    playback.currentTrackId,
    playback.startTimestamp,
    playback.trackOffset,
    isPlayerReady,
    queue,
    engineMode,
    audioServerStatus,
  ]);

  function getAccurateServerOffset() {
    return playback.isPlaying
      ? playback.trackOffset + (Date.now() + getClockOffset() - playback.startTimestamp) / 1000
      : playback.trackOffset;
  }

  function switchToIFrameFallback(message: string) {
    audioRef.current?.pause();
    loadedTrackId.current = null;
    setEngineMode("iframe-fallback");

    if (!fallbackToastShown.current) {
      fallbackToastShown.current = true;
      addToast(message, "warning");
    }

    if ((window as any).YT?.Player) {
      createIFramePlayer();
      return;
    }

    if (!document.getElementById("yt-api-script")) {
      const tag = document.createElement("script");
      tag.id = "yt-api-script";
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName("script")[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
    }

    (window as any).onYouTubeIframeAPIReady = () => createIFramePlayer();
  }

  function createIFramePlayer() {
    if (iframeFallbackRef.current) return;

    let playerDiv = document.getElementById("yt-player-container");
    if (!playerDiv) {
      playerDiv = document.createElement("div");
      playerDiv.id = "yt-player-container";
      playerDiv.style.position = "absolute";
      playerDiv.style.width = "1px";
      playerDiv.style.height = "1px";
      playerDiv.style.overflow = "hidden";
      playerDiv.style.pointerEvents = "none";
      playerDiv.style.top = "-100px";
      playerDiv.style.left = "-100px";
      playerDiv.style.opacity = "0.01";
      document.body.appendChild(playerDiv);
    }

    const currentTrack = useRoomStore
      .getState()
      .queue.find(t => t.id === useRoomStore.getState().playback.currentTrackId);

    iframeFallbackRef.current = new (window as any).YT.Player("yt-player-container", {
      height: "64",
      width: "64",
      videoId: currentTrack?.id || "",
      playerVars: { playsinline: 1, controls: 0, disablekb: 1, rel: 0, fs: 0 },
      events: {
        onReady: (event: any) => {
          setIsPlayerReady(true);
          syncIFramePlayerFromStore(event.target);
        },
        onStateChange: (event: any) => {
          if (event.data === 0) {
            useRoomStore.getState().sendAction({ type: "SKIP_NEXT" });
          }

          if (event.data === 3 && useRoomStore.getState().playback.isPlaying) {
            setIsBuffering(true);
          } else {
            setIsBuffering(false);
          }
        },
      },
    });
  }

  function syncIFramePlayerFromStore(player: any) {
    const state = useRoomStore.getState();
    const currentTrack = state.queue.find(t => t.id === state.playback.currentTrackId);
    if (!currentTrack) return;

    const accurateServerOffset = state.playback.isPlaying
      ? state.playback.trackOffset + (Date.now() + getClockOffset() - state.playback.startTimestamp) / 1000
      : state.playback.trackOffset;

    if (state.playback.isPlaying) {
      player.loadVideoById({ videoId: currentTrack.id, startSeconds: Math.max(0, accurateServerOffset) });
      silentAudioRef.current?.play().catch(() => {});
    } else {
      player.cueVideoById({ videoId: currentTrack.id, startSeconds: Math.max(0, accurateServerOffset) });
    }

    loadedTrackId.current = currentTrack.id;
    updateMediaSession(currentTrack);
  }

  function syncIFramePlayer(
    currentTrack: { id: string; title: string; channel: string; thumbnail?: string },
    accurateServerOffset: number,
  ) {
    const player = iframeFallbackRef.current;
    if (!player?.loadVideoById) return;

    if (loadedTrackId.current !== currentTrack.id) {
      loadedTrackId.current = currentTrack.id;
      if (playback.isPlaying) {
        player.loadVideoById({ videoId: currentTrack.id, startSeconds: Math.max(0, accurateServerOffset) });
      } else {
        player.cueVideoById({ videoId: currentTrack.id, startSeconds: Math.max(0, accurateServerOffset) });
      }
      updateMediaSession(currentTrack);
      return;
    }

    const currentTime = player.getCurrentTime ? player.getCurrentTime() : 0;
    const state = player.getPlayerState ? player.getPlayerState() : -1;

    if ((state === 1 || state === 2) && Math.abs(currentTime - accurateServerOffset) > 2.0 && accurateServerOffset > 0) {
      player.seekTo(Math.max(0, accurateServerOffset), true);
    }

    if (playback.isPlaying) {
      if (state !== 1) {
        player.playVideo();
        silentAudioRef.current?.play().catch(() => {});
      }
    } else if (state === 1) {
      player.pauseVideo();
      silentAudioRef.current?.pause();
    }
  }

  function getCurrentOffset() {
    if (engineModeRef.current === "iframe-fallback" && iframeFallbackRef.current?.getCurrentTime) {
      return iframeFallbackRef.current.getCurrentTime();
    }

    return audioRef.current?.currentTime || 0;
  }

  function updateMediaSession(track: { id: string; title: string; channel: string; thumbnail?: string }) {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.channel,
      artwork: [
        { src: `https://i.ytimg.com/vi/${track.id}/mqdefault.jpg`, sizes: "320x180", type: "image/jpeg" },
        { src: `https://i.ytimg.com/vi/${track.id}/hqdefault.jpg`, sizes: "480x360", type: "image/jpeg" },
      ],
    });

    navigator.mediaSession.setActionHandler("play", () => {
      useRoomStore.getState().sendAction({ type: "PLAY", offset: getCurrentOffset() });
    });

    navigator.mediaSession.setActionHandler("pause", () => {
      useRoomStore.getState().sendAction({ type: "PAUSE", offset: getCurrentOffset() });
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
  }

  return {
    initAudioContext,
    hasInteracted,
    isBuffering,
    localProgress,
    engineMode,
    audioElement: audioRef.current,
  };
}
