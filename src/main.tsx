import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "./App";
import { ReelsPage } from "./ReelsPage";
import { useRoute } from "./router";
import "./styles.css";

function Root() {
  const route = useRoute();
  return route.page === "editor" ? <Editor key={route.id} reelId={route.id} /> : <ReelsPage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
