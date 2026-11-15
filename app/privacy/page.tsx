// app/privacy/page.tsx -> https://simplified-information-display.vercel.app/privacy
// Replace CONTACT_EMAIL before publishing.
const CONTACT_EMAIL = "eokumoto28@gmail.com";

export const metadata = { title: "Privacy | SID" };

export default function PrivacyPage() {
  return (
    <main
      style={{
        maxWidth: 680,
        margin: "0 auto",
        padding: "32px 16px",
        lineHeight: 1.6,
      }}
    >
      <h1>Privacy Policy</h1>
      <p>Last updated: November 15, 2026</p>
      <p>
        SID (Simplified Information Display) is a student hackathon project that
        turns photos of text into easier-to-read text.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <b>Photos you upload.</b> If you are not signed in, SID uses a
          temporary guest session. Your photo is deleted from our servers as
          soon as it has been read. The extracted text stays with that guest
          session, and a copy of the scan is kept in your browser so you can
          save it if you sign in.
        </li>
        <li>
          <b>If you sign in with Google or email:</b> your name, email address
          and profile picture, plus the scans you save (the photo and its text).
        </li>
        <li>
          <b>Settings</b> such as font and size, stored in your browser and, if
          signed in, in your account.
        </li>
      </ul>

      <h2>How photos are processed</h2>
      <p>
        To read the text, your photo is sent to the Google Gemini API, and to
        Google Cloud Vision when that second check is turned on. Summaries are
        also made with Gemini, and Listen sends the text to Google Cloud
        Text-to-Speech. Google&apos;s terms may allow it to use content sent to
        the free Gemini API to improve its services. Please do not upload
        private documents, IDs, medical or financial papers.
      </p>

      <h2>Where data is stored</h2>
      <p>
        Accounts and saved scans are stored with Supabase. Free accounts and
        guests can read 10 photos a day, so we keep a daily count of your
        scans. Only you can see your
        saved scans. The site is hosted on Vercel.
      </p>

      <h2>What we don&apos;t do</h2>
      <p>
        We do not sell your data, show ads, or share your data with anyone
        except the services listed above that run SID.
      </p>

      <h2>Deleting your data</h2>
      <p>
        You can delete any saved scan in History. To delete your account and
        everything in it, email us and we will remove it.
      </p>

      <h2>Contact</h2>
      <p>{CONTACT_EMAIL}</p>
    </main>
  );
}
