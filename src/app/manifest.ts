import type { MetadataRoute } from "next";

// Web app manifest → "Add to Home Screen" / installable PWA. Opens standalone
// at the dashboard. NOTE: for the best install experience on Android/Chrome,
// add raster icons public/icon-192.png and public/icon-512.png (derive from
// public/logo.svg) and add them to the `icons` array with purpose "maskable".
// The SVG below keeps the manifest valid and installable in the meantime.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RGossips Admin",
    short_name: "RG Admin",
    description: "Admin panel for the RGossips platform",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      {
        src: "/logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
