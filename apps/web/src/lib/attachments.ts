import type { SdkImage } from "@harness/shared";

/**
 * Composer attachments. Images are sent to the agent as base64 `SdkImage`
 * (the SDK's only first-class attachment — see ledger OQ-23). Non-image files
 * have no SDK attachment slot, so we surface them as a chip and append a
 * reference line to the prompt (the agent can open paths under its cwd). In
 * Electron a dropped file exposes an absolute `path`; in the browser it does
 * not, so we fall back to the bare filename.
 */
export const MAX_IMAGE_ATTACHMENTS = 16;

export interface ImageAttachment {
  id: string;
  kind: "image";
  name: string;
  /** Sent to the agent. */
  image: SdkImage;
  /** Object URL for the chip thumbnail; revoke on removal. */
  previewUrl: string;
}

export interface FileAttachment {
  id: string;
  kind: "file";
  name: string;
  /** Absolute path when available (Electron drops); undefined in the browser. */
  path?: string;
}

export type ComposerAttachment = ImageAttachment | FileAttachment;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `att-${counter}-${Date.now().toString(36)}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("file read failed"));
    reader.readAsDataURL(file);
  });
}

/** Strip the `data:<mime>;base64,` prefix to get raw base64 bytes. */
function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export async function fileToAttachment(file: File): Promise<ComposerAttachment> {
  if (isImageFile(file)) {
    const dataUrl = await readAsDataUrl(file);
    return {
      id: nextId(),
      kind: "image",
      name: file.name,
      image: { data: stripDataUrlPrefix(dataUrl), mimeType: file.type },
      previewUrl: dataUrl,
    };
  }
  // Electron File objects carry an absolute `path`; the DOM lib type doesn't
  // declare it, so read it defensively.
  const path = (file as File & { path?: string }).path;
  return {
    id: nextId(),
    kind: "file",
    name: file.name,
    ...(typeof path === "string" && path.length > 0 ? { path } : {}),
  };
}

export function attachmentImages(attachments: ReadonlyArray<ComposerAttachment>): SdkImage[] {
  return attachments
    .filter((a): a is ImageAttachment => a.kind === "image")
    .map((a) => a.image);
}

/**
 * A trailing reference block for any non-image file attachments, appended to
 * the prompt text. Uses absolute paths when available so the agent can open
 * them from its cwd; otherwise lists the bare filenames.
 */
export function fileReferenceText(attachments: ReadonlyArray<ComposerAttachment>): string {
  const files = attachments.filter((a): a is FileAttachment => a.kind === "file");
  if (files.length === 0) return "";
  const lines = files.map((f) => `- ${f.path ?? f.name}`);
  return `\n\nAttached files:\n${lines.join("\n")}`;
}
