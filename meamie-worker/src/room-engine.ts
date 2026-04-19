import { DurableObject } from "cloudflare:workers";

// ─── Types ───────────────────────────────────────────────────────────
export interface TrackData {
	id: string;
	title: string;
	channel: string;
	thumbnail: string;
	duration: number; // seconds
}

interface PlaybackState {
	isPlaying: boolean;
	startTimestamp: number; // Date.now() when Play was pressed
	trackOffset: number; // Seconds into the track when Play/Pause occurred
	currentTrackId: string | null;
}

interface RoomSettings {
	allowGuestQueue: boolean;
	requireHostForSkip: boolean;
}

// ─── Message Protocol ────────────────────────────────────────────────
type ClientMessage =
	| { type: "PLAY"; offset: number }
	| { type: "PAUSE"; offset: number }
	| { type: "SEEK"; offset: number }
	| { type: "QUEUE_ADD"; track: TrackData }
	| { type: "QUEUE_REMOVE"; trackId: string }
	| { type: "SKIP_NEXT" }
	| { type: "SET_TRACK"; trackId: string };

type ServerMessage =
	| { type: "SYNC_INIT"; playback: PlaybackState; queue: TrackData[]; memberCount: number }
	| { type: "PLAY"; playback: PlaybackState }
	| { type: "PAUSE"; playback: PlaybackState }
	| { type: "SEEK"; playback: PlaybackState }
	| { type: "QUEUE_UPDATE"; queue: TrackData[] }
	| { type: "TRACK_CHANGE"; playback: PlaybackState; queue: TrackData[] }
	| { type: "MEMBER_COUNT"; count: number };

// ─── RoomEngine Durable Object ──────────────────────────────────────
export class RoomEngine extends DurableObject {
	private playback: PlaybackState;
	private queue: TrackData[];
	private settings: RoomSettings;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		// Initialize in-memory hot state
		this.playback = {
			isPlaying: false,
			startTimestamp: 0,
			trackOffset: 0,
			currentTrackId: null,
		};
		this.queue = [];
		this.settings = {
			allowGuestQueue: true,
			requireHostForSkip: false,
		};

