import { redirect } from "next/navigation";

// Der Champion-vs-Challenger-Vergleich ist in der SignalPilot Arena aufgegangen.
export default function ComparisonPage() {
  redirect("/dashboard/trading/arena");
}
