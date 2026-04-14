import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";

export const metadata: Metadata = {
  title: "Agent Runner",
  description: "Define, run, and manage AI agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen bg-stone-100 text-zinc-900 antialiased">
          <div className="min-h-screen lg:flex">
            <AppSidebar />
            <main className="flex-1">
              <div className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
                {children}
              </div>
            </main>
          </div>
        </body>
      </html>
    </ClerkProvider>
  );
}
