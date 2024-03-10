import "../global.css";
import { Inter } from "@next/font/google";
import LocalFont from "@next/font/local";
import { Metadata } from "next";
import banner from "../public/banner.png";

export const metadata: Metadata = {
	title: {
		default: "Aethernum LLC",
		template: "%s | aethernum.com",
	},
	description: "Aethernum LLC - A startup tech company",
	openGraph: {
		title: "aethernum.io",
		description: "Aethernum LLC - A startup tech company", // make sure looks good when link to aethernum is shared
		url: "https://aethernum.io",
		siteName: "aethernum.io",
		images: [
			{
				url: banner.src, // prefer to use a link in the future. like https://aethernum.io/banner.png
				width: 1920,
				height: 1080,
			},
		],
		locale: "en-US",
		type: "website",
	},
	robots: {
		index: true,
		follow: true,
		googleBot: {
			index: true,
			follow: true,
			"max-video-preview": -1,
			"max-image-preview": "large",
			"max-snippet": -1,
		},
	},
	icons: {
		shortcut: "/favicon.png",
	},
};
const inter = Inter({
	subsets: ["latin"],
	variable: "--font-inter",
});

const calSans = LocalFont({
	src: "../public/fonts/CalSans-SemiBold.ttf",
	variable: "--font-calsans",
});

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" className={[inter.variable, calSans.variable].join(" ")}>
			<body
				className={`bg-black ${
					process.env.NODE_ENV === "development" ? "debug-screens" : undefined
				}`}
			>
				{children}
			</body>
		</html>
	);
}
