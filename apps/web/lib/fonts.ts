import localFont from "next/font/local";

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

export const instrumentSerif = localFont({
  src: [
    {
      path: "../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../node_modules/@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-serif-display",
  display: "swap",
});
