import { Inter, Merriweather, Nunito, Playfair_Display, Poppins, Source_Sans_3 } from "next/font/google";

// One CSS variable per theme font; the site templates pick them (see @smw/site-templates/render FONT_VAR).
// preload is off so a page only downloads the families its template and theme use.
// next/font needs literal options at each call (no spreads): it is analysed at build time.
const inter = Inter({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-inter" });
const poppins = Poppins({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-poppins", weight: ["400", "500", "600", "700", "800"] });
const merriweather = Merriweather({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-merriweather", weight: ["400", "700"] });
const nunito = Nunito({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-nunito" });
const playfair = Playfair_Display({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-playfair" });
const source = Source_Sans_3({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-source" });

export const siteFontClasses = [inter, poppins, merriweather, nunito, playfair, source].map((f) => f.variable).join(" ");
