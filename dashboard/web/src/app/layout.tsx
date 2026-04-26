import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import VersionBadge from "@/components/VersionBadge";
import NavAuth from "@/components/NavAuth";
import { AuthProvider } from "@/lib/AuthContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Killzone — ICT Trading Operations",
  description: "ICT Scanner — real-time signals, performance, and proposal queue",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100">
        <AuthProvider>
          <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-14">
                <div className="flex items-center gap-3">
                  <span className="text-xl">🎯</span>
                  <h1 className="text-lg font-semibold tracking-tight font-[family-name:var(--font-geist-sans)]">
                    Killzone <VersionBadge />
                  </h1>
                </div>
                <nav className="flex items-center gap-1 font-[family-name:var(--font-geist-sans)]">
                  <a href="/" className="px-3 py-1.5 text-sm rounded-md hover:bg-zinc-800 transition-colors">Overview</a>
                  <a href="/trades" className="px-3 py-1.5 text-sm rounded-md hover:bg-zinc-800 transition-colors">Trades</a>
                  <a href="/scanner" className="px-3 py-1.5 text-sm rounded-md hover:bg-zinc-800 transition-colors">Scanner</a>
                  <a href="/proposals" className="px-3 py-1.5 text-sm rounded-md hover:bg-zinc-800 transition-colors">Proposals</a>
                  <a href="/users" className="px-3 py-1.5 text-sm rounded-md hover:bg-zinc-800 transition-colors">Users</a>
                  <a href="/roadmap" className="px-3 py-1.5 text-sm rounded-md hover:bg-zinc-800 transition-colors">Roadmap</a>
                  <a href="/system" className="px-3 py-1.5 text-sm rounded-md hover:bg-zinc-800 transition-colors">System</a>
                  <NavAuth />
                </nav>
              </div>
            </div>
          </header>

          <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
            {children}
          </main>

          <footer className="border-t border-zinc-800 py-3">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <p className="text-xs text-zinc-600 text-center font-[family-name:var(--font-geist-mono)]">
                Killzone — ICT Scanner — Captain Hook (Discord) • paper baseline
              </p>
            </div>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}
