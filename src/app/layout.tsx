import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ToastProvider } from "@/components/ui/toast-provider";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Big Joe Gold | Trading management",
  description: "Gold inventory, trading, payments, and business reporting.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const savedTheme = (await cookies()).get("big-joe-gold-theme")?.value;
  const initialTheme = savedTheme === "dark" ? "dark" : "light";

  return (
    <html lang="en" className="h-full antialiased" data-theme={initialTheme} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try {
            const theme = localStorage.getItem("big-joe-gold-theme");
            if (theme === "light" || theme === "dark") {
              document.documentElement.dataset.theme = theme;
              document.cookie = "big-joe-gold-theme=" + theme + "; Path=/; Max-Age=31536000; SameSite=Lax";
            }
          } catch {}`,
          }}
        />
      </head>
      <body className="min-h-full">
        <ThemeProvider initialTheme={initialTheme}><ToastProvider>{children}</ToastProvider></ThemeProvider>
      </body>
    </html>
  );
}
