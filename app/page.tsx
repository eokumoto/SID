import { SidApp } from "@/components/sid-app";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const params = await searchParams;
  return (
    <SidApp
      preview={typeof params.preview === "string" ? params.preview : ""}
    />
  );
}
