import { useEffect, useState } from "react";

/** A few pages, so a tiny pushState router instead of a dependency: "/" (list), "/channels", "/reels/:id" (editor). */
export type Route = { page: "list" } | { page: "channels" } | { page: "editor"; id: number };

const parse = (path: string): Route => {
  const m = path.match(/^\/reels\/(\d+)\/?$/);
  if (m) return { page: "editor", id: Number(m[1]) };
  return /^\/channels\/?$/.test(path) ? { page: "channels" } : { page: "list" };
};

export const navigate = (path: string) => {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.pathname));
  useEffect(() => {
    const on = () => setRoute(parse(window.location.pathname));
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return route;
}
