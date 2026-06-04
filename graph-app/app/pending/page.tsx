import { redirect } from "next/navigation";

// Backward-compat shim. /pending was renamed to /inbox in v2.5.0.
// Kept through v2.7.0; removed at v2.8.0 per the redesign spec §8 Q5.
export default function PendingRedirect(): never {
  redirect("/inbox");
}
