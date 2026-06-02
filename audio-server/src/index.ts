import express from "express";
import cors from "cors";
import youtubedl from "youtube-dl-exec";
import https from "https";

const app = express();
const PORT = process.env.PORT || 3001;

// Allow CORS for the frontend
app.use(cors({
  origin: "*",
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Range"],
  exposedHeaders: ["Content-Range", "Accept-Ranges", "Content-Length", "Content-Type"]
}));

// Health check endpoint (used to wake up Render on room join)
app.get("/ping", (req, res) => {
  res.json({ status: "online" });
});

// Stream endpoint: proxies actual audio bytes
app.get("/stream/:videoId", async (req, res) => {
  const { videoId } = req.params;

  if (!videoId || videoId.length < 11) {
    return res.status(400).json({ error: "Invalid videoId" });
  }

  try {
    // 1. Get info using youtube-dl-exec (uses yt-dlp binary under the hood)
    // @ts-ignore - youtube-dl-exec types conflict with NodeNext resolution
    const output = await youtubedl(`https://www.youtube.com/watch?v=${videoId}`, {
      dumpSingleJson: true,
      noCheckCertificates: true,
      noWarnings: true,
      preferFreeFormats: true,
      format: 'bestaudio'
    });

    const streamUrl = (output as any).url;
    if (!streamUrl) {
      return res.status(404).json({ error: "No audio stream found" });
    }

    // 2. Prepare headers for the upstream request
    const upstreamHeaders: Record<string, string> = {};
    if (req.headers.range) {
      upstreamHeaders["Range"] = req.headers.range;
    }

    // 3. Proxy the stream from Google CDN
    https.get(streamUrl, { headers: upstreamHeaders }, (upstreamRes) => {
      // Forward HTTP status (200 or 206)
      res.status(upstreamRes.statusCode || 200);

      // Forward relevant headers
      const headersToForward = ["content-type", "content-length", "content-range", "accept-ranges"];
      headersToForward.forEach((h) => {
        if (upstreamRes.headers[h]) {
          res.setHeader(h, upstreamRes.headers[h] as string);
        }
      });
      // Fallbacks
      if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "audio/webm");
      if (!res.getHeader("Accept-Ranges")) res.setHeader("Accept-Ranges", "bytes");

      // Pipe data
      upstreamRes.pipe(res);
      
      upstreamRes.on("error", (err) => {
        console.error(`Upstream stream error for ${videoId}:`, err);
        if (!res.headersSent) res.status(500).json({ error: "Streaming error" });
      });
    }).on("error", (err) => {
      console.error(`HTTPS get error for ${videoId}:`, err);
      if (!res.headersSent) res.status(500).json({ error: "Upstream connection error" });
    });

  } catch (error: any) {
    console.error(`Error extracting ${videoId}:`, error.message);
    res.status(503).json({ error: "Audio extraction failed", details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Audio server running on port ${PORT}`);
});
