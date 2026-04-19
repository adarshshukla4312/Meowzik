# Meamie: Synchronized Music Room - Project Plan

## 1. Project Overview

### Vision
A high-performance, edge-native music synchronization platform. Groups listen to ad-free music using YouTube catalog data, powered by Cloudflare's global network for ultra-low latency and a premium music-app UX.

### Goals
- **Real-time Sync**: < 500ms drift across global users using Cloudflare Durable Objects.
- **Ad-Free & Google-Free**: 100% independent of YouTube Data APIs and embedded players. Native raw-stream playback and search via a resilient Piped API Rotator.
- **Serverless Efficiency**: Operate entirely on the **Cloudflare Free Tier**. By utilizing the new Free Tier Durable Objects (with SQLite backend) and WebSocket Hibernation, idle compute costs drop to $0.
- **Premium UX**: Modern music-app aesthetics (Spotify/Apple Music style) with seamless queue transitions and strict mobile autoplay compatibility.

---

## 2. Technical Architecture (Cloudflare Edge)

### System Overview
```
┌───────────────────────────────────────────────────────────────┐
│                   Client Layer (Cloudflare Pages)             │
│  ┌────────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │    React UI    │  │ WebSockets     │  │ Evergreen Audio │  │
│  │ (Vite/Zustand) │  │ (Event-Driven) │  │ Buffer (WebAPI) │  │
│  └────────────────┘  └────────────────┘  └─────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                               ▲ ▼ WebSocket (Hibernating)
┌───────────────────────────────────────────────────────────────┐
│                 Backend Layer (Cloudflare Workers)            │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │             Durable Object (Room Instance)              │  │
│  │  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐  │  │
│  │  │ State Memory  │  │ Event Handler │  │ Alarm API   │  │  │
│  │  └───────────────┘  └───────────────┘  └─────────────┘  │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                               ▲ ▼
┌───────────────────────────────────────────────────────────────┐
│                    Storage & External APIs                    │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐    │
│  │      D1      │  │      KV      │  │ Piped API Rotator │    │
│  │    (SQL)     │  │   (Cache)    │  │ (Search/Streams)  │    │
│  └──────────────┘  └──────────────┘  └───────────────────┘    │
└───────────────────────────────────────────────────────────────┘
```

### Core Innovations & Architectural Decisions

#### 1. The Piped API Rotator (Stream & Search)
We will **not** rely on a single public Piped instance, nor will we use the official YouTube Data API. 
*   **The Rotator**: The Cloudflare Worker will routinely fetch the community list of Piped instances (`instances.json`). It will filter for high uptime and low latency, updating a Workers KV cache.
*   **Routing**: All client requests for **Search** and **Stream Extraction** will be routed through the Worker to the healthiest Piped instance. 
*   This ensures zero downtime and removes Google API quota limits.

#### 2. Event-Driven Sync & Free-Tier Hibernation
*   **No Heartbeat**: The Durable Object will *never* send a generic "heartbeat" tick. Free Tier DOs share a 13,000 GB-second daily compute limit. Ticks rapidly burn this allowance.
*   **Event-Driven**: The DO only broadcasts state when a profound change occurs (User joins, Play, Pause, Seek, Add to Queue).
*   **Hibernation API**: We will use Cloudflare's **WebSocket Hibernation API**. When users are just listening to a song, the DO goes to sleep, pausing compute billing entirely. The WebSockets remain connected at the Edge router. If a user clicks 'Pause', the router instantly wakes the DO. 
*   **Client Extrapolation**: Clients determine the exact playback time locally using `Date.now() - server_start_timestamp`.

#### 3. iOS/Safari "Evergreen Audio Buffer"
*   To bypass iOS Safari's strict anti-autoplay rules (which block audio if the `src` changes without a screen tap):
*   We will initialize the `AudioContext` on the very first "Join Room" button click. 
*   Instead of replacing the `<audio>` tag's source on track advance, we use tight Promise chaining to preload the next stream URL 10-15 seconds before the current track ends. We programmatically swap the source and force `.play()` exactly as the old track ends, maintaining the "user interaction" context.

