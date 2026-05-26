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
	startTimestamp: number;
	trackOffset: number;
	currentTrackId: string | null;
	autoplayNext: boolean;
}

export interface Member {
	userId: string;
	role: "host" | "guest";
	status: "active" | "inactive";
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
	| { type: "QUEUE_REMOVE"; index: number }
	| { type: "QUEUE_MOVE"; from: number; to: number }
	| { type: "SKIP_NEXT" }
	| { type: "SKIP_PREV" }
	| { type: "SET_TRACK"; trackId: string }
	| { type: "TOGGLE_AUTOPLAY"; enabled: boolean }
	| { type: "STATUS_UPDATE"; status: "active" | "inactive" };

type ServerMessage =
	| { type: "SYNC_INIT"; playback: PlaybackState; queue: TrackData[]; members: Member[]; myRole: "host" | "guest"; serverTime: number }
	| { type: "PLAY"; playback: PlaybackState; serverTime: number }
	| { type: "PAUSE"; playback: PlaybackState; serverTime: number }
	| { type: "SEEK"; playback: PlaybackState; serverTime: number }
	| { type: "QUEUE_UPDATE"; queue: TrackData[] }
	| { type: "TRACK_CHANGE"; playback: PlaybackState; queue: TrackData[] }
	| { type: "AUTOPLAY_UPDATE"; playback: PlaybackState }
	| { type: "MEMBERS_UPDATE"; members: Member[] };

export class RoomEngine extends DurableObject {
	private playback: PlaybackState;
	private queue: TrackData[];
	private settings: RoomSettings;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);

		this.playback = {
			isPlaying: false,
			startTimestamp: 0,
			trackOffset: 0,
			currentTrackId: null,
			autoplayNext: true,
		};
		this.queue = [];
		this.settings = {
			allowGuestQueue: true,
			requireHostForSkip: false,
		};

		this.ctx.setWebSocketAutoResponse(
			new WebSocketRequestResponsePair("ping", "pong")
		);

