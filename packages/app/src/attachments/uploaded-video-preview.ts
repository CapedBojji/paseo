import type { FileReadResult } from "@getpaseo/client/internal/daemon-client";
import type { UploadedFileAttachment } from "@getpaseo/protocol/messages";
import type { AttachmentMetadata } from "@/attachments/types";
import { createPreviewAttachmentId } from "@/attachments/utils";

export const MAX_VIDEO_PREVIEW_BYTES = 50 * 1024 * 1024;

export interface UploadedVideoPreviewPort {
  readFile(cwd: string, path: string, maxBytes: number): Promise<FileReadResult>;
  persist(input: {
    id: string;
    bytes: Uint8Array;
    mimeType: string;
    fileName: string;
  }): Promise<AttachmentMetadata>;
}

export function splitUploadedFilePath(path: string): { cwd: string; path: string } {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (slash < 0) {
    return { cwd: ".", path };
  }
  const cwd = slash === 0 ? path.slice(0, 1) : path.slice(0, slash);
  return { cwd, path: path.slice(slash + 1) };
}

export async function acquireUploadedVideoPreview(input: {
  attachment: UploadedFileAttachment;
  serverId: string;
  port: UploadedVideoPreviewPort;
}): Promise<AttachmentMetadata> {
  const { cwd, path } = splitUploadedFilePath(input.attachment.path);
  const file = await input.port.readFile(cwd, path, MAX_VIDEO_PREVIEW_BYTES);
  return await input.port.persist({
    id: createPreviewAttachmentId({
      mimeType: input.attachment.mimeType,
      path: input.attachment.path,
      size: input.attachment.size,
      modifiedAt: file.modifiedAt,
      contentLength: file.bytes.byteLength,
      contentKey: `${input.serverId}:${input.attachment.id}`,
    }),
    bytes: file.bytes,
    mimeType: input.attachment.mimeType,
    fileName: input.attachment.fileName,
  });
}