---

## 3. Tech Stack

### Frontend
- **React 18** (Vite) for rapid SPA development.
- **Zustand** for lightweight, reactive client state (Room data, queue, UI state).
- **Framer Motion** for premium, fluid animations (modals, queues, track changes).
- **TailwindCSS** for rapid, scalable UI styling.
- **Native WebSockets API** (No heavy wrappers like Socket.io needed).

### Backend (Edge)
- **Cloudflare Workers** (V8 Runtime, zero cold starts).
- **Durable Objects (SQLite Backend)** (Room state concurrency & WebSockets. The SQLite backend is specifically required to qualify for Free Tier usage).
- **Wrangler** (Local development & deployment orchestration).

### Storage
- **Cloudflare D1** (Serverless SQLite for persistent user profiles and room run-history).
- **Workers KV** (Global key-value store for caching Piped Instance health lists and trending searches).

---

## 4. Development Methodology & Phasing

### Phase 1: MVP Core (Days 1 - 14)

#### Day 1-3: Edge Foundations & Routing
- [ ] Initialize `wrangler` project (Worker + Pages).
- [ ] Set up TailwindCSS and React Router.
- [ ] Implement the **Piped API Rotator** logic in a pure Worker route.
- [ ] Build the landing page UI (Create/Join Room).

#### Day 4-7: Stateful Rooms (Durable Objects)
- [ ] Implement the Durable Object class.
- [ ] Ensure `wrangler.toml` Configures the DO to use the `sqlite` storage backend (Required for Free Tier).
- [ ] Configure the **WebSocket Hibernation API** within the DO to protect the 13k GB-s limit.
- [ ] Define the Room State schema and create necessary SQLite tables inside `ctx.storage.sql`.
- [ ] Implement "Client Extrapolation" sync logic.

#### Day 8-11: "Evergreen" Audio Player & Search
- [ ] Build the Search UI powered entirely by the Piped Rotator proxy.
- [ ] Implement the custom HTML5 Audio engine with the iOS Safari Preload workaround.
- [ ] Build Collaborative Queue UX (Add, drag-to-reorder, remove).
- [ ] Implement Host vs Guest permission toggles.

#### Day 12-14: UI Polish & Mobile Resilience
- [ ] Integrate Framer Motion for drawer slides and track-change crossfades.
- [ ] Implement the **Media Session API** (Lock-screen play/pause controls).
- [ ] Hardening: Handle WebSocket reconnects and DO failovers gracefully.

---

## 5. Granular Implementation Details

