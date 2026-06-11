import { type NextRequest, NextResponse } from "next/server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function fetchPhoto(url: string) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Thread/1.0",
      Accept: "image/*",
    },
    next: { revalidate: 60 * 60 * 24 },
  });

  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) return null;

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength < 120) return null;

  return { buffer, contentType };
}

export async function GET(request: NextRequest) {
  const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) {
    return new NextResponse(null, { status: 400 });
  }

  const sources = [
    `https://unavatar.io/google/${encodeURIComponent(email)}`,
    `https://www.google.com/s2/photos/profile/${encodeURIComponent(email)}?sz=96`,
  ];

  for (const source of sources) {
    try {
      const photo = await fetchPhoto(source);
      if (!photo) continue;

      return new NextResponse(photo.buffer, {
        headers: {
          "Content-Type": photo.contentType,
          "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
        },
      });
    } catch {
      continue;
    }
  }

  return new NextResponse(null, { status: 404 });
}
