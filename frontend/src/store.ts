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

// ─── Toast System ──────────────────────────────────────────────────
export interface Toast {
  id: string;
  message: string;
  type: "success" | "error" | "warning";
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
  audioServerStatus: "checking" | "online" | "offline";

  // Toasts
  toasts: Toast[];
  addToast: (message: string, type?: Toast["type"]) => void;
  removeToast: (id: string) => void;

  // Version check
  updateAvailable: boolean;
  setUpdateAvailable: (available: boolean) => void;

  // Actions
  setRoomCode: (code: string) => void;
  setAudioServerStatus: (status: "checking" | "online" | "offline") => void;
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
let heartbeatInterval: any = null;
let visibilityHandler: any = null;

// ─── Version Check ─────────────────────────────────────────────────
const CURRENT_VERSION = localStorage.getItem("meowzik_version") || "";
const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8788";

async function checkForUpdates(store: { setUpdateAvailable: (v: boolean) => void }) {
  try {
    const res = await fetch(`${API_URL}/api/version`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.version && CURRENT_VERSION && data.version !== CURRENT_VERSION) {
      store.setUpdateAvailable(true);
    }
    // Save current version on first load
    if (!CURRENT_VERSION && data.version) {
      localStorage.setItem("meowzik_version", data.version);
    }
  } catch {
    // Silently ignore version check failures
  }
}

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
  toasts: [],
  updateAvailable: false,
  audioServerStatus: "checking",

  setAudioServerStatus: (status) => set({ audioServerStatus: status }),
  setUpdateAvailable: (available) => set({ updateAvailable: available }),

  addToast: (message, type = "success") => {
    const id = Math.random().toString(36).substring(2, 9);
    set(state => ({ toasts: [...state.toasts, { id, message, type }] }));
    // Auto-remove after 4 seconds
    setTimeout(() => {
      set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }));
    }, 4000);
  },

  removeToast: (id) => {
    set(state => ({ toasts: state.toasts.filter(t => t.id !== id) }));
  },

  setRoomCode: (code) => set({ roomCode: code }),

  connect: (code) => {
    // Prevent duplicate active connections
    if (get().ws?.readyState === WebSocket.OPEN || get().isConnected) return;
    
    set({ roomCode: code });
    
    const wsProtocol = API_URL.startsWith('https') ? 'wss:' : 'ws:';
    const wsHost = API_URL.replace('http://', '').replace('https://', '');
    const wsUrl = `${wsProtocol}//${wsHost}/api/ws/${code}?userId=${get().userId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      set({ isConnected: true, reconnectAttempts: 0 });
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      
      // Send initial visibility state
      ws.send(JSON.stringify({ type: "STATUS_UPDATE", status: document.hidden ? "inactive" : "active" }));

      // Start heartbeat — send every 20 seconds to keep lastSeen fresh
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "HEARTBEAT" }));
        }
      }, 20_000);
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
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      
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

    // Check for version updates
    checkForUpdates(get());
  },

  disconnect: () => {
    const { ws } = get();
    if (ws) {
      ws.onclose = null; // Prevent auto-reconnect
      ws.close();
    }
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
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
      case "QUEUE_ADD_SUCCESS":
        get().addToast(`Added "${message.trackTitle}" to queue`, "success");
        break;
      case "QUEUE_DUPLICATE":
        get().addToast(`"${message.trackTitle}" is already in the queue`, "error");
        break;
    }
  },
}));
