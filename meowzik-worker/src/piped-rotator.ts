// ─── Piped API Rotator ──────────────────────────────────────────────
// Maintains a list of healthy Piped instances and routes requests
// to the fastest available one, with automatic failover.

const PIPED_INSTANCES_URL =
	"https://piped-instances.kavin.rocks/";

// Verified working fallback instances (updated 2025-05-27)
// These are tried FIRST before the community list
const FALLBACK_INSTANCES = [
	"api.piped.private.coffee",
	"piapi.ggtyler.dev",
	"pipedapi.in.projectsegfau.lt",
];

// Timeout for individual Piped API calls (ms)
const PIPED_FETCH_TIMEOUT = 8_000;

// ─── Fetch with Timeout ─────────────────────────────────────────────
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = PIPED_FETCH_TIMEOUT): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { ...options, signal: controller.signal });
		return res;
	} finally {
		clearTimeout(timer);
	}
}

// ─── Instance Health Cache ──────────────────────────────────────────
export async function refreshPipedInstances(env: Env): Promise<string[]> {
	try {
		const res = await fetchWithTimeout(PIPED_INSTANCES_URL, {}, 5000);
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

		// Prepend our known-good fallback instances at the front
		// so they're always tried first
		const combined = [...FALLBACK_INSTANCES, ...apiHosts.filter(h => !FALLBACK_INSTANCES.includes(h))];

		// Cache the combined list in KV for 1 hour
		await env.PIPED_CACHE.put("healthy_instances", JSON.stringify(combined), {
			expirationTtl: 3600,
		});

		return combined;
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
			const res = await fetchWithTimeout(
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



// ─── CORS Helper (local) ────────────────────────────────────────────
function corsHeaders(): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Access-Control-Allow-Headers": "Range",
	};
}
