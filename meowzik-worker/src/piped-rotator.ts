// ─── Piped API Rotator ──────────────────────────────────────────────
// Maintains a list of healthy Piped instances and routes requests
// to the fastest available one, with automatic failover.

const PIPED_INSTANCES_URL =
	"https://piped-instances.kavin.rocks/";

// Verified working fallback instances (updated 2025-05-27)
// These are tried FIRST before the community list
const FALLBACK_INSTANCES = [
	"api.piped.private.coffee",
];

// Timeout for individual Piped API calls (ms)
const PIPED_FETCH_TIMEOUT = 8_000;
const SEARCH_FETCH_TIMEOUT = 2_000;
const SEARCH_FILTERS = ["videos", ""];
const INVIDIOUS_FALLBACK_INSTANCES = ["inv.thepixora.com"];

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

	const invidiousItems = await searchInvidious(query);
	if (invidiousItems.length > 0) {
		return Response.json({ items: invidiousItems }, {
			headers: { "Access-Control-Allow-Origin": "*" },
		});
	}

	const instances = (await getHealthyInstances(env)).slice(0, 2);
	let lastEmptyData: unknown = null;

	for (const instance of instances) {
		for (const filter of SEARCH_FILTERS) {
			try {
				const params = new URLSearchParams({ q: query });
				if (filter) params.set("filter", filter);

				const res = await fetchWithTimeout(
					`https://${instance}/search?${params.toString()}`,
					{ headers: { Accept: "application/json" } },
					SEARCH_FETCH_TIMEOUT
				);

				if (!res.ok) continue;

				const data = await res.json();
				const items = normalizeSearchItems(data);

				if (items.length > 0) {
					const responseData = Array.isArray(data)
						? { items }
						: { ...(data as Record<string, unknown>), items };

					return Response.json(responseData, {
						headers: { "Access-Control-Allow-Origin": "*" },
					});
				}

				lastEmptyData = data;
			} catch {
				console.warn(`Piped instance ${instance} failed for search, rotating...`);
			}
		}
	}

	if (lastEmptyData) {
		return Response.json(lastEmptyData, {
			headers: { "Access-Control-Allow-Origin": "*" },
		});
	}

	return Response.json(
		{ error: "All Piped instances failed" },
		{ status: 502, headers: { "Access-Control-Allow-Origin": "*" } }
	);
}

async function searchInvidious(query: string): Promise<any[]> {
	for (const instance of INVIDIOUS_FALLBACK_INSTANCES) {
		try {
			const params = new URLSearchParams({ q: query, type: "video" });
			const res = await fetchWithTimeout(
				`https://${instance}/api/v1/search?${params.toString()}`,
				{ headers: { Accept: "application/json" } },
				SEARCH_FETCH_TIMEOUT
			);

			if (!res.ok) continue;

			const data = await res.json();
			if (!Array.isArray(data)) continue;

			const items = data
				.filter((item: any) => {
					return (
						item?.type === "video" &&
						typeof item.videoId === "string" &&
						item.videoId.length === 11 &&
						!item.liveNow
					);
				})
				.map((item: any) => ({
					url: `/watch?v=${item.videoId}`,
					title: item.title,
					uploaderName: item.author,
					duration: item.lengthSeconds || 0,
					thumbnail: `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`,
				}));

			if (items.length > 0) return items;
		} catch {
			console.warn(`Invidious instance ${instance} failed for search, rotating...`);
		}
	}

	return [];
}

function normalizeSearchItems(data: unknown): any[] {
	if (Array.isArray(data)) {
		return data.filter(isPlayableSearchItem);
	}

	if (!data || typeof data !== "object") {
		return [];
	}

	const maybeItems = (data as { items?: unknown }).items;
	if (!Array.isArray(maybeItems)) {
		return [];
	}

	return maybeItems.filter(isPlayableSearchItem);
}

function isPlayableSearchItem(item: unknown): boolean {
	if (!item || typeof item !== "object") return false;

	const value = item as Record<string, unknown>;
	const url = typeof value.url === "string" ? value.url : "";
	const type = typeof value.type === "string" ? value.type.toLowerCase() : "";

	return (
		(Boolean(value.title) && (url.includes("watch?v=") || type === "stream" || type === "video" || type === "music"))
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
