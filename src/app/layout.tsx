import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import { AuthShell } from "@/components/AuthShell";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "LBS Garage Door",
  description: "Management system for LBS Garage Door",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const navLinks = [
    { href: "/", label: "Home" },
    { href: "/tables", label: "Tables" },
    { href: "/stats", label: "Stats" },
    { href: "/balance-report", label: "Balance Report" },
    { href: "/report", label: "Report" },
    { href: "/finance", label: "Finance (legacy)" },
    { href: "/payment-method-report", label: "Payment Methods" },
    { href: "/verify-reports", label: "Verify Reports" },
    { href: "/portal/dashboard", label: "Finance Portal" },
    { href: "/admin/users", label: "Admin", adminOnly: true },
  ];

  return (
    <html lang="en">
      <body className={`${outfit.variable} font-sans antialiased`}>
        <AuthShell navLinks={navLinks}>{children}</AuthShell>
      </body>
    </html>
  );
}
