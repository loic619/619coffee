import { redirect } from "next/navigation";

// The landing is the Daily Brief. It is built as the returning-user home —
// what changed since yesterday, what is coming, what is making news — which
// is a daily behaviour. The map is a browse-and-explore surface, a first-visit
// behaviour, and it was the landing page until September 2026; it stays one
// tap away in the nav.
export default function Home() {
  redirect("/news");
}
