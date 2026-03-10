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

export default async function PrivacyPage({ params }: Props) {
	return (
		<div className="relative min-h-screen bg-black">
			<div className="px-4 py-12 mx-auto prose prose-invert prose-zinc prose-quoteless max-w-2xl">
				<h1 className="text-zinc-100">Privacy Policy</h1>{" "}
				<p className="text-sm text-zinc-100">Last Updated: March 9, 2026</p>
				<h2 className="text-zinc-100">1. Data We Receive</h2>
				<p className="text-zinc-100">
					When you use "Sign in with Apple," we receive a unique user
					identifier. If you choose to share them, we may also receive your name
					and email address.
				</p>
				<h2 className="text-zinc-100">2. Storage</h2>
				<p className="text-zinc-100">
					All your personal data (card lists, trade history) is stored locally
					on your device. We do not transmit this data to our servers.
				</p>
				<h2 className="text-zinc-100">3. Third Parties</h2>
				<p className="text-zinc-100">
					We use RevenueCat to manage subscriptions. They receive your unique
					Apple user ID to verify your "Pro" status but do not have access to
					your local app data.
				</p>
				<h2 className="text-zinc-100">4. Data Control</h2>
				<p className="text-zinc-100">
					You can manage or revoke your "Sign in with Apple" permissions in your
					iOS Settings. To delete all app data, simply uninstall the app.
				</p>
			</div>
		</div>
	);
}
