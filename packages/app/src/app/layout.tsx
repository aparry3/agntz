import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  weight: ["300", "400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  weight: ["400", "500", "600"],
});

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
      <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
        <body className="min-h-screen bg-ag-bg text-ag-ink antialiased">
          {userId ? (
            <div className="min-h-screen lg:flex">
              <AppSidebar />
              <main className="flex-1 min-w-0">{children}</main>
            </div>
          ) : (
            children
          )}
        </body>
      </html>
    </ClerkProvider>
  );
}
