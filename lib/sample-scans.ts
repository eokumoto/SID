import type { Scan } from "./ui-types";

export const sampleScan: Scan = {
  id: "sample-flu",
  title: "Free flu shots at the Rec Center",
  photoUrl: "/samples/flu-flyer.svg",
  createdAt: "2026-11-13T12:00:00-08:00",
  status: "ready",
  sample: true,
  text: "Free flu shots at the Rec Center.\nDay: Sat, Nov 21\nTime: 10 AM to 2 PM.\nBring your student ID.\nCost: Free",
  sections: [
    { text: "Free flu shots at the Rec Center." },
    { label: "Day", text: "Sat, Nov 21" },
    { label: "Time", text: "10 AM to 2 PM" },
    { label: "Bring", text: "Your student ID" },
    { label: "Cost", text: "Free" },
  ],
};
export const sampleHistory: Scan[] = [
  sampleScan,
  {
    ...sampleScan,
    id: "sample-lunch",
    title: "Lunch menu: Tuesday specials",
    createdAt: "2026-11-12T12:00:00-08:00",
    text: "Tuesday specials\nSoup: $5\nSandwich: $8\nLunch: 11 AM to 2 PM",
    sections: [
      { text: "Tuesday specials" },
      { label: "Soup", text: "$5" },
      { label: "Sandwich", text: "$8" },
      { label: "Lunch", text: "11 AM to 2 PM" },
    ],
    photoUrl: "/samples/lunch-menu.svg",
  },
  {
    ...sampleScan,
    id: "sample-lab",
    title: "Lab safety handout",
    status: "failed",
    text: "",
    sections: [],
    createdAt: "2026-11-10T12:00:00-08:00",
    photoUrl: "/samples/lab-handout.svg",
  },
  {
    ...sampleScan,
    id: "sample-club",
    title: "Club meeting flyer",
    createdAt: "2026-11-08T12:00:00-08:00",
    text: "Book club\nStudent Center\nFriday, 4 PM\nBring a book.",
    sections: [
      { text: "Book club" },
      { label: "Where", text: "Student Center" },
      { label: "When", text: "Friday, 4 PM" },
      { label: "Bring", text: "A book" },
    ],
    photoUrl: "/samples/book-club.svg",
  },
];
