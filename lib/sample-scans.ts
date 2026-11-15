import type { Scan } from "./ui-types";

export const proSampleScan: Scan = {
  id: "sample-housing", title: "Campus housing update", sample: true,
  photoUrl: "/samples/housing-update.svg", createdAt: "2026-11-14T12:00:00Z", status: "ready",
  text: "Campus housing update\n\nMove-out for winter break is Dec 18 by 5 PM. Leave your key at the front desk before you leave campus. Please check your room carefully and take your belongings with you. Make sure windows are closed, lights are switched off, and any personal appliances are unplugged.\n\nRooms will be checked on Dec 19. Items left behind will be stored for 30 days. Contact the housing office if you have questions about leaving your room or collecting stored belongings. Staff can explain the process and help you find the information you need before you leave.",
  sections: [],
};

export const sampleScan: Scan = {
  id: "sample-flu",
  title: "Free flu shots at the Rec Center",
  photoUrl: "/samples/flu-flyer.svg",
  createdAt: "2026-11-13T12:00:00-08:00",
  status: "ready",
  sample: true,
  text: "FREE FLU SHOTS\nREC CENTER\nSAT, NOV 21\n10 AM – 2 PM\nBring your student ID.\nFREE\nSAMPLE FLYER",
  sections: [{ text: "FREE FLU SHOTS\nREC CENTER\nSAT, NOV 21\n10 AM – 2 PM\nBring your student ID.\nFREE\nSAMPLE FLYER" }],
  textRegions: [
    { text: "FREE FLU SHOTS", box_2d: [172, 180, 225, 820] },
    { text: "REC CENTER", box_2d: [279, 320, 319, 680] },
    { text: "SAT, NOV 21", box_2d: [373, 360, 408, 640] },
    { text: "10 AM – 2 PM", box_2d: [460, 355, 495, 645] },
    { text: "Bring your student ID.", box_2d: [548, 300, 583, 700] },
    { text: "FREE", box_2d: [635, 435, 670, 565] },
    { text: "SAMPLE FLYER", box_2d: [901, 320, 928, 680] },
  ],
};
export const sampleHistory: Scan[] = [
  sampleScan,
  {
    ...sampleScan,
    id: "sample-lunch",
    textRegions: [],
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
    textRegions: [],
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
    textRegions: [],
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
