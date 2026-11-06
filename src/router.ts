import { useEffect, useState } from "react";

/** Two pages, so a tiny pushState router instead of a dependency: "/" (list) and "/reels/:id" (editor). */
export type Route = { page: "list" } | { page: "editor"; id: number };

const parse = (path: string): Route => {
  const m = path.match(/^\/reels\/(\d+)\/?$/);
  return m ? { page: "editor", id: Number(m[1]) } : { page: "list" };
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
