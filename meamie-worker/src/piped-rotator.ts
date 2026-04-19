// ─── Piped API Rotator ──────────────────────────────────────────────
// Maintains a list of healthy Piped instances and routes requests
// to the fastest available one, with automatic failover.

const PIPED_INSTANCES_URL =
	"https://piped-instances.kavin.rocks/";

// Fallback instances if the community list fetch fails
const FALLBACK_INSTANCES = [
	"api.piped.private.coffee",
	"pipedapi.kavin.rocks",
	"pipedapi.adminforge.de",
];

// ─── Instance Health Cache ──────────────────────────────────────────
export async function refreshPipedInstances(env: Env): Promise<string[]> {
	try {
		const res = await fetch(PIPED_INSTANCES_URL);
		if (!res.ok) throw new Error(`Failed to fetch instances: ${res.status}`);

		const instances: Array<{ api_url: string }> = await res.json();

		// Extract API hostnames, filter out empty/invalid entries
		const apiHosts = instances
			.map((inst) => {
				try {
					const url = new URL(inst.api_url);
					return url.host;
				} catch {
					return null;
				}
			})
			.filter((host): host is string => host !== null);

		if (apiHosts.length === 0) return FALLBACK_INSTANCES;

		// Cache the healthy list in KV for 1 hour
		await env.PIPED_CACHE.put("healthy_instances", JSON.stringify(apiHosts), {
			expirationTtl: 3600,
		});

		return apiHosts;
	} catch {
		return FALLBACK_INSTANCES;
	}
}

async function getHealthyInstances(env: Env): Promise<string[]> {
	const cached = await env.PIPED_CACHE.get("healthy_instances", "json");
	if (cached && Array.isArray(cached) && cached.length > 0) {
		return cached as string[];
	}
	return refreshPipedInstances(env);
}

// ─── Search Proxy ───────────────────────────────────────────────────
export async function handleSearch(
	query: string,
	env: Env
): Promise<Response> {
	if (!query || query.trim().length === 0) {
		return Response.json({ error: "Missing query parameter" }, { status: 400 });
	}

	const instances = await getHealthyInstances(env);

	for (const instance of instances) {
		try {
			const res = await fetch(
				`https://${instance}/search?q=${encodeURIComponent(query)}&filter=music_songs`,
				{ headers: { Accept: "application/json" } }
			);

			if (!res.ok) continue;

			const data = await res.json();
			return Response.json(data, {
				headers: { "Access-Control-Allow-Origin": "*" },
			});
		} catch {
			console.warn(`Piped instance ${instance} failed for search, rotating...`);
		}
	}

	return Response.json(
		{ error: "All Piped instances failed" },
		{ status: 502, headers: { "Access-Control-Allow-Origin": "*" } }
	);
}

// ─── Stream Extraction ──────────────────────────────────────────────
export async function handleStream(
	videoId: string,
	env: Env
): Promise<Response> {
	if (!videoId || videoId.trim().length === 0) {
		return Response.json({ error: "Missing videoId" }, { status: 400 });
	}

	const instances = await getHealthyInstances(env);

	for (const instance of instances) {
		try {
			const res = await fetch(`https://${instance}/streams/${videoId}`, {
				headers: { Accept: "application/json" },
			});

			if (!res.ok) continue;

			const data: any = await res.json();

			// Find the best audio-only stream (prefer M4A for broad compatibility)
			const audioStreams = data.audioStreams || [];
			const bestAudio =
				audioStreams.find(
					(s: any) => s.mimeType?.includes("audio/mp4") || s.format === "M4A"
				) || audioStreams[0];

			if (!bestAudio) continue;

			return Response.json(
				{
					url: bestAudio.url,
					mimeType: bestAudio.mimeType,
					quality: bestAudio.quality,
					bitrate: bestAudio.bitrate,
					title: data.title,
					uploader: data.uploader,
					uploaderUrl: data.uploaderUrl,
					thumbnailUrl: data.thumbnailUrl,
					duration: data.duration,
				},
				{ headers: { "Access-Control-Allow-Origin": "*" } }
			);
		} catch {
			console.warn(`Piped instance ${instance} failed for stream, rotating...`);
		}
	}

	return Response.json(
		{ error: "All Piped instances failed to extract stream" },
		{ status: 502, headers: { "Access-Control-Allow-Origin": "*" } }
	);
}
