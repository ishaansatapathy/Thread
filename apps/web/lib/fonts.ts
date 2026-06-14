import localFont from "next/font/local";

/** Landing hero headline — bundled via next/font so Vercel gets the file (public/fonts is gitignored). */
export const threadHero = localFont({
  src: "../app/fonts/ThreadHero.ttf",
  variable: "--font-thread-hero",
  display: "swap",
});

/** Handwritten annotations for callouts */
export const caveat = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/caveat/files/caveat-latin-500-normal.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/caveat/files/caveat-latin-600-normal.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/caveat/files/caveat-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-annotate",
  display: "swap",
});
