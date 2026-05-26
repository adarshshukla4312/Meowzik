/**
 * Meamie Worker — Edge-native entry point
 *
 * Routes:
 *   GET  /api/search?q=<query>      → Piped search proxy
 *   GET  /api/stream/:videoId       → Piped stream extraction
 *   POST /api/room                  → Create a new room
 *   GET  /api/room/:code            → Check if a room exists
 *   GET  /api/ws/:roomCode          → WebSocket upgrade → Durable Object
 *
 * The RoomEngine Durable Object is re-exported from room-engine.ts
 */

import { handleSearch, handleStream, refreshPipedInstances } from "./piped-rotator";

// Re-export the Durable Object class so Wrangler can find it
export { RoomEngine } from "./room-engine";

// ─── CORS Helper ────────────────────────────────────────────────────
function corsHeaders(): HeadersInit {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type, Upgrade",
	};
}

function corsResponse(body: unknown, status = 200): Response {
	return Response.json(body, { status, headers: corsHeaders() });
}

// ─── Room Code Generator ────────────────────────────────────────────
function generateRoomCode(): string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No ambiguous chars (0/O, 1/I)
	let code = "";
	for (let i = 0; i < 6; i++) {
		code += chars[Math.floor(Math.random() * chars.length)];
	}
	return code;
}

// ─── Main Worker ────────────────────────────────────────────────────
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Handle CORS preflight
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders() });
		}

		// ── API Routes ──────────────────────────────────────────────
		// Search for music via Piped
		if (path === "/api/search" && request.method === "GET") {
			const query = url.searchParams.get("q") || "";
			return handleSearch(query, env);
		}

		// Extract ad-free stream URL from Piped
		if (path.startsWith("/api/stream/") && request.method === "GET") {
			const videoId = path.split("/api/stream/")[1];
			return handleStream(videoId, env);
		}

		// Create a new room
		if (path === "/api/room" && request.method === "POST") {
			const roomCode = generateRoomCode();

			// Get the DO stub by name (the room code IS the DO identity)
			const id = env.ROOM_ENGINE.idFromName(roomCode);
			const stub = env.ROOM_ENGINE.get(id);

			// "Ping" the DO to ensure it initializes
			await stub.fetch(new Request("https://internal/init"));

			return corsResponse({ code: roomCode, created: true });
		}

		// Check if a room exists (by attempting a non-WS fetch to the DO)
		if (path.startsWith("/api/room/") && request.method === "GET") {
			const roomCode = path.split("/api/room/")[1]?.toUpperCase();
			if (!roomCode || roomCode.length !== 6) {
				return corsResponse({ error: "Invalid room code" }, 400);
			}

			// We can't truly "check existence" of a DO, but we can create a stub.
			// For MVP, any valid 6-char code is considered joinable.
			return corsResponse({ code: roomCode, exists: true });
		}

		// WebSocket upgrade → Durable Object
		if (path.startsWith("/api/ws/") && request.headers.get("Upgrade") === "websocket") {
			const roomCode = path.split("/api/ws/")[1]?.split("?")[0]?.toUpperCase();
			if (!roomCode || roomCode.length !== 6) {
				return new Response("Invalid room code", { status: 400 });
			}

			const id = env.ROOM_ENGINE.idFromName(roomCode);
			const stub = env.ROOM_ENGINE.get(id);
			return stub.fetch(request);
		}

		// ── Default ─────────────────────────────────────────────────
		return new Response("Meamie API v1.0", {
			headers: { "Content-Type": "text/plain", ...corsHeaders() },
		});
	},

	// Scheduled handler: refresh Piped instance cache hourly
	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		ctx.waitUntil(refreshPipedInstances(env));
	},
} satisfies ExportedHandler<Env>;
