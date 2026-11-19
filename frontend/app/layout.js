/*
  layout.js
  ---------
  The frame around every page: the <html> and <body> tags, page title and styles.
  Next.js uses this file automatically; every page is placed inside it.
*/
import "./globals.css";   // load the site-wide styles (colours, fonts, spacing) for every page

// metadata = information about the page that Next.js puts in the <head> part of the HTML
export const metadata = {
  title: "Pothole Detection System – Road Inspection",   // text shown on the browser tab
  description: "Detect potholes in road photos and videos, grade their severity and score the road.",   // short summary for search engines
};

// RootLayout: the main frame component (a component = a function that returns a piece of the web page).
// In:  children = the page content Next.js passes in (for example the home page).
// Out: the full page: <html> with a <body> that holds that content.
export default function RootLayout({ children }) {
  return (   // give back the HTML below (written in JSX = HTML-like code inside JavaScript)
    // lang="en" tells browsers and screen readers the page is in English
    <html lang="en">
      {/* <body> = the visible part of the page; {children} puts the current page's content here */}
      <body>{children}</body>
    </html>
  );
}
