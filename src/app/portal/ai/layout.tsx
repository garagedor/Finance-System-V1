import type { ReactNode } from "react";
import AiTabs from "./AiTabs";

// Wraps every AI Workspace page with the internal tab navigation.
export default function AiLayout({ children }: { children: ReactNode }) {
  return (
    <div className="portal-page">
      <AiTabs />
      {children}
    </div>
  );
}