### The Hibernating Durable Object (RoomEngine)
```javascript
import { DurableObject } from "cloudflare:workers";

export class RoomEngine extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx; // Provides access to WebSockets and SQLite storage
    
    // SQLite Free-Tier Setup
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_settings (key TEXT PRIMARY KEY, value TEXT);
    `);
    
    // In-memory hot state
    this.playback = { isPlaying: false, startTimestamp: 0, trackOffset: 0 };
    this.queue = [];
  }

  async fetch(request) {
    const [client, server] = Object.values(new WebSocketPair());
    
    // Accept WebSocket and register for Hibernation
    this.state.acceptWebSocket(server);
    
    // Initial sync payload
    server.send(JSON.stringify({ type: "SYNC_INIT", playback: this.playback, queue: this.queue }));
    return new Response(null, { status: 101, webSocket: client });
  }

  // Wakes up ONLY when a message is received (costs $0 otherwise)
  async webSocketMessage(ws, message) {
    const event = JSON.parse(message);
    
    if (event.type === "PLAY") {
      this.playback.isPlaying = true;
      this.playback.startTimestamp = Date.now();
      this.playback.trackOffset = event.offset;
      this.broadcast(JSON.stringify({ type: "PLAY", playback: this.playback }));
    }
    
    if (event.type === "PAUSE") {
      this.playback.isPlaying = false;
      this.playback.trackOffset = event.offset;
      this.broadcast(JSON.stringify({ type: "PAUSE", playback: this.playback }));
    }
  }

  broadcast(message) {
    const sockets = this.state.getWebSockets();
    sockets.forEach(ws => ws.send(message));
  }
}
```

### The Piped Rotator Service
```javascript
// Worker Route: /api/stream/:videoId
export async function getStreamUrl(videoId, env) {
  // 1. Fetch healthy instances from KV cache (updated hourly via Cron)
  const instances = await env.KV.get('healthy_piped_instances', 'json');
  
  // 2. Try the fastest instance
  for (const instance of instances) {
    try {
      const res = await fetch(`https://${instance}/streams/${videoId}`);
      if (!res.ok) continue;
      
      const data = await res.json();
      const m4aAudio = data.audioStreams.find(s => s.format === 'M4A') || data.audioStreams[0];
      return Response.json({ url: m4aAudio.url });
      
    } catch (e) {
      // Instance failed, loop continues to the next healthy instance
      console.warn(`Instance ${instance} failed, rotating...`);
    }
  }
  return new Response("All instances failed", { status: 502 });
}
```

### Client-Side NTP Sync Logic
```javascript
function getSynchronizedTime(playbackState) {
  if (!playbackState.isPlaying) {
    return playbackState.trackOffset; // Song is paused at e.g., 45.2 seconds
  }
  
  // Calculate exact time without asking the server
  const timeSinceStart = (Date.now() - playbackState.startTimestamp) / 1000;
  return playbackState.trackOffset + timeSinceStart;
}

// In React:
useEffect(() => {
  const accurateTime = getSynchronizedTime(playbackState);
  if (Math.abs(audioRef.current.currentTime - accurateTime) > 0.5) {
     audioRef.current.currentTime = accurateTime; // Correct drift
  }
}, [playbackState]);
```

---

## 6. Data & State Schemas

### D1 Database Schema (For Persistence)
We use D1 for analytical and user-history purposes, NOT real-time sync.
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE room_sessions (
  id TEXT PRIMARY KEY,
  room_code TEXT NOT NULL,
  host_id TEXT,
  tracks_played INTEGER DEFAULT 0,
  duration_minutes INTEGER DEFAULT 0,
  ended_at TIMESTAMP
);
```

### Durable Object State Schema (JSON)
```typescript
interface RoomState {
  code: string;
  hostId: string;
  playback: {
    isPlaying: boolean;
    startTimestamp: number; // Date.now() when Play was pressed
    trackOffset: number;    // Seconds into the track when Play/Pause was pressed
    currentTrackId: string;
  };
  queue: TrackData[];
  settings: {
    allowGuestQueue: boolean;
    requireHostForSkip: boolean;
  };
}
```

---

## 7. Future Phases (Post-MVP)

### Phase 2: Social & Presence
- **Neon Name Tags**: Cursor tracking and presence indicators in the UI.
- **Flying Reactions**: Emoji reaction button triggering CSS/canvas animations across all clients.
- **Synchronized Lyrics**: Implementing the Piped subtitle API to show lyrics in real-time.

### Phase 3: Infrastructure Hardening
- **Durable Object Alarms**: Set up a 10-minute DO Alarm. If everyone leaves the room and 10 minutes pass, the alarm triggers, saving stats to D1 and permanently shutting the DO down to ensure absolutley zero leaky cloud costs.
- **Custom Domain Analytics**: Utilize Cloudflare Web Analytics for privacy-first traffic monitoring.

---

**Last Updated**: April 2026
**Version**: 3.0.0 (Granular Edge-Native Blueprint)
**Status**: Ready for Code Implementation
