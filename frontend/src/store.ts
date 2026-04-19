import { create } from "zustand";

export interface Track {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  startTimestamp: number;
  trackOffset: number;
  currentTrackId: string | null;
}

interface RoomStore {
  // Sync Data
  roomCode: string | null;
  playback: PlaybackState;
  queue: Track[];
  memberCount: number;
  
  // Connection State
  ws: WebSocket | null;
  isConnected: boolean;

  // Actions
  setRoomCode: (code: string) => void;
  connect: (code: string) => void;
  disconnect: () => void;
  sendAction: (action: unknown) => void;
  
  // Handlers (internal)
  _handleMessage: (message: any) => void;
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  roomCode: null,
  playback: {
    isPlaying: false,
    startTimestamp: 0,
    trackOffset: 0,
    currentTrackId: null,
  },
  queue: [],
  memberCount: 0,
  ws: null,
  isConnected: false,

  setRoomCode: (code) => set({ roomCode: code }),

  connect: (code) => {
    // Prevent duplicate connections
    if (get().ws || get().isConnected) return;
    
    set({ roomCode: code });
    
    // Connect to WebSocket using the appropriate protocol
    const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8788';
    const wsProtocol = API_URL.startsWith('https') ? 'wss:' : 'ws:';
    const wsHost = API_URL.replace('http://', '').replace('https://', '');
    const wsUrl = `${wsProtocol}//${wsHost}/api/ws/${code}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      set({ isConnected: true });
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        get()._handleMessage(message);
      } catch (e) {
        console.error("Invalid WebSocket message:", e);
      }
    };

    ws.onclose = () => {
      set({ isConnected: false, ws: null });
      // Reconnect logic could go here
    };

    set({ ws });
  },

  disconnect: () => {
    const { ws } = get();
    if (ws) {
      ws.close();
    }
    set({ ws: null, isConnected: false });
  },

  sendAction: (action) => {
    const { ws, isConnected } = get();
    if (ws && isConnected && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(action));
    }
  },

  _handleMessage: (message) => {
    switch (message.type) {
      case "SYNC_INIT":
        set({
          playback: message.playback,
          queue: message.queue,
          memberCount: message.memberCount,
        });
        break;
      case "PLAY":
      case "PAUSE":
      case "SEEK":
        set({ playback: message.playback });
        break;
      case "QUEUE_UPDATE":
        set({ queue: message.queue });
        break;
      case "TRACK_CHANGE":
        set({ playback: message.playback, queue: message.queue });
        break;
      case "MEMBER_COUNT":
        set({ memberCount: message.count });
        break;
    }
  },
}));
