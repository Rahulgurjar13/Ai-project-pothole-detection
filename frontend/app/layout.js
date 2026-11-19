/*
  layout.js
  ---------
  The frame around every page: the <html> and <body> tags, page title and styles.
*/
import "./globals.css";

export const metadata = {
  title: "Pothole Detection System – Road Inspection",
  description: "Detect potholes in road photos and videos, grade their severity and score the road.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
