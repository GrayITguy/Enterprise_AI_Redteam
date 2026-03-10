import { api } from "./api";

export async function downloadFile(url: string, fallbackFilename: string): Promise<void> {
  const response = await api.get(url, { responseType: "blob" });
  const blob = new Blob([response.data]);

  // Extract filename from Content-Disposition header if available
  const disposition = response.headers["content-disposition"];
  const match = disposition?.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? fallbackFilename;

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}
