export type ReaderSettings = {
  font: "OpenDyslexic" | "Lexend" | "Arial";
  size: number;
  spacing: "Tight" | "Normal" | "Wide";
  background: "cream" | "peach" | "dark" | "navy";
  reduceMotion: boolean;
};

export type Scan = {
  id: string;
  title: string;
  photoUrl: string;
  createdAt: string;
  status: "ready" | "failed";
  text: string;
  sections: { label?: string; text: string }[];
  imagePath?: string;
  sample?: boolean;
};