		this.ctx.blockConcurrencyWhile(async () => {
			this.ctx.storage.sql.exec(`
				CREATE TABLE IF NOT EXISTS room_state (
					key TEXT PRIMARY KEY,
					value TEXT NOT NULL
				);
			`);

			const playbackRows = this.ctx.storage.sql.exec(
				`SELECT value FROM room_state WHERE key = 'playback'`
			).toArray();
			if (playbackRows.length > 0) {
				const parsed = JSON.parse(playbackRows[0].value as string);
				this.playback = { ...this.playback, ...parsed, autoplayNext: parsed.autoplayNext ?? true };
			}

			const queueRows = this.ctx.storage.sql.exec(
				`SELECT value FROM room_state WHERE key = 'queue'`
			).toArray();
			if (queueRows.length > 0) {
				this.queue = JSON.parse(queueRows[0].value as string);
			}
		});
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket", { status: 426 });
		}

		const url = new URL(request.url);
		const userId = url.searchParams.get("userId") || Math.random().toString();

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		this.ctx.acceptWebSocket(server);
		this.ctx.storage.deleteAlarm();

		let role: "host" | "guest" = "guest";
		
		// Read existing sockets to determine roles
		const activeSockets = this.ctx.getWebSockets();
		let hasHost = false;
		for (const ws of activeSockets) {
			const att = ws.deserializeAttachment();
			if (att?.role === "host") hasHost = true;
			if (att?.userId === userId) {
				role = att.role; // Retain role if reconnecting
			}
		}

		// First person in room is host
		if (!hasHost) {
			role = "host";
		}

		// Attach state to the WebSocket
		server.serializeAttachment({ userId, role, status: "active" });

		try {
			const initMessage: ServerMessage = {
				type: "SYNC_INIT",
				playback: this.playback,
				queue: this.queue,
				members: this.getMembersList(),
				myRole: role,
				serverTime: Date.now(),
			};
			server.send(JSON.stringify(initMessage));

			this.broadcastMembersUpdate();
		} catch (e) {
			console.error("Failed to send init message", e);
		}

		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		if (typeof message !== "string") return;

		const att = ws.deserializeAttachment();
		const userId = att?.userId;
		if (!userId) return;

		try {
			const event: ClientMessage = JSON.parse(message);
			const isHost = att.role === "host";

			switch (event.type) {
				case "PLAY":
					this.playback.isPlaying = true;
					this.playback.startTimestamp = Date.now();
					this.playback.trackOffset = event.offset;
					this.persistState();
					this.broadcast({ type: "PLAY", playback: this.playback, serverTime: Date.now() });
					break;

				case "PAUSE":
					this.playback.isPlaying = false;
					this.playback.trackOffset = event.offset;
					this.persistState();
					this.broadcast({ type: "PAUSE", playback: this.playback, serverTime: Date.now() });
					break;

				case "SEEK":
					this.playback.trackOffset = event.offset;
					if (this.playback.isPlaying) {
						this.playback.startTimestamp = Date.now();
					}
					// Don't persistState on SEEK — too frequent during slider drag
					this.broadcast({ type: "SEEK", playback: this.playback, serverTime: Date.now() });
					break;

				case "QUEUE_ADD":
					if (!isHost && !this.settings.allowGuestQueue) return;
					this.queue.push(event.track);
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
					if (!isHost) return; // Permissions: Only Host can remove from queue
					if (event.index >= 0 && event.index < this.queue.length) {
						this.queue.splice(event.index, 1);
					}
					this.persistState();
					this.broadcast({ type: "QUEUE_UPDATE", queue: this.queue });
					break;

				case "QUEUE_MOVE":
					if (!isHost && !this.settings.allowGuestQueue) return;
					if (event.from < 0 || event.from >= this.queue.length || event.to < 0 || event.to >= this.queue.length) return;
					
					const [movedItem] = this.queue.splice(event.from, 1);
					this.queue.splice(event.to, 0, movedItem);
					
					this.persistState();
					this.broadcast({ type: "QUEUE_UPDATE", queue: this.queue });
					break;

				case "SKIP_NEXT":
					if (!isHost && this.settings.requireHostForSkip) return;
					this.advanceQueue();
					break;

				case "SKIP_PREV":
					if (!isHost && this.settings.requireHostForSkip) return;
					this.previousQueue();
					break;

				case "SET_TRACK":
					if (!isHost && this.settings.requireHostForSkip) return;
					this.playback.currentTrackId = event.trackId;
					this.playback.isPlaying = true;
					this.playback.trackOffset = 0;
					this.playback.startTimestamp = Date.now();
					this.persistState();
					this.broadcast({ type: "TRACK_CHANGE", playback: this.playback, queue: this.queue });
					break;

				case "TOGGLE_AUTOPLAY":
					this.playback.autoplayNext = event.enabled;
					this.persistState();
					this.broadcast({ type: "AUTOPLAY_UPDATE", playback: this.playback });
					break;

				case "STATUS_UPDATE":
					ws.serializeAttachment({ ...att, status: event.status });
					this.broadcastMembersUpdate();
					break;
			}
		} catch (e) {
			console.error("Failed to handle WebSocket message:", e);
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		this.broadcastMembersUpdate();
		
		const activeConnections = this.ctx.getWebSockets().length;
		if (activeConnections === 0) {
			if (this.playback.isPlaying) {
				this.playback.isPlaying = false;
				this.playback.trackOffset += (Date.now() - this.playback.startTimestamp) / 1000;
				this.persistState();
			}
			this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
		}
	}

	async alarm(): Promise<void> {
		await this.ctx.storage.deleteAll();
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		console.error("WebSocket error:", error);
	}

	private advanceQueue(): void {
		if (this.queue.length === 0) return;

		const currentIndex = this.queue.findIndex((t) => t.id === this.playback.currentTrackId);
		const nextIndex = currentIndex + 1;

		if (nextIndex < this.queue.length && currentIndex !== -1) {
			this.playback.currentTrackId = this.queue[nextIndex].id;
			this.playback.isPlaying = this.playback.autoplayNext;
			this.playback.trackOffset = 0;
			this.playback.startTimestamp = this.playback.autoplayNext ? Date.now() : 0;
		} else if (currentIndex === -1 && this.queue.length > 0) {
			this.playback.currentTrackId = this.queue[0].id;
			this.playback.isPlaying = this.playback.autoplayNext;
			this.playback.trackOffset = 0;
			this.playback.startTimestamp = this.playback.autoplayNext ? Date.now() : 0;
		} else {
			this.playback.currentTrackId = null;
			this.playback.isPlaying = false;
			this.playback.trackOffset = 0;
			this.playback.startTimestamp = 0;
		}
		this.persistState();
		this.broadcast({ type: "TRACK_CHANGE", playback: this.playback, queue: this.queue });
	}

	private previousQueue(): void {
		if (this.queue.length === 0) return;

		const currentIndex = this.queue.findIndex((t) => t.id === this.playback.currentTrackId);
		
		// If playing for more than 3 seconds, just restart the current song
		const currentOffset = this.playback.isPlaying ? this.playback.trackOffset + (Date.now() - this.playback.startTimestamp) / 1000 : this.playback.trackOffset;
		if (currentOffset > 3) {
			this.playback.trackOffset = 0;
			this.playback.startTimestamp = this.playback.isPlaying ? Date.now() : 0;
			this.persistState();
			this.broadcast({ type: "SEEK", playback: this.playback });
			return;
		}

		const prevIndex = currentIndex - 1;

		if (prevIndex >= 0) {
			this.playback.currentTrackId = this.queue[prevIndex].id;
		} else {
			this.playback.currentTrackId = this.queue[this.queue.length - 1].id;
		}

		this.playback.isPlaying = this.playback.autoplayNext;
		this.playback.trackOffset = 0;
		this.playback.startTimestamp = this.playback.autoplayNext ? Date.now() : 0;
		this.persistState();
		this.broadcast({ type: "TRACK_CHANGE", playback: this.playback, queue: this.queue });
	}

	private broadcast(message: ServerMessage): void {
		const payload = JSON.stringify(message);
		for (const ws of this.ctx.getWebSockets()) {
			try {
				ws.send(payload);
			} catch {
			}
		}
	}

	private getMembersList(): Member[] {
		const membersList: Member[] = [];
		for (const ws of this.ctx.getWebSockets()) {
			const att = ws.deserializeAttachment();
			if (att?.userId) {
				membersList.push({
					userId: att.userId,
					role: att.role,
					status: att.status || "active"
				});
			}
		}
		
		// Remove duplicates in case a user has multiple open tabs (prefer active status if any)
		const uniqueMembersMap = new Map<string, Member>();
		for (const m of membersList) {
			const existing = uniqueMembersMap.get(m.userId);
			if (!existing || (existing.status === "inactive" && m.status === "active")) {
				uniqueMembersMap.set(m.userId, m);
			}
		}
		return Array.from(uniqueMembersMap.values());
	}

	private broadcastMembersUpdate(): void {
		this.broadcast({ type: "MEMBERS_UPDATE", members: this.getMembersList() });
	}

	private persistState(): void {
		this.ctx.storage.sql.exec(
			`INSERT OR REPLACE INTO room_state (key, value) VALUES ('playback', ?), ('queue', ?)`,
			JSON.stringify(this.playback),
			JSON.stringify(this.queue)
		);
	}
}
