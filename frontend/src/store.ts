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
  autoplayNext: boolean;
}

// Clock offset: serverTime - clientTime (add to Date.now() to get server time)
let clockOffset = 0;
export function getClockOffset() { return clockOffset; }

export interface Member {
  userId: string;
  role: "host" | "guest";
  status: "active" | "inactive";
}

interface RoomStore {
  // Sync Data
  roomCode: string | null;
  playback: PlaybackState;
  queue: Track[];
  memberCount: number;
  members: Member[];
  userId: string;
  myRole: "host" | "guest" | null;
  
  // Connection State
  ws: WebSocket | null;
  isConnected: boolean;
  reconnectAttempts: number;

  // Actions
  setRoomCode: (code: string) => void;
  connect: (code: string) => void;
  disconnect: () => void;
  sendAction: (action: unknown) => void;
  
  // Handlers (internal)
  _handleMessage: (message: any) => void;
}

const getUserId = () => {
  let id = localStorage.getItem("meamie_user_id");
  if (!id) {
    id = Math.random().toString(36).substring(2, 15);
    localStorage.setItem("meamie_user_id", id);
  }
  return id;
};

let reconnectTimeout: any = null;
let visibilityHandler: any = null;

export const useRoomStore = create<RoomStore>((set, get) => ({
  roomCode: null,
  playback: {
    isPlaying: false,
    startTimestamp: 0,
    trackOffset: 0,
    currentTrackId: null,
    autoplayNext: true,
  },
  queue: [],
  memberCount: 0,
  members: [],
  userId: getUserId(),
  myRole: null,
  ws: null,
  isConnected: false,
  reconnectAttempts: 0,

  setRoomCode: (code) => set({ roomCode: code }),

  connect: (code) => {
    // Prevent duplicate active connections
    if (get().ws?.readyState === WebSocket.OPEN || get().isConnected) return;
    
    set({ roomCode: code });
    
    const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8788';
    const wsProtocol = API_URL.startsWith('https') ? 'wss:' : 'ws:';
    const wsHost = API_URL.replace('http://', '').replace('https://', '');
    const wsUrl = `${wsProtocol}//${wsHost}/api/ws/${code}?userId=${get().userId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      set({ isConnected: true, reconnectAttempts: 0 });
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      
      // Send initial visibility state
      ws.send(JSON.stringify({ type: "STATUS_UPDATE", status: document.hidden ? "inactive" : "active" }));
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
      
      // Auto reconnect with backoff
      const attempts = get().reconnectAttempts;
      if (attempts < 10) { // Max 10 attempts
        const delay = Math.min(1000 * Math.pow(1.5, attempts), 10000);
        set({ reconnectAttempts: attempts + 1 });
        reconnectTimeout = setTimeout(() => {
          if (get().roomCode) get().connect(get().roomCode!);
        }, delay);
      }
    };

    set({ ws });

    // Handle visibility changes
    if (!visibilityHandler) {
      visibilityHandler = () => {
        const state = get();
        if (state.ws && state.ws.readyState === WebSocket.OPEN) {
          state.ws.send(JSON.stringify({ type: "STATUS_UPDATE", status: document.hidden ? "inactive" : "active" }));
        } else if (!document.hidden && !state.isConnected && state.roomCode) {
          // If we come back and are disconnected, try to reconnect immediately
          state.connect(state.roomCode);
        }
      };
      document.addEventListener("visibilitychange", visibilityHandler);
    }
  },

  disconnect: () => {
    const { ws } = get();
    if (ws) {
      ws.onclose = null; // Prevent auto-reconnect
      ws.close();
    }
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (visibilityHandler) {
      document.removeEventListener("visibilitychange", visibilityHandler);
      visibilityHandler = null;
    }
    set({ ws: null, isConnected: false, reconnectAttempts: 0, members: [], myRole: null });
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
        // Compute clock offset from server time
        if (message.serverTime) {
          clockOffset = message.serverTime - Date.now();
        }
        set({
          playback: message.playback,
          queue: message.queue,
          members: message.members || [],
          memberCount: (message.members || []).length,
          myRole: message.myRole || null,
        });
        break;
      case "PLAY":
      case "PAUSE":
      case "SEEK":
      case "AUTOPLAY_UPDATE":
        if (message.serverTime) {
          clockOffset = message.serverTime - Date.now();
        }
        set({ playback: message.playback });
        break;
      case "QUEUE_UPDATE":
        set({ queue: message.queue });
        break;
      case "TRACK_CHANGE":
        set({ playback: message.playback, queue: message.queue });
        break;
      case "MEMBERS_UPDATE":
        set({ 
          members: message.members, 
          memberCount: message.members.length,
          myRole: message.members.find((m: Member) => m.userId === get().userId)?.role || get().myRole
        });
        break;
    }
  },
}));
