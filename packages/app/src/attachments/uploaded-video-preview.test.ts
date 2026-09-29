import { describe, expect, it, vi } from "vitest";
import type { UploadedFileAttachment } from "@getpaseo/protocol/messages";
import {
  acquireUploadedVideoPreview,
  MAX_VIDEO_PREVIEW_BYTES,
  splitUploadedFilePath,
} from "./uploaded-video-preview";

const attachment: UploadedFileAttachment = {
  type: "uploaded_file",
  id: "upload-1",
  fileName: "capture.mp4",
  mimeType: "video/mp4",
  size: 3,
  path: "/paseo/uploads/upload-1/capture.mp4",
};

describe("uploaded video previews", () => {
  it("splits POSIX and Windows upload paths into a scoped file request", () => {
    expect(splitUploadedFilePath("/tmp/upload/capture.mp4")).toEqual({
      cwd: "/tmp/upload",
      path: "capture.mp4",
    });
    expect(splitUploadedFilePath("C:\\Paseo\\uploads\\capture.mp4")).toEqual({
      cwd: "C:\\Paseo\\uploads",
      path: "capture.mp4",
    });
  });

  it("reads through the bounded binary channel and preserves the video MIME type", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const readFile = vi.fn(async () => ({
      bytes,
      mime: "application/octet-stream",
      size: bytes.byteLength,
      path: "capture.mp4",
      kind: "binary" as const,
      modifiedAt: "2026-09-20T00:00:00.000Z",
    }));
    const metadata = {
      id: "preview-id",
      mimeType: "video/mp4",
      storageType: "web-indexeddb" as const,
      storageKey: "preview-id",
      fileName: "capture.mp4",
      byteSize: 3,
      createdAt: 1,
    };
    const persist = vi.fn(async () => metadata);

    await expect(
      acquireUploadedVideoPreview({
        attachment,
        serverId: "host-1",
        port: { readFile, persist },
      }),
    ).resolves.toEqual(metadata);
    expect(readFile).toHaveBeenCalledWith(
      "/paseo/uploads/upload-1",
      "capture.mp4",
      MAX_VIDEO_PREVIEW_BYTES,
    );
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ bytes, mimeType: "video/mp4", fileName: "capture.mp4" }),
    );
  });
});
