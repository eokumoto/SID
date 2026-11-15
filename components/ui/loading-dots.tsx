// Ticking "..." for loading states. Dots keep their space while hidden so text never shifts.
export function LoadingDots() {
  return (
    <span className="loading-dots" aria-hidden="true">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}
