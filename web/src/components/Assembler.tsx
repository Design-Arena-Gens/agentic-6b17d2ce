"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

type Segment = {
  id: string;
  url: string;
  startSec: number;
  endSec: number;
  title?: string;
};

const DEMO_SEGMENTS: Segment[] = [
  {
    id: "g1",
    title: "Goal 1 (demo)",
    url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
    startSec: 0,
    endSec: 6,
  },
  {
    id: "g2",
    title: "Goal 2 (demo)",
    url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
    startSec: 1,
    endSec: 7,
  },
  {
    id: "g3",
    title: "Goal 3 (demo)",
    url: "https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4",
    startSec: 2,
    endSec: 8,
  },
];

function secondsToStr(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0";
  return String(Math.round(sec));
}

export default function Assembler() {
  const [segments, setSegments] = useState<Segment[]>(DEMO_SEGMENTS);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);
  const [outputUrl, setOutputUrl] = useState<string>("");
  const [error, setError] = useState<string>("");

  const ffmpegRef = useRef<FFmpeg | null>(null);

  const baseCoreUrl = useMemo(
    () => "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd",
    []
  );

  const ensureFFmpeg = useCallback(async () => {
    if (ffmpegRef.current) return ffmpegRef.current;
    const ffmpeg = new FFmpeg();

    ffmpeg.on("progress", ({ progress }) => {
      setProgress(Math.max(0, Math.min(100, Math.round(progress * 100))));
    });
    ffmpeg.on("log", ({ message }) => {
      // Minimal, avoid noisy logs in UI
      if (message?.includes("Opening") || message?.includes("frame")) return;
      setStatus(message);
    });

    setStatus("Loading video engine...");
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseCoreUrl}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseCoreUrl}/ffmpeg-core.wasm`, "application/wasm"),
    });

    ffmpegRef.current = ffmpeg;
    return ffmpeg;
  }, [baseCoreUrl]);

  const addSegment = () => {
    setSegments((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        url: "",
        startSec: 0,
        endSec: 5,
      },
    ]);
  };

  const removeSegment = (id: string) => {
    setSegments((prev) => prev.filter((s) => s.id !== id));
  };

  const updateSegment = (id: string, patch: Partial<Segment>) => {
    setSegments((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const buildVideo = useCallback(async () => {
    setError("");
    setOutputUrl("");
    setProgress(0);
    setStatus("Preparing...");
    setLoading(true);

    try {
      const sanitized = segments
        .map((s) => ({ ...s, startSec: +s.startSec, endSec: +s.endSec }))
        .filter((s) => s.url && Number.isFinite(s.startSec) && Number.isFinite(s.endSec) && s.endSec > s.startSec);

      if (sanitized.length === 0) {
        throw new Error("Please add at least one valid segment with URL and times.");
      }

      const ffmpeg = await ensureFFmpeg();

      // Clear FS from previous runs
      try {
        const files = ["concat.txt", "output.mp4"]; // common names
        for (const f of files) {
          await ffmpeg.deleteFile(f).catch(() => {});
        }
      } catch {}

      setStatus("Downloading clips...");
      // Write inputs and trim to per-segment files
      const segFiles: string[] = [];
      for (let i = 0; i < sanitized.length; i++) {
        const seg = sanitized[i];
        const inputName = `input_${i}.mp4`;
        const outputName = `seg_${i}.mp4`;

        const data = await fetchFile(seg.url);
        await ffmpeg.writeFile(inputName, data);

        const duration = Math.max(0.1, seg.endSec - seg.startSec);
        setStatus(`Cutting segment ${i + 1}/${sanitized.length}...`);
        // Re-encode for accuracy across arbitrary sources
        await ffmpeg.exec([
          "-ss",
          String(seg.startSec),
          "-t",
          String(duration),
          "-i",
          inputName,
          "-vf",
          "scale=1280:-2",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          outputName,
        ]);

        segFiles.push(outputName);
      }

      setStatus("Concatenating segments...");
      // Prepare concat list
      const concatList = segFiles.map((f) => `file '${f}'`).join("\n");
      await ffmpeg.writeFile("concat.txt", new TextEncoder().encode(concatList));

      await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        "concat.txt",
        "-c",
        "copy",
        "output.mp4",
      ]);

      const data = await ffmpeg.readFile("output.mp4");
      const blob = new Blob([data as Uint8Array], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setStatus("Done");
      setProgress(100);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || "Failed to build video");
    } finally {
      setLoading(false);
    }
  }, [ensureFFmpeg, segments]);

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Albania Goals Video Producer</h1>
      <p style={{ color: "#555" }}>
        Provide direct MP4 links and time ranges for each goal. Click ?Build Video? to
        compile them into a single MP4 in your browser.
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        {segments.map((seg, idx) => (
          <div key={seg.id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <strong>Segment {idx + 1}</strong>
              {seg.title ? <span style={{ color: "#666" }}>? {seg.title}</span> : null}
              <button
                onClick={() => removeSegment(seg.id)}
                style={{ marginLeft: "auto", background: "#ef4444", color: "white", border: 0, borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
              >
                Remove
              </button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#374151" }}>Video URL (MP4, CORS-enabled)</span>
                <input
                  placeholder="https://...mp4"
                  value={seg.url}
                  onChange={(e) => updateSegment(seg.id, { url: e.target.value })}
                  style={{ padding: 8, border: "1px solid #d1d5db", borderRadius: 6 }}
                />
              </label>
              <div style={{ display: "flex", gap: 12 }}>
                <label style={{ display: "grid", gap: 6, flex: 1 }}>
                  <span style={{ fontSize: 12, color: "#374151" }}>Start (sec)</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={secondsToStr(seg.startSec)}
                    onChange={(e) => updateSegment(seg.id, { startSec: Number(e.target.value) })}
                    style={{ padding: 8, border: "1px solid #d1d5db", borderRadius: 6 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 6, flex: 1 }}>
                  <span style={{ fontSize: 12, color: "#374151" }}>End (sec)</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={secondsToStr(seg.endSec)}
                    onChange={(e) => updateSegment(seg.id, { endSec: Number(e.target.value) })}
                    style={{ padding: 8, border: "1px solid #d1d5db", borderRadius: 6 }}
                  />
                </label>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12 }}>
        <button
          onClick={addSegment}
          style={{ background: "#e5e7eb", border: 0, borderRadius: 8, padding: "10px 14px", cursor: "pointer" }}
          disabled={loading}
        >
          + Add Segment
        </button>
        <button
          onClick={buildVideo}
          style={{ background: "#111827", color: "white", border: 0, borderRadius: 8, padding: "10px 14px", cursor: "pointer" }}
          disabled={loading}
        >
          {loading ? "Building..." : "Build Video"}
        </button>
      </div>

      {loading ? (
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ height: 10, background: "#f3f4f6", borderRadius: 999 }}>
            <div
              style={{
                width: `${progress}%`,
                height: 10,
                background: "#3b82f6",
                borderRadius: 999,
                transition: "width 200ms linear",
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: "#374151" }}>{status}</div>
        </div>
      ) : null}

      {error ? (
        <div style={{ color: "#b91c1c", background: "#fee2e2", border: "1px solid #fecaca", padding: 10, borderRadius: 8 }}>
          {error}
        </div>
      ) : null}

      {outputUrl ? (
        <div style={{ display: "grid", gap: 8 }}>
          <video src={outputUrl} controls style={{ width: "100%", borderRadius: 8 }} />
          <a
            href={outputUrl}
            download="albania-goals.mp4"
            style={{ color: "white", background: "#16a34a", padding: "10px 14px", borderRadius: 8, textAlign: "center", textDecoration: "none" }}
          >
            Download Video
          </a>
        </div>
      ) : null}

      <div style={{ fontSize: 12, color: "#6b7280" }}>
        Tip: Replace demo URLs with real MP4 highlight links for Albania goals.
      </div>
    </div>
  );
}
