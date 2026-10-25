import type { MetadataRoute } from "next";

// What makes the site installable from a phone's share sheet: a name, a start page, standalone
// display, and 192 and 512 pixel icons (the favicon tile, rendered from app/icon.svg). Both colors
// are the phone screen color, --color-screen in app/globals.css, so the installed window's chrome and
// splash blend with the screen. No service worker and no push: installing only adds an icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Muse Friends",
    short_name: "Muse Friends",
    description: "A proposal for Muse: your agent talks to your friends' agents so plans actually happen.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#fafafa",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
