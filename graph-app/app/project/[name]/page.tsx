import { redirect } from "next/navigation";

export default async function ProjectRedirect({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  redirect(`/projects/${encodeURIComponent(name)}`);
}
