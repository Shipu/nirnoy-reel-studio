import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Editor } from "./App";
import { ChannelsPage } from "./ChannelsPage";
import { ReelsPage } from "./ReelsPage";
import { useRoute } from "./router";
import "./styles.css";

function Root() {
  const route = useRoute();
  if (route.page === "editor") return <Editor key={route.id} reelId={route.id} />;
  return route.page === "channels" ? <ChannelsPage /> : <ReelsPage />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
