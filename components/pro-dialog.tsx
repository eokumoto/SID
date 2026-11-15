import { PRO_PRICE } from "@/lib/pro";
import { Dialog } from "./ui/dialog";
import { Icon } from "./ui/icon";

export function ProDialog({ onClose }: { onClose: () => void }) {
  return <Dialog label="SID Pro" className="pro-dialog" animateClose onClose={onClose}>
    <h2>SID Pro</h2>
    <table className="pro-comparison">
      <caption className="sr-only">Compare Free and SID Pro</caption>
      <thead><tr><th scope="col"><span className="sr-only">Feature</span></th><th scope="col">Free</th><th scope="col">Pro</th></tr></thead>
      <tbody>
        <tr><th scope="row">Uploads</th><td>10 a day</td><td>150 a day</td></tr>
        {[
          ["Clear-font reader", true], ["Settings (font, size, color)", true],
          ["Listen (read aloud)", false], ["Voice and speed", false], ["Summary", false], ["Saved history", true],
        ].map(([label, free]) => <tr key={String(label)}><th scope="row">{label}</th><td>{free ? <><Icon name="check" /><span className="sr-only">Included</span></> : <span aria-label="Not included">—</span>}</td><td><Icon name="check" /><span className="sr-only">Included</span></td></tr>)}
      </tbody>
    </table>
    <p className="pro-price">{PRO_PRICE}<span> / month</span></p>
    <button type="button" className="button" disabled aria-describedby="pro-coming-soon"><Icon name="star" />Go Pro</button>
    <p id="pro-coming-soon" className="pro-coming-soon">Coming soon</p>
  </Dialog>;
}
