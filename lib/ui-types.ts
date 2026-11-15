export type ReaderSettings = {
  font: "OpenDyslexic" | "Lexend" | "Arial";
  size: number;
  spacing:
    | "Tight"
    | "Slightly tight"
    | "Normal"
    | "Slightly wide"
    | "Wide";
  background: "cream" | "peach" | "dark" | "navy";
};

export type Scan = {
  id: string;
  title: string;
  photoUrl: string;
  createdAt: string;
  status: "queued" | "processing" | "ready" | "failed";
  text: string;
  sections: { label?: string; text: string }[];
  imagePath?: string;
  sample?: boolean;
  warnings?: string[];
  textRegions?: import("./transcription").TextRegion[];
};
