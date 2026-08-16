import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink } from "@trpc/client";
import { trpc } from "./trpc.ts";
import { profileHeaders } from "./lib/profile.ts";
import { Home } from "./pages/Home.tsx";
import { BookDetail } from "./pages/BookDetail.tsx";
import { Chat } from "./pages/Chat.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchStreamLink({
      url: "/trpc",
      headers: () => profileHeaders(),
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/folders/:folderId" element={<Home />} />
            <Route path="/books/:id" element={<BookDetail />} />
            <Route path="/chat" element={<Chat />} />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </trpc.Provider>
  </StrictMode>
);