		// Enable auto ping/pong so the DO stays hibernated during idle periods.
		// The runtime handles ping/pong without waking the object.
		this.ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair("ping", "pong")
		);

		// Restore persisted state from SQLite (survives DO eviction)
		this.ctx.blockConcurrencyWhile(async () => {
			// Create tables if they don't exist
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS room_state (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL
				);
			`);

			// Restore playback state
			const playbackRows = this.ctx.storage.sql.exec(
				`SELECT value FROM room_state WHERE key = 'playback'`
			).toArray();
			if (playbackRows.length > 0) {
				this.playback = JSON.parse(playbackRows[0].value as string);
			}

			// Restore queue
			const queueRows = this.ctx.storage.sql.exec(
				`SELECT value FROM room_state WHERE key = 'queue'`
			).toArray();
			if (queueRows.length > 0) {
				this.queue = JSON.parse(queueRows[0].value as string);
			}
		});
	}

	// ─── WebSocket Upgrade ──────────────────────────────────────────
	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket", { status: 426 });
		}

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		// Accept with Hibernation API — DO can sleep while connections stay open
		this.ctx.acceptWebSocket(server);

		// Clear auto-delete alarm because room became active
		this.ctx.storage.deleteAlarm();

		try {
			// Send the new client the current room state immediately
			const initMessage: ServerMessage = {
				type: "SYNC_INIT",
				playback: this.playback,
				queue: this.queue,
				memberCount: this.ctx.getWebSockets().length,
			};
			server.send(JSON.stringify(initMessage));

			// Notify everyone about updated member count
			this.broadcastMemberCount();
		} catch (e) {
			console.error("Failed to send init message, client may have disconnected early", e);
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	// ─── Hibernation Handler: Wakes DO only when a message arrives ──
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (typeof message !== "string") return;

		try {
			const event: ClientMessage = JSON.parse(message);

			switch (event.type) {
				case "PLAY":
					this.playback.isPlaying = true;
					this.playback.startTimestamp = Date.now();
					this.playback.trackOffset = event.offset;
					this.persistState();
					this.broadcast({ type: "PLAY", playback: this.playback });
					break;

				case "PAUSE":
					this.playback.isPlaying = false;
					this.playback.trackOffset = event.offset;
					this.persistState();
					this.broadcast({ type: "PAUSE", playback: this.playback });
					break;

				case "SEEK":
					this.playback.trackOffset = event.offset;
					if (this.playback.isPlaying) {
						this.playback.startTimestamp = Date.now();
					}
					this.persistState();
					this.broadcast({ type: "SEEK", playback: this.playback });
					break;

				case "QUEUE_ADD":
					this.queue.push(event.track);
					// If nothing is playing, auto-start the first track
					if (!this.playback.currentTrackId && this.queue.length === 1) {
						this.playback.currentTrackId = event.track.id;
						this.playback.isPlaying = false;
						this.playback.trackOffset = 0;
						this.playback.startTimestamp = 0;
						this.persistState();
						this.broadcast({ type: "TRACK_CHANGE", playback: this.playback, queue: this.queue });
					} else {
						this.persistState();
						this.broadcast({ type: "QUEUE_UPDATE", queue: this.queue });
					}
					break;

				case "QUEUE_REMOVE":
					this.queue = this.queue.filter((t) => t.id !== event.trackId);
					this.persistState();
					this.broadcast({ type: "QUEUE_UPDATE", queue: this.queue });
					break;

				case "SKIP_NEXT":
					this.advanceQueue();
					break;

				case "SET_TRACK":
					this.playback.currentTrackId = event.trackId;
					this.playback.isPlaying = false;
					this.playback.trackOffset = 0;
					this.playback.startTimestamp = 0;
					this.persistState();
					this.broadcast({ type: "TRACK_CHANGE", playback: this.playback, queue: this.queue });
					break;
			}
		} catch (e) {
			console.error("Failed to handle WebSocket message:", e);
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		this.broadcastMemberCount();
		
		const activeConnections = this.ctx.getWebSockets().length;
		if (activeConnections === 0) {
			// Pause audio since room is completely empty
			if (this.playback.isPlaying) {
				this.playback.isPlaying = false;
				this.playback.trackOffset += (Date.now() - this.playback.startTimestamp) / 1000;
				this.persistState();
			}
			// Set 24 hour cleanup alarm
			this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
		}
	}

	async alarm(): Promise<void> {
		// 24 hours inactive. Delete all SQLite state!
		await this.ctx.storage.deleteAll();
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		console.error("WebSocket error:", error);
	}

	// ─── Helpers ─────────────────────────────────────────────────────
	private advanceQueue(): void {
		if (this.queue.length === 0) return;

		const currentIndex = this.queue.findIndex((t) => t.id === this.playback.currentTrackId);
		const nextIndex = currentIndex + 1;

		if (nextIndex < this.queue.length) {
			this.playback.currentTrackId = this.queue[nextIndex].id;
		} else {
			// Loop back to start
			this.playback.currentTrackId = this.queue[0].id;
		}

		this.playback.isPlaying = false;
		this.playback.trackOffset = 0;
		this.playback.startTimestamp = 0;
		this.persistState();
		this.broadcast({ type: "TRACK_CHANGE", playback: this.playback, queue: this.queue });
	}

	private broadcast(message: ServerMessage): void {
		const payload = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.send(payload);
			} catch {
				// Client disconnected, skip
			}
		}
	}

	private broadcastMemberCount(): void {
		const count = this.ctx.getWebSockets().length;
		this.broadcast({ type: "MEMBER_COUNT", count });
	}

	private persistState(): void {
		this.ctx.storage.sql.exec(
			`INSERT OR REPLACE INTO room_state (key, value) VALUES ('playback', ?), ('queue', ?)`,
			JSON.stringify(this.playback),
			JSON.stringify(this.queue)
		);
	}
}
