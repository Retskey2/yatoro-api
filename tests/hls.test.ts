import { describe, expect, it } from "bun:test";
import {
  buildLadder,
  buildTranscodeArgs,
  contentTypeFor,
  progressFromLine,
  signPlaylist,
} from "@/modules/video/hls";

describe("buildLadder", () => {
  it("never upscales", () => {
    expect(buildLadder(1080).map((r) => r.name)).toEqual(["360p", "720p", "1080p"]);
    expect(buildLadder(720).map((r) => r.name)).toEqual(["360p", "720p"]);
    expect(buildLadder(1440).map((r) => r.name)).toEqual(["360p", "720p", "1080p"]);
  });

  it("gives a tiny source one rendition of its own (even) height", () => {
    expect(buildLadder(91)).toEqual([{ name: "90p", height: 90, bitrate: 400 }]);
  });
});

describe("buildTranscodeArgs", () => {
  const args = buildTranscodeArgs({
    input: "/tmp/in",
    outDir: "/tmp/out",
    ladder: buildLadder(720),
    hasAudio: true,
  });
  const value = (flag: string) => args[args.indexOf(flag) + 1];

  it("decodes once and scales per rendition", () => {
    expect(value("-filter_complex")).toBe(
      "[0:v]split=2[v0][v1];[v0]scale=-2:360[v0o];[v1]scale=-2:720[v1o]",
    );
  });

  it("aligns keyframes across renditions so the player can switch quality at any segment", () => {
    expect(value("-force_key_frames")).toBe("expr:gte(t,n_forced*6)");
    expect(value("-hls_time")).toBe("6");
  });

  it("maps every rendition to its own playlist, with audio", () => {
    expect(value("-var_stream_map")).toBe("v:0,a:0,name:360p v:1,a:1,name:720p");
    expect(value("-master_pl_name")).toBe("master.m3u8");
    expect(value("-hls_segment_type")).toBe("fmp4");
  });

  it("works without an audio track", () => {
    const silent = buildTranscodeArgs({
      input: "/tmp/in",
      outDir: "/tmp/out",
      ladder: buildLadder(360),
      hasAudio: false,
    });
    expect(silent[silent.indexOf("-var_stream_map") + 1]).toBe("v:0,name:360p");
    expect(silent).not.toContain("0:a:0");
    expect(silent).not.toContain("aac");
  });
});

describe("progressFromLine", () => {
  it("turns ffmpeg progress into percent, capped below 100 until upload is done", () => {
    expect(progressFromLine("out_time_us=6000000", 12)).toBe(50);
    expect(progressFromLine("out_time_us=13000000", 12)).toBe(99);
    expect(progressFromLine("progress=continue", 12)).toBeNull();
    expect(progressFromLine("out_time_us=1000", 0)).toBeNull();
  });
});

describe("signPlaylist", () => {
  // As produced by ffmpeg 6.1 in the worker image
  const playlist = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    "#EXT-X-TARGETDURATION:6",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    '#EXT-X-MAP:URI="init_1.mp4"',
    "#EXTINF:6.000000,",
    "seg_000.m4s",
    "#EXTINF:6.000000,",
    "seg_001.m4s",
    "#EXT-X-ENDLIST",
  ].join("\n");

  const signed = signPlaylist(playlist, (path) => `https://s3.test/${path}?sig=1`);

  it("signs every segment", () => {
    expect(signed).toContain("https://s3.test/seg_000.m4s?sig=1");
    expect(signed).toContain("https://s3.test/seg_001.m4s?sig=1");
  });

  it("signs the fMP4 init segment too — the player cannot start without it", () => {
    expect(signed).toContain('#EXT-X-MAP:URI="https://s3.test/init_1.mp4?sig=1"');
    expect(signed).not.toContain('URI="init_1.mp4"');
  });

  it("keeps tags untouched", () => {
    expect(signed).toContain("#EXT-X-TARGETDURATION:6");
    expect(signed).toContain("#EXTINF:6.000000,");
    expect(signed.endsWith("#EXT-X-ENDLIST")).toBe(true);
  });
});

it("serves HLS files with their proper content types", () => {
  expect(contentTypeFor("720p/index.m3u8")).toBe("application/vnd.apple.mpegurl");
  expect(contentTypeFor("720p/seg_000.m4s")).toBe("video/iso.segment");
  expect(contentTypeFor("720p/init_1.mp4")).toBe("video/mp4");
  expect(contentTypeFor("poster.jpg")).toBe("image/jpeg");
});
