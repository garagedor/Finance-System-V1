import { redirect } from "next/navigation";

// Banking module is Plaid-first. The top-level URL routes straight to
// Connections so users land on the bank-account view immediately. The
// previous "manual accounts" workflow has been removed — accounts come
// from Plaid only.
export default function BankingIndex() {
  redirect("/portal/banking/connections");
}
