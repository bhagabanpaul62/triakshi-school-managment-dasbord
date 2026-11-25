export type FileKind = "image" | "pdf" | "sheet" | "doc" | "other";

export const fileKind = (name: string, type?: string): FileKind => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (type?.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic"].includes(ext)) return "image";
  if (type === "application/pdf" || ext === "pdf") return "pdf";
  if (["xls", "xlsx", "csv"].includes(ext)) return "sheet";
  if (["doc", "docx", "txt", "ppt", "pptx", "odt"].includes(ext)) return "doc";
  return "other";
};

/** "412 KB", "3.2 MB". */
export const fileSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`);
