import { allProjects } from "contentlayer/generated";

export const revalidate = 60;

type Props = {
	params: {
		slug: string;
	};
};

export async function generateStaticParams(): Promise<Props["params"][]> {
	return allProjects
		.filter((p) => p.published)
		.map((p) => ({
			slug: p.slug,
		}));
}

export default async function SupportPage({ params }: Props) {
	return (
		<div className="relative min-h-screen bg-gradient-to-tl from-black via-zinc-400/10 to-black">
			<div className="px-4 py-12 mx-auto prose prose-invert prose-zinc prose-quoteless max-w-2xl">
				<h1 className="text-zinc-100">WalletWise Support</h1>
				<p className="text-sm text-zinc-100">Effective Date: March 10, 2026</p>

				<p className="text-zinc-100">
					Welcome to WalletWise support. We are dedicated to helping you stay on
					top of your finances with smart, timely reminders.
				</p>

				<h2 className="text-zinc-100">1. Contact Us</h2>
				<p className="text-zinc-100">
					For technical support, bug reports, or feature requests, please email
					us directly. We typically respond within 24-48 hours.
				</p>
				<ul className="text-zinc-100">
					<li>
						<strong>Email:</strong>{" "}
						<a
							href="mailto:brandon@aethernum.io"
							className="text-blue-400 hover:text-blue-300"
						>
							brandon@aethernum.io
						</a>
					</li>
				</ul>

				<h2 className="text-zinc-100">2. Frequently Asked Questions (FAQ)</h2>

				<h3 className="text-zinc-100">Where is my data stored?</h3>
				<p className="text-zinc-100">
					To ensure your maximum privacy, all data regarding your credit cards
					and due dates is stored locally on your device. Aethernum LLC does not
					have access to your financial information, and it never leaves your
					phone.
				</p>

				<h3 className="text-zinc-100">How do I restore my purchase?</h3>
				<p className="text-zinc-100">
					If you have a new device or reinstalled the app, you can restore your
					Monthly, Yearly, or Lifetime access:
				</p>
				<ol className="text-zinc-100">
					<li>
						Open the <strong>Profile</strong> screen in WalletWise. Tap "View
						Plans"
					</li>
					<li>
						Scroll to the bottom and tap <strong>"Restore Purchases."</strong>
					</li>
					<li>
						Ensure you are signed into the same Apple ID used for the original
						purchase.
					</li>
				</ol>

				<h3 className="text-zinc-100">How do I cancel a subscription?</h3>
				<p className="text-zinc-100">
					All subscriptions are managed securely by Apple. To cancel:
				</p>
				<ol className="text-zinc-100">
					<li>
						Open the <strong>Settings</strong> app on your iPhone.
					</li>
					<li>
						Tap your <strong>Name</strong> at the top, then tap{" "}
						<strong>Subscriptions</strong>.
					</li>
					<li>
						Select <strong>WalletWise</strong> and tap{" "}
						<strong>Cancel Subscription</strong>.
					</li>
				</ol>

				<h3 className="text-zinc-100">Why didn't I get a reminder?</h3>
				<p className="text-zinc-100">
					Please ensure that <strong>Notifications</strong> are enabled for
					WalletWise in your iOS Settings. Since your data is local, the app
					relies on your device's system to trigger these alerts at the times
					you've set. Additionally, check that WalletWise is able to send
					notificatoins by tapping "Send Test Notification" under{" "}
					<strong>Profile</strong>, <strong>Advanced</strong>.
				</p>

				<h2 className="text-zinc-100">3. App Information</h2>
				<ul className="text-zinc-100">
					<li>
						<strong>Developer:</strong> Aethernum LLC
					</li>
					<li>
						<strong>Compatibility:</strong> Requires iOS 17.0 or later.
					</li>
				</ul>
			</div>
		</div>
	);
}
