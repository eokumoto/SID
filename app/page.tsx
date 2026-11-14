import { Capture } from "@/components/capture";

export default function Home() {
  return (
    <div className="shell">
      <header className="site-header">
        <h1>SID</h1>
      </header>
      <main>
        <Capture />
      </main>
    </div>
  );
}
