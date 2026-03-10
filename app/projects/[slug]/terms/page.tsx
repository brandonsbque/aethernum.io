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

export default async function TermsPage({ params }: Props) {
	return (
		<div className="relative min-h-screen bg-gradient-to-tl from-black via-zinc-400/10 to-black">
			<div className="px-4 py-12 mx-auto prose prose-invert prose-zinc prose-quoteless max-w-2xl">
				<h1 className="text-zinc-100">Terms of Service for WalletWise</h1>
				<p className="text-sm text-zinc-100">Effective Date: March 10, 2026</p>

				<h2 className="text-zinc-100">1. Agreement to Terms</h2>
				<p className="text-zinc-100">
					By downloading, installing, or using the WalletWise mobile application
					("the App"), you agree to be bound by these Terms of Service and the
					Apple Standard Licensed Application End User License Agreement (EULA).
					If you do not agree to these terms, do not use the App.
				</p>

				<h2 className="text-zinc-100">2. Privacy Policy</h2>
				<p className="text-zinc-100">
					Your use of the App is also governed by our Privacy Policy, which can
					be found at: https://aethernum.io/projects/walletwise/privacy. We
					encourage you to review it to understand how we handle your local data
					and account identifiers.
				</p>

				<h2 className="text-zinc-100">3. Subscriptions and Purchases</h2>
				<p className="text-zinc-100">
					WalletWise offers "Smart" features through auto-renewable
					subscriptions and one-time "Lifetime" purchases.
				</p>
				<ul className="text-zinc-100">
					<li>
						<strong>Billing:</strong> Payments are handled via Apple's In-App
						Purchase system. Payment will be charged to your Apple ID account at
						confirmation of purchase.
					</li>
					<li>
						<strong>Auto-Renewal:</strong> Subscriptions (Monthly and Yearly)
						automatically renew unless auto-renew is turned off at least 24
						hours before the end of the current period.
					</li>
					<li>
						<strong>Cancellations:</strong> You can manage and cancel your
						subscriptions at any time in your App Store Account Settings.
					</li>
					<li>
						<strong>Lifetime Purchase:</strong> The "Lifetime" tier is a
						non-consumable, one-time purchase that provides permanent access to
						Smart features for that specific Apple ID.
					</li>
				</ul>

				<h2 className="text-zinc-100">
					4. NO FINANCIAL ADVICE &amp; DISCLAIMER OF WARRANTIES
				</h2>
				<p className="text-zinc-100">
					WalletWise is a tracking and organizational tool.
				</p>
				<ul className="text-zinc-100">
					<li>
						<strong>Not a Financial Institution:</strong> We do not provide
						financial, legal, or tax advice.
					</li>
					<li>
						<strong>"AS IS" Basis:</strong> The App is provided "AS IS" without
						warranties of any kind. While we strive for accuracy, we do not
						guarantee that the dates, calculations, or notifications provided by
						the App are 100% accurate or timely.
					</li>
				</ul>

				<h2 className="text-zinc-100">
					5. LIMITATION OF LIABILITY (IMPORTANT)
				</h2>
				<p className="text-zinc-100">
					To the maximum extent permitted by law, Aethernum LLC shall not be
					liable for any financial losses, damages, or penalties you may incur,
					including but not limited to:
				</p>
				<ul className="text-zinc-100">
					<li>
						<strong>Missed Payments:</strong> Late fees, interest charges, or
						credit score impacts resulting from missed credit card payments or
						failed notifications.
					</li>
					<li>
						<strong>App Errors:</strong> Any bugs, technical failures, or data
						loss within the App.
					</li>
					<li>
						<strong>User Error:</strong> Incorrect data entry or failure to
						independently verify your financial obligations outside of the App.
					</li>
				</ul>
				<p className="text-zinc-100">
					YOU ACKNOWLEDGE THAT IT IS YOUR SOLE RESPONSIBILITY TO ENSURE YOUR
					FINANCIAL OBLIGATIONS ARE MET.
				</p>

				<h2 className="text-zinc-100">6. Account Deletion</h2>
				<p className="text-zinc-100">
					If you utilize "Sign in with Apple," you may request account deletion
					at any time via the Settings menu in the App. Deleting your account
					will clear your local data and sign you out, but it does not
					automatically cancel active subscriptions (which must be managed
					through Apple).
				</p>

				<h2 className="text-zinc-100">7. Changes to Terms</h2>
				<p className="text-zinc-100">
					We reserve the right to update these terms at any time. Your continued
					use of the App after changes are posted constitutes your acceptance of
					the new terms.
				</p>

				<h2 className="text-zinc-100">8. Contact Information</h2>
				<p className="text-zinc-100">
					For support or legal inquiries, please contact us via the support link
					at https://aethernum.io/projects/walletwise/support.
				</p>
			</div>
		</div>
	);
}
