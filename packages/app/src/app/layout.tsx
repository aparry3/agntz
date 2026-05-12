import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";

export const metadata: Metadata = {
  title: "agntz",
  description: "Define, run, and manage AI agents",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  return (
    <ClerkProvider>
      <html lang="en">
        <body className="min-h-screen bg-stone-100 text-zinc-900 antialiased">
          {userId ? (
            <div className="min-h-screen lg:flex">
              <AppSidebar />
              <main className="flex-1">
                <div className="mx-auto min-h-screen max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
                  {children}
                </div>
              </main>
            </div>
          ) : (
            children
          )}
        </body>
      </html>
    </ClerkProvider>
  );
}
