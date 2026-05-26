import { useEffect, useRef, useState, useCallback } from "react";
import { useRoomStore, getClockOffset } from "./store";

export function useAudioEngine() {
  // Use Zustand selectors for granular subscriptions
  const playback = useRoomStore(s => s.playback);
  const queue = useRoomStore(s => s.queue);

  const playerRef = useRef<any>(null);
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);
  
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [localProgress, setLocalProgress] = useState(0);
  const [isPlayerReady, setIsPlayerReady] = useState(false);

  const silentAudioBase64 = "data:audio/mpeg;base64,SUQzBAAAAAABAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAZGFzaABUWFhYAAAAEQAAA21pbm9yX3ZlcnNpb24AMABUWFhYAAAAHAAAA2NvbXBhdGlibGVfYnJhbmRzAGlzbzZkYXNoAFRTU0UAAAAPAAADTGF2ZjYwLjMuMTAwAAAAAAAAAAAAAAD/+00AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABYaW5nAAAADwAAAAEAAAAAAAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4fICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj9AQUpLTE1OT1BSUlNVVldYWVpbXF1eX2BhYmNklJWWl5iZmpucnZ6foKGio6SlpqeoqaqrrK2ur7CxsrO0tba3uLm6u7y9vr/AwcLDxMXGx8jJysvMzc7P0NHS09TV1tfY2drb3N3e3+Di4+Tl5ufo6err7O3u7/Dx8vP09fb3+Pn6+/z9/v8AAAAA";

  // Eagerly inject YouTube API on mount
  useEffect(() => {
    if ((window as any).YT && (window as any).YT.Player) {
      createPlayer();
    } else if (!document.getElementById("yt-api-script")) {
      const tag = document.createElement('script');
      tag.id = "yt-api-script";
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

      (window as any).onYouTubeIframeAPIReady = () => {
        createPlayer();
      };
    }
  }, []);

  // Initialize Audio Context on click
  const initAudioContext = useCallback(() => {
    if (hasInteracted) return;
    setHasInteracted(true);

    // Initialize silent audio element for background bridge
    const silent = new Audio(silentAudioBase64);
    silent.loop = true;
    silentAudioRef.current = silent;
    silent.play().catch(() => {});

    // Unlock YouTube player synchronously within user gesture
    if (playerRef.current && typeof playerRef.current.playVideo === 'function') {
        playerRef.current.playVideo();
    }
  }, [hasInteracted]);

  const createPlayer = () => {
    if (playerRef.current) return;
    
    // Create a hidden player div if it doesn't exist
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
      playerDiv.style.opacity = "0.01"; // Keep it slightly visible to avoid aggressive throttle
      document.body.appendChild(playerDiv);
    }

    const currentTrack = useRoomStore.getState().queue.find(t => t.id === useRoomStore.getState().playback.currentTrackId);

    playerRef.current = new (window as any).YT.Player("yt-player-container", {
      height: '64',
      width: '64',
      videoId: currentTrack?.id || '',
      playerVars: {
        playsinline: 1,
        controls: 0,
        disablekb: 1,
        rel: 0,
        fs: 0
      },
      events: {
        onReady: (event: any) => {
          setIsPlayerReady(true);
          // Auto-start if it was already "playing" in global state
          if (useRoomStore.getState().playback.isPlaying) {
             event.target.playVideo();
             silentAudioRef.current?.play().catch(() => {});
          }
        },
        onStateChange: (event: any) => {
          // YT.PlayerState.ENDED = 0
          if (event.data === 0) {
            useRoomStore.getState().sendAction({ type: "SKIP_NEXT" });
          }
          // YT.PlayerState.BUFFERING = 3
          setIsBuffering(event.data === 3);
        }
      }
    });
  };

  // Progress polling — properly cleaned up, only runs when playing
  useEffect(() => {
    if (!isPlayerReady || !playback.isPlaying) return;
    const id = setInterval(() => {
      if (playerRef.current?.getCurrentTime) {
        setLocalProgress(playerRef.current.getCurrentTime());
      }
    }, 1000);
    return () => clearInterval(id);
  }, [isPlayerReady, playback.isPlaying]);

  const loadedTrackId = useRef<string | null>(null);

  // Sync Logic wrapper around YouTube API
  useEffect(() => {
    if (!isPlayerReady || !playerRef.current) return;
    
    const player = playerRef.current;
    const currentTrack = queue.find(t => t.id === playback.currentTrackId);
    
    if (!currentTrack) {
      player.stopVideo();
      silentAudioRef.current?.pause();
      setLocalProgress(0);
      loadedTrackId.current = null;
      return;
    }

    try {
        // Use clock offset for accurate server time calculation
        const offset = getClockOffset();
        const accurateServerOffset = playback.isPlaying 
          ? playback.trackOffset + (Date.now() + offset - playback.startTimestamp) / 1000
          : playback.trackOffset;

        // If track changed, strictly load exactly once
        if (loadedTrackId.current !== currentTrack.id) {
            if (playback.isPlaying) {
                player.loadVideoById({ videoId: currentTrack.id, startSeconds: Math.max(0, accurateServerOffset) });
            } else {
                player.cueVideoById({ videoId: currentTrack.id, startSeconds: Math.max(0, accurateServerOffset) });
            }
            loadedTrackId.current = currentTrack.id;

            if ('mediaSession' in navigator) {
              navigator.mediaSession.metadata = new MediaMetadata({
                title: currentTrack.title,
                artist: currentTrack.channel,
                artwork: [{ src: currentTrack.thumbnail, sizes: '512x512', type: 'image/jpeg' }]
              });

              navigator.mediaSession.setActionHandler('play', () => {
                // Resume BOTH
                playerRef.current?.playVideo();
                silentAudioRef.current?.play().catch(() => {});
                useRoomStore.getState().sendAction({ type: "PLAY", offset: playerRef.current?.getCurrentTime() || 0 });
              });
              navigator.mediaSession.setActionHandler('pause', () => {
                playerRef.current?.pauseVideo();
                silentAudioRef.current?.pause();
                useRoomStore.getState().sendAction({ type: "PAUSE", offset: playerRef.current?.getCurrentTime() || 0 });
              });
              navigator.mediaSession.setActionHandler('nexttrack', () => {
                useRoomStore.getState().sendAction({ type: "SKIP_NEXT" });
              });
            }
        }
        
        const currentTime = player.getCurrentTime ? player.getCurrentTime() : 0;
        const state = player.getPlayerState ? player.getPlayerState() : -1;
        
        // Seek correction — only when PLAYING or PAUSED, with clock-adjusted offset
        if ((state === 1 || state === 2) && Math.abs(currentTime - accurateServerOffset) > 2.0 && accurateServerOffset > 0) {
          player.seekTo(Math.max(0, accurateServerOffset), true);
        }

        // Play/Pause sync — ALWAYS call playVideo when isPlaying, even during BUFFERING
        if (playback.isPlaying) {
          if (state !== 1) { // Not already PLAYING — start it (including from BUFFERING state 3)
            player.playVideo();
            silentAudioRef.current?.play().catch(() => {});
          }
        } else {
          if (state === 1) { // Only pause if currently PLAYING
            player.pauseVideo();
            silentAudioRef.current?.pause();
          }
        }
    } catch (err) {
        console.error("YT Player error:", err);
    }

  }, [playback.isPlaying, playback.currentTrackId, playback.startTimestamp, playback.trackOffset, isPlayerReady, queue]);

  return {
    initAudioContext,
    hasInteracted,
    isBuffering,
    localProgress,
    audioElement: null, // Legacy, no longer strictly native
  };
}